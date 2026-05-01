import { app, BrowserWindow, dialog, ipcMain, globalShortcut } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import http from 'node:http'

const isDev = !app.isPackaged

let backendProc = null

function isWindowsElevated() {
  if (process.platform !== 'win32') {
    return true
  }

  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } exit 1',
    ],
    {
      windowsHide: true,
      stdio: 'ignore',
    }
  )

  return result.status === 0
}

function relaunchAsAdministrator() {
  if (process.platform !== 'win32' || isDev) {
    return false
  }

  const exePath = process.execPath.replace(/'/g, "''")
  const args = process.argv.slice(1).map((arg) => `'${String(arg).replace(/'/g, "''")}'`).join(', ')
  const command = args
    ? `Start-Process -FilePath '${exePath}' -ArgumentList @(${args}) -Verb RunAs`
    : `Start-Process -FilePath '${exePath}' -Verb RunAs`

  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ],
    {
      windowsHide: true,
      stdio: 'ignore',
    }
  )

  return result.status === 0
}

function logLine(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
    const logPath = path.join(app.getPath('userData'), 'main.log')
    fs.appendFileSync(logPath, line, 'utf8')
  } catch {
    // ignore
  }
}

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
  logLine('uncaughtException', String(err?.stack || err))
})

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason)
  logLine('unhandledRejection', String(reason))
})

if (!isDev && process.platform === 'win32' && !isWindowsElevated()) {
  const relaunched = relaunchAsAdministrator()
  if (!relaunched) {
    logLine('Administrator relaunch was cancelled or failed')
  }
  app.exit(relaunched ? 0 : 1)
}

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port: 18765,
        path: '/health',
        timeout: 600,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', () => resolve(false))
  })
}

async function waitForBackendReady(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await checkBackendHealth()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

/**
 * 获取后端可执行文件路径
 */
function getBackendExePath() {
  if (isDev) {
    return null
  }

  const resourcesPath = process.resourcesPath
  const backendDir = path.join(resourcesPath, 'backend')
  const candidates = [
    'meowfield-autoplayer-lite-backend.exe',
    'devspace-autoplayer-backend.exe',
  ]

  for (const name of candidates) {
    const p = path.join(backendDir, name)
    if (existsSync(p)) {
      logLine('Backend exe found:', p)
      return p
    }
  }

  logLine('Backend exe not found. resourcesPath=', resourcesPath)
  return null
}

/**
 * 启动后端服务
 */
async function startBackend() {
  if (backendProc) return

  const healthy = await checkBackendHealth()
  if (healthy) {
    console.log('Backend already running (dev mode)')
    return
  }

  if (isDev) {
    const backendCwd = path.join(process.cwd(), '..', 'backend')
    backendProc = spawn('python', ['-m', 'src.app.main'], {
      cwd: backendCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    if (backendProc.stdout) {
      backendProc.stdout.on('data', (chunk) => {
        const text = String(chunk)
        text.split(/\r?\n/).filter(Boolean).forEach((line) => console.log(`[backend] ${line}`))
      })
    }
    if (backendProc.stderr) {
      backendProc.stderr.on('data', (chunk) => {
        const text = String(chunk)
        text.split(/\r?\n/).filter(Boolean).forEach((line) => console.error(`[backend] ${line}`))
      })
    }

    console.log('Backend started (dev mode)')
  } else {
    const backendExe = getBackendExePath()
    if (backendExe) {
      backendProc = spawn(backendExe, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // debug 版：强制开启后端 DEBUG 日志，便于定位“绑定进程后弹琴失效”
          MEOWFIELD_AUTOPLAYER_DEBUG: '1',
        },
        windowsHide: true
      })
      if (backendProc.stdout) {
        backendProc.stdout.on('data', (chunk) => {
          const text = String(chunk)
          text.split(/\r?\n/).filter(Boolean).forEach((line) => logLine(`[backend] ${line}`))
        })
      }
      if (backendProc.stderr) {
        backendProc.stderr.on('data', (chunk) => {
          const text = String(chunk)
          text.split(/\r?\n/).filter(Boolean).forEach((line) => logLine(`[backend][err] ${line}`))
        })
      }
      console.log('Backend started (prod mode):', backendExe)
    } else {
      console.error('Backend executable not found')
      logLine('Backend executable not found')
      try {
        dialog.showErrorBox(
          '后端启动失败',
          '未找到后端可执行文件：resources/backend/meowfield-autoplayer-lite-backend.exe（或 devspace-autoplayer-backend.exe）'
        )
      } catch {
        // ignore
      }
      return
    }
  }

  if (!backendProc) {
    logLine('Backend process not started (backendProc is null)')
    return
  }

  const ready = await waitForBackendReady()
  if (!ready) {
    logLine('Backend health check timed out')
    stopBackend()
    try {
      dialog.showErrorBox('后端启动失败', '后端未能在 15 秒内完成启动，请查看日志后重试。')
    } catch {
      // ignore
    }
    return
  }

  backendProc.on('exit', () => {
    logLine('Backend exited')
    backendProc = null
  })
}

/**
 * 停止后端服务
 */
function stopBackend() {
  if (!backendProc) return
  try {
    backendProc.kill()
  } finally {
    backendProc = null
  }
}

/**
 * 创建主窗口
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#f5f7fa',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: isDev 
        ? path.join(process.cwd(), 'electron', 'preload.cjs')
        : path.join(app.getAppPath(), 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => {
    try {
      win.show()
    } catch {
      // ignore
    }
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('did-fail-load:', { errorCode, errorDescription, validatedURL })
    logLine('did-fail-load', { errorCode, errorDescription, validatedURL })
    try {
      dialog.showErrorBox('页面加载失败', `${errorDescription} (${errorCode})\n${validatedURL}`)
    } catch {
      // ignore
    }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone:', details)
    logLine('render-process-gone', details)
    try {
      dialog.showErrorBox('渲染进程崩溃', JSON.stringify(details))
    } catch {
      // ignore
    }
  })

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html')
    win.loadFile(indexPath).catch(err => {
      console.error('Failed to load:', err)
      logLine('Failed to load index.html', String(err?.stack || err))
      try {
        dialog.showErrorBox('打开失败', `无法加载页面：${indexPath}\n${String(err)}`)
      } catch {
        // ignore
      }
    })
  }

  // 注册全局热键：使用 Electron globalShortcut，保证在应用无焦点时也可触发
  try {
    globalShortcut.unregisterAll()
    const okPlayPause = globalShortcut.register('CommandOrControl+Shift+C', () => {
      try {
        if (!win || win.isDestroyed()) return
        win.webContents.send('hotkey', { action: 'play_pause' })
      } catch (e) {
        console.error('Failed to send hotkey play_pause:', e)
      }
    })
    const okStop = globalShortcut.register('F9', () => {
      try {
        if (!win || win.isDestroyed()) return
        win.webContents.send('hotkey', { action: 'stop' })
      } catch (e) {
        console.error('Failed to send hotkey stop:', e)
      }
    })
    console.log('Global shortcuts registered:', { play_pause: okPlayPause, stop: okStop })
  } catch (e) {
    console.error('Failed to register global shortcuts:', e)
  }

  // 页面 reload 后，渲染进程会重新订阅；这里确保 window 生命周期内不丢事件。
  win.webContents.on('did-finish-load', () => {
    console.log('Renderer did-finish-load: hotkey bridge ready')
    logLine('did-finish-load')
  })

  win.on('closed', () => {
    try {
      globalShortcut.unregisterAll()
    } catch {
      // ignore
    }
  })
}

app.whenReady().then(() => {
  return startBackend().then(() => {
    createWindow()
  })
}).then(() => {
  ipcMain.handle('open-midi-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select MIDI File',
      properties: ['openFile'],
      filters: [
        { name: 'MIDI', extensions: ['mid', 'midi'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled) return null
    return result.filePaths?.[0] ?? null
  })

  ipcMain.handle('open-audio-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Audio File',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled) return null
    return result.filePaths?.[0] ?? null
  })

  ipcMain.handle('save-midi-dialog', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Save MIDI File',
      defaultPath: 'recording.mid',
      filters: [
        { name: 'MIDI', extensions: ['mid', 'midi'] }
      ]
    })

    if (result.canceled) return null
    return result.filePath ?? null
  })

  ipcMain.handle('open-directory-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select PianoTrans Directory',
      properties: ['openDirectory']
    })

    if (result.canceled) return null
    return result.filePaths?.[0] ?? null
  })

  // 保存文件对话框（用于导出日志）
  ipcMain.handle('save-file-dialog', async (event, options) => {
    const { title = '保存文件', defaultPath = 'backend.log', filters = [] } = options || {}
    const result = await dialog.showSaveDialog({
      title,
      defaultPath,
      filters
    })

    if (result.canceled) return null
    return result.filePath ?? null
  })
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  try {
    globalShortcut.unregisterAll()
  } catch {
    // ignore
  }
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    globalShortcut.unregisterAll()
  } catch {
    // ignore
  }
  stopBackend()
})
