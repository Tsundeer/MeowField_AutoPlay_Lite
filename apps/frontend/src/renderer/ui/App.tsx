import React, { useMemo, useState, useRef } from 'react'

import { BackendWs, type BackendStatus, type PreviewEvent, type WindowInfo, type LibraryEntry, type GameProfile } from '../api/ws'
import { loadConfig, saveConfig, loadPresets, addPreset, deletePreset, loadPlaylist, savePlaylist, loadSelectedGameId, saveSelectedGameId, loadGameConfig, saveGameConfig, type Preset, type PlaylistItem } from '../utils/storage'
import { VirtualKeyboard } from './VirtualKeyboard'
import { translations, type Locale } from '../i18n'

type Status = BackendStatus

const GM_DRUM_KEY_MAP: Record<number, string> = {
  36: 'E',
  38: 'W',
  42: '1',
  46: 'Q',
  49: '2',
  51: '5',
  57: 'T',
  48: '3',
  47: '4',
  43: 'R',
}

/**
 * 可折叠面板组件
 */
function CollapsibleCard({ 
  title, 
  children, 
  defaultOpen = true 
}: { 
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader} onClick={() => setIsOpen(!isOpen)}>
        <div style={styles.cardTitleRow}>
          <span style={styles.cardTitle}>{title}</span>
        </div>
        <span style={{ ...styles.chevron, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>V</span>
      </div>
      {isOpen && <div style={styles.cardContent}>{children}</div>}
    </div>
  )
}

function noteNumberToName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(note / 12) - 1
  return `${names[note % 12]}${octave}`
}

function isSemitoneLockedGameProfile(profile: GameProfile | null | undefined): boolean {
  if (!profile?.id) {
    return false
  }
  return profile.id.startsWith('identity-v-') || profile.id.startsWith('yihuan-')
}

export function App() {
  const MANUAL_PLAY_COUNTDOWN_SECONDS = 3
  const [ws] = useState(() => new BackendWs())
  
  const savedConfig = useMemo(() => loadConfig(), [])
  
  const [status, setStatus] = useState<Status>('idle')
  const [speed, setSpeed] = useState(savedConfig.speed ?? 1.0)
  const [transpose, setTranspose] = useState(savedConfig.transpose ?? 0)
  const [midiPath, setMidiPath] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [noteCount, setNoteCount] = useState<number | null>(null)
  const [eventCount, setEventCount] = useState<number | null>(null)
  const [preview, setPreview] = useState<PreviewEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [bindProcess, setBindProcess] = useState<string>(savedConfig.bindProcess ?? '')
  const [inputMode, setInputMode] = useState<'sendinput' | 'message'>(savedConfig.inputMode ?? 'sendinput')
  const [hotkeysEnabled, setHotkeysEnabled] = useState(false)
  const [cursorMs, setCursorMs] = useState(0)
  const [progressPercent, setProgressPercent] = useState(0)
  const [maxPolyphony, setMaxPolyphony] = useState(savedConfig.maxPolyphony ?? 10)
  const [chordMode, setChordMode] = useState<string>(savedConfig.chordMode ?? 'prefer')
  const [autoTranspose, setAutoTranspose] = useState(savedConfig.autoTranspose ?? true)
  const [linkLatencyMs, setLinkLatencyMs] = useState(savedConfig.linkLatencyMs ?? 0)
  const [noteRangeLow, setNoteRangeLow] = useState(savedConfig.noteRangeLow ?? 48)
  const [noteRangeHigh, setNoteRangeHigh] = useState(savedConfig.noteRangeHigh ?? 83)
  const [preferNearestWhite, setPreferNearestWhite] = useState(savedConfig.preferNearestWhite ?? true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set())
  const [isAdmin, setIsAdmin] = useState(false)
  const [windowsList, setWindowsList] = useState<WindowInfo[]>([])
  const [showProcessSelector, setShowProcessSelector] = useState(false)
  const [boundProcess, setBoundProcess] = useState<string | null>(null)
  const [autoTransposeResult, setAutoTransposeResult] = useState<number | null>(null)
  const [whiteKeyRatio, setWhiteKeyRatio] = useState<number | null>(null)
  const [originalWhiteKeyRatio, setOriginalWhiteKeyRatio] = useState<number | null>(null)
  const [currentTransposeRatio, setCurrentTransposeRatio] = useState<number | null>(null)
  const [scheduledTime, setScheduledTime] = useState<string>('')
  const [scheduledTimer, setScheduledTimer] = useState<number | null>(null)
  const [isScheduled, setIsScheduled] = useState(false)
  const [manualCountdown, setManualCountdown] = useState<number | null>(null)
  const [networkLatency, setNetworkLatency] = useState<number>(0)
  const [ntpServer, setNtpServer] = useState<string>('')
  const [enableDynamicCompensation, setEnableDynamicCompensation] = useState<boolean>(true)
  const [ntpSyncing, setNtpSyncing] = useState<boolean>(false)
  const latencyIntervalRef = useRef<number | null>(null)
  const manualCountdownTimerRef = useRef<number | null>(null)
  const [ntpInfo, setNtpInfo] = useState<{
    success: boolean
    offset_ms?: number
    server?: string
    message?: string
  } | null>(null)
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets())
  const [presetNameInput, setPresetNameInput] = useState<string>('')
  const [showPresetManager, setShowPresetManager] = useState<boolean>(false)
  const [audioConverterAvailable, setAudioConverterAvailable] = useState<boolean>(false)
  const [audioConverting, setAudioConverting] = useState<boolean>(false)
  const [convertedMidiPath, setConvertedMidiPath] = useState<string | null>(null)
  const [supportedFormats, setSupportedFormats] = useState<string[]>([])
  const [pianoTransPath, setPianoTransPath] = useState<string | null>(savedConfig.pianoTransPath || null)
  const [locale, setLocale] = useState<Locale>((savedConfig.locale as Locale) || 'zh-CN')
  const t = translations[locale]
  const [activeMenu, setActiveMenu] = useState<string>('main')
  const initialSelectedGameId = loadSelectedGameId()
  const initialGameConfig = loadGameConfig(initialSelectedGameId)
  const [gameProfiles, setGameProfiles] = useState<GameProfile[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string | null>(initialSelectedGameId)
  const activeInstrumentInitial = ((initialGameConfig.instrument ?? (savedConfig as any).instrument ?? 'piano')) as 'piano' | 'drums' | 'microphone'
  const currentGameProfile = gameProfiles.find((profile) => profile.id === selectedGameId) || null
  const isSemitoneLockedProfile = isSemitoneLockedGameProfile(currentGameProfile)

  // 自定义键位映射（按乐器模式分离保存，切换模式自动切换）
  const initialInstrument = ((savedConfig as any).instrument ?? 'piano') as 'piano' | 'drums' | 'microphone'
  const initialKeyMap = (initialGameConfig.customKeyMap || {}) as Record<number, string>

  const [instrument, setInstrument] = useState<'piano' | 'drums' | 'microphone'>(activeInstrumentInitial)
  const [customKeyMap, setCustomKeyMap] = useState<Record<number, string>>(initialKeyMap)
  const [editingKeyMap, setEditingKeyMap] = useState<Record<number, string>>(initialKeyMap)
  const [showKeyMapEditor, setShowKeyMapEditor] = useState<boolean>(false)
  
  // 播放列表相关状态
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(() => loadPlaylist())
  const [currentPlaylistIndex, setCurrentPlaylistIndex] = useState<number>(-1)
  const [showPlaylist, setShowPlaylist] = useState<boolean>(false)
  const [autoPlayNext, setAutoPlayNext] = useState<boolean>(true)
  
  // 曲库管理状态
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([])
  const [libraryFolders, setLibraryFolders] = useState<string[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [librarySearchQuery, setLibrarySearchQuery] = useState<string>('')
  const [libraryScanning, setLibraryScanning] = useState<boolean>(false)
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; name?: string } | null>(null)
  const [scanAddedCount, setScanAddedCount] = useState<number>(0)
  const [libraryTotal, setLibraryTotal] = useState<number>(0)
  const [libraryOffset, setLibraryOffset] = useState<number>(0)
  const libraryLimit = 200
  
  // 日志导出状态
  const [exportingLogs, setExportingLogs] = useState<boolean>(false)
  const [exportLogsResult, setExportLogsResult] = useState<{ success: boolean; message: string } | null>(null)
  const didRunConnectInitRef = useRef(false)
  const autoBindAttemptedRef = useRef(false)

  const saveCommonConfig = React.useCallback((config: Partial<any>) => {
    saveConfig(config)
    if (selectedGameId) {
      saveGameConfig(selectedGameId, config)
    }
  }, [selectedGameId])

  const getResolvedProfileConfig = React.useCallback((profile: GameProfile, overrides?: Partial<any>) => {
    const stored = loadGameConfig(profile.id)
    const rootConfig = loadConfig()
    return {
      instrument: ((overrides?.instrument ?? stored.instrument ?? profile.instrument) || 'piano') as 'piano' | 'drums' | 'microphone',
      midiChannelFilter: overrides?.midiChannelFilter ?? overrides?.midi_channel_filter ?? stored.midiChannelFilter ?? profile.midi_channel_filter ?? null,
      noteRangeLow: overrides?.noteRangeLow ?? overrides?.note_range_low ?? stored.noteRangeLow ?? profile.note_range_low ?? 48,
      noteRangeHigh: overrides?.noteRangeHigh ?? overrides?.note_range_high ?? stored.noteRangeHigh ?? profile.note_range_high ?? 83,
      preferNearestWhite: overrides?.preferNearestWhite ?? overrides?.prefer_nearest_white ?? stored.preferNearestWhite ?? profile.prefer_nearest_white ?? true,
      speed: overrides?.speed ?? stored.speed ?? rootConfig.speed ?? profile.speed ?? 1.0,
      inputMode: (overrides?.inputMode ?? overrides?.input_mode ?? stored.inputMode ?? rootConfig.inputMode ?? 'sendinput') as 'sendinput' | 'message',
      transpose: overrides?.transpose ?? overrides?.transpose_semitones ?? stored.transpose ?? rootConfig.transpose ?? profile.transpose_semitones ?? 0,
      maxPolyphony: overrides?.maxPolyphony ?? overrides?.max_polyphony ?? stored.maxPolyphony ?? rootConfig.maxPolyphony ?? profile.max_polyphony ?? 10,
      chordMode: overrides?.chordMode ?? overrides?.chord_mode ?? stored.chordMode ?? rootConfig.chordMode ?? profile.chord_mode ?? 'prefer',
      autoTranspose: overrides?.autoTranspose ?? overrides?.auto_transpose ?? stored.autoTranspose ?? (rootConfig.autoTranspose as boolean) ?? profile.auto_transpose ?? false,
      linkLatencyMs: overrides?.linkLatencyMs ?? overrides?.link_latency_ms ?? stored.linkLatencyMs ?? rootConfig.linkLatencyMs ?? profile.link_latency_ms ?? 0,
      // 自定义键位必须按游戏隔离，不能再回退到全局键位配置。
      customKeyMap: ((overrides?.customKeyMap ?? overrides?.custom_key_map ?? stored.customKeyMap) as Record<number, string> | undefined) ?? profile.custom_key_map ?? {},
    }
  }, [])

  const applyProfileState = React.useCallback((profile: GameProfile) => {
    const resolved = getResolvedProfileConfig(profile)

    setSelectedGameId(profile.id)
    saveSelectedGameId(profile.id)
    setInstrument(resolved.instrument)
    setCustomKeyMap(resolved.customKeyMap)
    setEditingKeyMap(resolved.customKeyMap)
    setSpeed(resolved.speed)
    setInputMode(resolved.inputMode)
    setTranspose(resolved.transpose)
    setMaxPolyphony(resolved.maxPolyphony)
    setChordMode(resolved.chordMode)
    setAutoTranspose(resolved.autoTranspose)
    setLinkLatencyMs(resolved.linkLatencyMs)
    setNoteRangeLow(resolved.noteRangeLow)
    setNoteRangeHigh(resolved.noteRangeHigh)
    setPreferNearestWhite(resolved.preferNearestWhite)
  }, [getResolvedProfileConfig])

  const applyStoredGameOverride = React.useCallback((profileId: string) => {
    const profile = gameProfiles.find((item) => item.id === profileId)
    if (!profile) {
      return
    }

    const stored = loadGameConfig(profileId)
    const rootConfig = loadConfig()
    const overrideConfig: Record<string, any> = {}

    if (stored.instrument) {
      overrideConfig.instrument = stored.instrument
      overrideConfig.midi_channel_filter = stored.midiChannelFilter ?? (stored.instrument === 'drums' ? 9 : null)
    }
    const effectiveInputMode = stored.inputMode || rootConfig.inputMode
    if (effectiveInputMode) {
      overrideConfig.input_mode = effectiveInputMode
    }
    if (stored.customKeyMap !== undefined) {
      const map = stored.customKeyMap as Record<number, string>
      overrideConfig.custom_key_map = Object.keys(map || {}).length ? map : (stored.instrument === 'piano' ? null : {})
    }
    if (stored.noteRangeLow !== undefined) {
      overrideConfig.note_range_low = stored.noteRangeLow
    }
    if (stored.noteRangeHigh !== undefined) {
      overrideConfig.note_range_high = stored.noteRangeHigh
    }
    if (stored.preferNearestWhite !== undefined) {
      overrideConfig.prefer_nearest_white = stored.preferNearestWhite
    }
    if (stored.speed !== undefined) {
      overrideConfig.speed = stored.speed
    }
    if (stored.transpose !== undefined) {
      overrideConfig.transpose_semitones = stored.transpose
    }
    if (stored.maxPolyphony !== undefined) {
      overrideConfig.max_polyphony = stored.maxPolyphony
    }
    if (stored.chordMode !== undefined) {
      overrideConfig.chord_mode = stored.chordMode
    }
    if (stored.autoTranspose !== undefined) {
      overrideConfig.auto_transpose = stored.autoTranspose
    }

    if (Object.keys(overrideConfig).length > 0) {
      ws.send({ type: 'set_config', config: overrideConfig })
    }
  }, [gameProfiles, ws])

  const selectGameProfile = React.useCallback((profileId: string) => {
    const profile = gameProfiles.find(item => item.id === profileId)
    if (profile) {
      applyProfileState(profile)
    } else {
      setSelectedGameId(profileId)
      saveSelectedGameId(profileId)
    }

    ws.send({ type: 'set_game_profile', profile_id: profileId })
    applyStoredGameOverride(profileId)
  }, [applyProfileState, applyStoredGameOverride, gameProfiles, ws])

  React.useEffect(() => {
    ws.onOpen = () => {
      setConnected(true)
      didRunConnectInitRef.current = false
      autoBindAttemptedRef.current = false
      ws.send({ type: 'get_game_profiles' })
    }
    ws.onClose = () => {
      setConnected(false)
      didRunConnectInitRef.current = false
      autoBindAttemptedRef.current = false
    }
    ws.onError = (err) => {
      setErrorMsg(err)
      setTimeout(() => setErrorMsg(null), 5000)
    }
    ws.onMessage = (msg) => {
      if (msg.type === 'game_profiles') {
        setGameProfiles(msg.profiles ?? [])
        const targetProfileId = selectedGameId || msg.active_profile_id
        const profile = (msg.profiles ?? []).find(item => item.id === targetProfileId)
        if (profile) {
          applyProfileState(profile)
        }
        if (targetProfileId) {
          if (targetProfileId !== msg.active_profile_id) {
            ws.send({ type: 'set_game_profile', profile_id: targetProfileId })
            applyStoredGameOverride(targetProfileId)
          } else {
            applyStoredGameOverride(targetProfileId)
          }
        }
      }
      if (msg.type === 'ntp_latency') {
        // 处理延迟测量结果，包括成功和失败的情况
        if (msg.latency_ms > 0) {
          // 测量成功
          setNetworkLatency(msg.latency_ms)
          if (msg.server) setNtpServer(msg.server)
          // 只更新链路延迟，不发送完整配置以避免覆盖其他设置
          if (enableDynamicCompensation) {
            const totalLatency = linkLatencyMs + msg.latency_ms
            const config = {
              link_latency_ms: totalLatency
            }
            ws.send({ type: 'set_config', config })
          }
        } else if (msg.latency_ms === -1 || msg.error) {
          // 测量失败，显示错误状态但不影响其他功能
          setNetworkLatency(-1)
          if (msg.server) setNtpServer(msg.server)
          console.warn('网络延迟测量失败:', msg.error || '未知错误')
        }
        // latency_ms === 0 时保持之前的值或继续显示"测量中"
      }
      if (msg.type === 'status') {
        setStatus(msg.status)
        if (msg.game_profile) {
          applyProfileState(msg.game_profile)
        }
        if (msg.hotkeys_enabled !== undefined) {
          setHotkeysEnabled(msg.hotkeys_enabled)
        }
        if (msg.is_admin !== undefined) {
          setIsAdmin(msg.is_admin)
        }
        if (msg.bind?.process !== undefined) {
          setBoundProcess(msg.bind.process)
          if (msg.bind.process) {
            setSuccessMsg(`已绑定进程: ${msg.bind.process}`)
            setTimeout(() => setSuccessMsg(null), 3000)
          }
        }
        if (msg.config) {
          if (msg.config.transpose_semitones !== undefined) {
            setTranspose(msg.config.transpose_semitones)
          }
          if (msg.config.speed !== undefined) {
            setSpeed(msg.config.speed)
          }
          if (msg.config.max_polyphony !== undefined) {
            setMaxPolyphony(msg.config.max_polyphony)
          }
          if (msg.config.chord_mode !== undefined) {
            setChordMode(msg.config.chord_mode)
          }
          if (msg.config.auto_transpose !== undefined) {
            setAutoTranspose(msg.config.auto_transpose)
          }
          if (msg.config.link_latency_ms !== undefined) {
            setLinkLatencyMs(msg.config.link_latency_ms)
          }
          if (msg.config.instrument !== undefined) {
            setInstrument(msg.config.instrument)
          }
          if (msg.config.input_mode !== undefined) {
            setInputMode(msg.config.input_mode)
          }
          if (msg.config.note_range_low !== undefined) {
            setNoteRangeLow(msg.config.note_range_low)
          }
          if (msg.config.note_range_high !== undefined) {
            setNoteRangeHigh(msg.config.note_range_high)
          }
          if (msg.config.prefer_nearest_white !== undefined) {
            setPreferNearestWhite(msg.config.prefer_nearest_white)
          }
        }
        if (msg.auto_transpose !== undefined) {
          setAutoTransposeResult(msg.auto_transpose)
          if (msg.config?.transpose_semitones !== undefined) {
            setTranspose(msg.config.transpose_semitones)
          } else {
            setTranspose(msg.auto_transpose)
          }
          const originalRatio = msg.original_white_key_ratio ?? 0
          setOriginalWhiteKeyRatio(originalRatio)
          if (msg.auto_transpose === 0) {
            setSuccessMsg('自动移调: 当前移调已是最优')
          } else {
            setSuccessMsg(`自动移调: ${msg.auto_transpose > 0 ? '+' : ''}${msg.auto_transpose} 半音`)
          }
          setTimeout(() => setSuccessMsg(null), 5000)
        }
        if (msg.midi) {
          const nextPath = msg.midi.path ?? null
          if (nextPath !== midiPath) {
            setCursorMs(0)
            setProgressPercent(0)
            setActiveKeys(new Set())
          }
          setMidiPath(nextPath)
          setDurationMs(msg.midi.duration_ms ?? null)
          setNoteCount(msg.midi.notes ?? null)
          setEventCount(msg.midi.events ?? null)
          setWhiteKeyRatio(msg.midi.white_key_ratio ?? null)
          if (msg.midi.white_key_ratio != null) {
            setCurrentTransposeRatio(msg.midi.white_key_ratio)
          }
        }
        // 播放结束，自动播放下一首
        if (msg.status === 'idle' && status === 'playing' && autoPlayNext) {
          playNext()
        }
      }
      if (msg.type === 'events_preview') {
        setPreview(msg.events ?? [])
      }
      if (msg.type === 'white_key_ratio') {
        setCurrentTransposeRatio(msg.ratio)
      }
      if (msg.type === 'progress') {
        setCursorMs(msg.cursor_ms ?? 0)
        setProgressPercent(msg.percent ?? 0)
      }
      if (msg.type === 'active_keys') {
        setActiveKeys(new Set((msg.keys ?? []).map((key) => String(key).toUpperCase())))
      }
      if (msg.type === 'windows_list') {
        setWindowsList(msg.windows ?? [])

        const remembered = (loadConfig() as any).bindProcess as string | undefined
        if (remembered && remembered.trim() && !autoBindAttemptedRef.current) {
          const wanted = remembered.trim().toLowerCase()
          const found = (msg.windows ?? []).find(w => (w.name || '').toLowerCase() === wanted)
            ?? (msg.windows ?? []).find(w => (w.name || '').toLowerCase().includes(wanted))
          if (found) {
            autoBindAttemptedRef.current = true
            ws.send({ type: 'bind_process', process: found.name })
            setShowProcessSelector(false)
            return
          }
          setErrorMsg(`未找到已记忆进程: ${remembered}，请手动绑定`)
          autoBindAttemptedRef.current = true
          setTimeout(() => setErrorMsg(null), 5000)
        }

        setShowProcessSelector(true)
      }
      if (msg.type === 'admin_status') {
        setIsAdmin(msg.is_admin)
      }
      if (msg.type === 'ntp_sync') {
        setNtpSyncing(false)
        setNtpInfo({
          success: msg.success,
          offset_ms: msg.offset_ms,
          server: msg.server,
          message: msg.message
        })
        if (msg.success) {
          setSuccessMsg(`NTP 同步成功: 时钟偏移 ${msg.offset_ms?.toFixed(2)} ms`)
        } else {
          setErrorMsg(msg.message || 'NTP 同步失败')
        }
        setTimeout(() => {
          setErrorMsg(null)
          setSuccessMsg(null)
        }, 5000)
      }
      if (msg.type === 'audio_converter_status') {
        setAudioConverterAvailable(msg.available)
        if (msg.supported_formats) {
          setSupportedFormats(msg.supported_formats)
        }
        if (msg.current_path) {
          setPianoTransPath(msg.current_path)
        }
      }
      if (msg.type === 'piano_trans_path_set') {
        if (msg.success) {
          setAudioConverterAvailable(msg.available)
          if (msg.current_path) {
            setPianoTransPath(msg.current_path)
            saveConfig({ pianoTransPath: msg.current_path })
          }
          setSuccessMsg(msg.message)
        } else {
          setErrorMsg(msg.message)
        }
        setTimeout(() => {
          setErrorMsg(null)
          setSuccessMsg(null)
        }, 5000)
      }
      if (msg.type === 'audio_conversion_status') {
        if (msg.status === 'converting') {
          setAudioConverting(true)
          setSuccessMsg(msg.message)
        } else if (msg.status === 'completed') {
          setAudioConverting(false)
          setConvertedMidiPath(msg.midi_path || null)
          setSuccessMsg(msg.message)
          if (msg.auto_loaded && msg.midi_info) {
            setStatus('loaded')
            setMidiPath(msg.midi_path || '')
            setDurationMs(msg.midi_info.duration_ms)
            setNoteCount(msg.midi_info.notes)
            setEventCount(msg.midi_info.events)
          }
        } else if (msg.status === 'failed') {
          setAudioConverting(false)
          setErrorMsg(msg.message)
        }
        setTimeout(() => {
          setErrorMsg(null)
          setSuccessMsg(null)
        }, 5000)
      }
      
      // 曲库管理消息处理
      if (msg.type === 'library_list') {
        console.log('[Library] 收到 library_list:', msg.entries.length, '条记录')
        setLibraryEntries(msg.entries)
        setLibraryFolders(msg.folders)
      }
      if (msg.type === 'library_list_page') {
        console.log('[Library] 收到 library_list_page:', msg.entries.length, 'offset', msg.offset, 'total', msg.total)
        setLibraryFolders(msg.folders)
        setLibraryTotal(msg.total)
        setLibraryOffset(msg.offset)
        if (msg.offset === 0) {
          setLibraryEntries(msg.entries)
        } else {
          setLibraryEntries(prev => [...prev, ...msg.entries])
        }
      }
      if (msg.type === 'library_folders') {
        console.log('[Library] 收到 library_folders:', msg.folders)
        setLibraryFolders(msg.folders)
      }
      if (msg.type === 'library_scan_progress') {
        console.log('[Library] 收到 library_scan_progress:', msg.current, '/', msg.total)
        setLibraryScanning(true)
        setScanProgress({ current: msg.current, total: msg.total, name: msg.name })
        if (typeof (msg as any).added_count === 'number') {
          setScanAddedCount((msg as any).added_count)
        }
      }
      if (msg.type === 'library_scan_result') {
        console.log('[Library] 收到 library_scan_result:', msg)
        setLibraryScanning(false)
        setScanProgress(null)
        setScanAddedCount(0)
        if (msg.success) {
          setSuccessMsg(msg.message)
          // 刷新曲库列表
          ws.send({ type: 'library_get_page', offset: 0, limit: libraryLimit, folder: selectedFolder || undefined, query: librarySearchQuery || undefined })
        }
        setTimeout(() => setSuccessMsg(null), 5000)
      }
      if (msg.type === 'library_entry_added') {
        console.log('[Library] 收到 library_entry_added:', msg.entry)
        setLibraryEntries(prev => [...prev, msg.entry])
      }
      if (msg.type === 'library_entry_updated') {
        setLibraryEntries(prev => prev.map(e => e.id === msg.entry.id ? msg.entry : e))
      }
      if (msg.type === 'library_entry_deleted') {
        setLibraryEntries(prev => prev.filter(e => e.id !== msg.id))
      }
      if (msg.type === 'library_folder_deleted') {
        setLibraryEntries(prev => prev.filter(e => e.folder !== msg.folder))
        setLibraryFolders(prev => prev.filter(f => f !== msg.folder))
        setSuccessMsg(`已删除文件夹 ${msg.folder}，共 ${msg.deleted_count} 个曲目`)
        setTimeout(() => setSuccessMsg(null), 3000)
      }
      if (msg.type === 'library_cleared') {
        setLibraryEntries([])
        setLibraryFolders([])
        setSuccessMsg(`已清空曲库，共删除 ${msg.deleted_count} 个曲目`)
        setTimeout(() => setSuccessMsg(null), 3000)
      }
      if (msg.type === 'library_search_result') {
        setLibraryEntries(msg.entries)
      }
      if (msg.type === 'export_logs_result') {
        console.log('[Logs] 收到导出结果:', msg)
        setExportLogsResult({ success: msg.success, message: msg.message })
        setExportingLogs(false)
        setTimeout(() => setExportLogsResult(null), 5000)
      }
    }
    ws.connect()
    setTimeout(() => {
      ws.send({ type: 'check_audio_converter' })
    }, 500)

    return () => {
      // 清理网络延迟测量定时器
      if (latencyIntervalRef.current) {
        clearInterval(latencyIntervalRef.current)
      }
      ws.close()
    }
  }, [ws])

  const sendCurrentConfig = React.useCallback((override?: Partial<Record<string, any>>) => {
    const mapHasAny = Object.keys(customKeyMap || {}).length > 0
    const customKeyMapForSend = instrument === 'piano'
      ? (mapHasAny ? customKeyMap : null)
      : (mapHasAny ? customKeyMap : {})

    const config = {
      speed,
      transpose_semitones: transpose,
      max_polyphony: maxPolyphony,
      chord_mode: chordMode,
      keep_melody_top_note: true,
      chord_cluster_window_ms: 40,
      auto_transpose: autoTranspose,
      link_latency_ms: linkLatencyMs,
      instrument,
      input_mode: inputMode,
      midi_channel_filter: instrument === 'drums' ? 9 : null,
      note_range_low: noteRangeLow,
      note_range_high: noteRangeHigh,
      prefer_nearest_white: preferNearestWhite,
      custom_key_map: customKeyMapForSend,
      ...(override || {})
    }
    ws.send({ type: 'set_config', config })
  }, [speed, transpose, maxPolyphony, chordMode, autoTranspose, linkLatencyMs, instrument, inputMode, customKeyMap, noteRangeLow, noteRangeHigh, preferNearestWhite, ws])

  React.useEffect(() => {
    if (connected && !didRunConnectInitRef.current) {
      didRunConnectInitRef.current = true

      const remembered = (loadConfig() as any).bindProcess as string | undefined
      if (remembered && remembered.trim()) {
        ws.send({ type: 'list_windows' })
      } else {
        setErrorMsg('未绑定进程：请先在顶部“应用绑定”中选择游戏进程，否则不会发送按键')
        setTimeout(() => setErrorMsg(null), 5000)
      }
    }
  }, [connected, ws])

  React.useEffect(() => {
    if (connected && pianoTransPath) {
      ws.send({ type: 'set_piano_trans_path', path: pianoTransPath })
    }
  }, [connected, pianoTransPath, ws])

  const calcWhiteKeyRatio = React.useCallback((t: number) => {
    if (status !== 'idle') {
      ws.send({ type: 'calc_white_key_ratio', transpose: t })
    }
  }, [status, ws])

  const handleTransposeChange = React.useCallback((value: number) => {
    setTranspose(value)
    setAutoTransposeResult(null)
    sendCurrentConfig({ transpose_semitones: value })
    calcWhiteKeyRatio(value)
    saveCommonConfig({ transpose: value })
  }, [calcWhiteKeyRatio, saveCommonConfig, sendCurrentConfig])

  const handleSpeedChange = React.useCallback((value: number) => {
    setSpeed(value)
    sendCurrentConfig({ speed: value })
    saveCommonConfig({ speed: value })
  }, [saveCommonConfig, sendCurrentConfig])

  const handleMaxPolyphonyChange = React.useCallback((value: number) => {
    setMaxPolyphony(value)
    sendCurrentConfig({ max_polyphony: value })
    saveCommonConfig({ maxPolyphony: value })
  }, [saveCommonConfig, sendCurrentConfig])

  const handleChordModeChange = React.useCallback((value: string) => {
    setChordMode(value)
    sendCurrentConfig({ chord_mode: value })
    saveCommonConfig({ chordMode: value })
  }, [saveCommonConfig, sendCurrentConfig])

  const handleInputModeChange = React.useCallback((value: 'sendinput' | 'message') => {
    setInputMode(value)
    sendCurrentConfig({ input_mode: value })
    saveCommonConfig({ inputMode: value })
  }, [saveCommonConfig, sendCurrentConfig])

  const calculateTotalLatency = React.useCallback(() => {
    if (enableDynamicCompensation && networkLatency > 0) {
      return linkLatencyMs + networkLatency
    }
    return linkLatencyMs
  }, [linkLatencyMs, networkLatency, enableDynamicCompensation])

  const handleLinkLatencyChange = React.useCallback((value: number) => {
    setLinkLatencyMs(value)
    // 只有在网络延迟测量成功且大于0时才加入补偿
    const totalLatency = (enableDynamicCompensation && networkLatency > 0) ? value + networkLatency : value
    sendCurrentConfig({ link_latency_ms: totalLatency })
    saveCommonConfig({ linkLatencyMs: value })
  }, [enableDynamicCompensation, networkLatency, saveCommonConfig, sendCurrentConfig])

  const handleDynamicCompensationChange = React.useCallback((value: boolean) => {
    setEnableDynamicCompensation(value)
    // 只有在网络延迟测量成功且大于0时才加入补偿
    const totalLatency = (value && networkLatency > 0) ? linkLatencyMs + networkLatency : linkLatencyMs
    sendCurrentConfig({ link_latency_ms: totalLatency })
  }, [linkLatencyMs, networkLatency, sendCurrentConfig])

  const handleAutoTransposeChange = React.useCallback((value: boolean) => {
    setAutoTranspose(value)
    saveCommonConfig({ autoTranspose: value })
    sendCurrentConfig({ auto_transpose: value })
    if (value && status !== 'idle') {
      ws.send({ type: 'auto_transpose' })
    }
  }, [saveCommonConfig, sendCurrentConfig, status, ws])

  const handleNoteRangeLowChange = React.useCallback((value: number) => {
    const nextLow = Number.isFinite(value) ? value : noteRangeLow
    const nextHigh = instrument === 'microphone'
      ? nextLow + 14
      : Math.max(nextLow, noteRangeHigh)

    setNoteRangeLow(nextLow)
    setNoteRangeHigh(nextHigh)
    sendCurrentConfig({
      note_range_low: nextLow,
      note_range_high: nextHigh,
    })
    saveCommonConfig({
      noteRangeLow: nextLow,
      noteRangeHigh: nextHigh,
    })
    calcWhiteKeyRatio(transpose)
  }, [calcWhiteKeyRatio, instrument, noteRangeHigh, noteRangeLow, saveCommonConfig, sendCurrentConfig, transpose])

  const handleNoteRangeHighChange = React.useCallback((value: number) => {
    const nextHigh = Number.isFinite(value) ? value : noteRangeHigh
    const adjustedHigh = instrument === 'microphone' ? noteRangeLow + 14 : Math.max(noteRangeLow, nextHigh)

    setNoteRangeHigh(adjustedHigh)
    sendCurrentConfig({ note_range_high: adjustedHigh })
    saveCommonConfig({ noteRangeHigh: adjustedHigh })
    calcWhiteKeyRatio(transpose)
  }, [calcWhiteKeyRatio, instrument, noteRangeHigh, noteRangeLow, saveCommonConfig, sendCurrentConfig, transpose])

  const handlePreferNearestWhiteChange = React.useCallback((value: boolean) => {
    setPreferNearestWhite(value)
    sendCurrentConfig({ prefer_nearest_white: value })
    saveCommonConfig({ preferNearestWhite: value })
    calcWhiteKeyRatio(transpose)
  }, [calcWhiteKeyRatio, saveCommonConfig, sendCurrentConfig, transpose])

  const openAndLoadMidi = React.useCallback(async () => {
    const path = await window.devspace?.openMidiDialog?.()
    if (!path) return
    sendCurrentConfig()
    setTimeout(() => {
      ws.send({ type: 'load_midi', path })
    }, 100)
  }, [sendCurrentConfig, ws])

  const refreshPreview = React.useCallback(() => {
    ws.send({ type: 'get_preview', limit: 200 })
  }, [ws])

  const showBindProcessRequired = React.useCallback(() => {
    setErrorMsg('未绑定进程：请先绑定游戏进程后再播放')
    setTimeout(() => setErrorMsg(null), 5000)
    ws.send({ type: 'list_windows' })
  }, [ws])

  const cancelManualPlayCountdown = React.useCallback(() => {
    if (manualCountdownTimerRef.current) {
      clearTimeout(manualCountdownTimerRef.current)
      manualCountdownTimerRef.current = null
    }
    setManualCountdown(null)
  }, [])

  const sendPlayNow = React.useCallback(() => {
    if (!boundProcess) {
      showBindProcessRequired()
      return
    }
    ws.send({ type: 'play' })
  }, [boundProcess, showBindProcessRequired, ws])

  const startManualPlayCountdown = React.useCallback(() => {
    if (!boundProcess) {
      showBindProcessRequired()
      return
    }

    cancelManualPlayCountdown()
    setManualCountdown(MANUAL_PLAY_COUNTDOWN_SECONDS)

    let nextValue = MANUAL_PLAY_COUNTDOWN_SECONDS
    const tick = () => {
      if (nextValue <= 1) {
        manualCountdownTimerRef.current = null
        setManualCountdown(null)
        ws.send({ type: 'play' })
        return
      }

      nextValue -= 1
      setManualCountdown(nextValue)
      manualCountdownTimerRef.current = window.setTimeout(tick, 1000)
    }

    manualCountdownTimerRef.current = window.setTimeout(tick, 1000)
  }, [MANUAL_PLAY_COUNTDOWN_SECONDS, boundProcess, cancelManualPlayCountdown, showBindProcessRequired, ws])

  const pause = React.useCallback(() => {
    cancelManualPlayCountdown()
    if (status === 'playing') {
      ws.send({ type: 'pause' })
    }
  }, [cancelManualPlayCountdown, status, ws])

  const togglePlayPause = React.useCallback(() => {
    if (!boundProcess) {
      showBindProcessRequired()
      return
    }
    if (status === 'playing') {
      cancelManualPlayCountdown()
      ws.send({ type: 'pause' })
    } else if (manualCountdown !== null) {
      cancelManualPlayCountdown()
    } else {
      startManualPlayCountdown()
    }
  }, [boundProcess, cancelManualPlayCountdown, manualCountdown, showBindProcessRequired, startManualPlayCountdown, status, ws])

  const stop = React.useCallback(() => {
    if (manualCountdown !== null) {
      cancelManualPlayCountdown()
      return
    }
    ws.send({ type: 'stop' })
  }, [cancelManualPlayCountdown, manualCountdown, ws])

  const play = React.useCallback(() => {
    if (manualCountdown !== null) {
      stop()
      return
    }
    startManualPlayCountdown()
  }, [manualCountdown, startManualPlayCountdown, stop])

  React.useEffect(() => {
    const devspace = (window as any).devspace
    if (!devspace?.onHotkey) return

    const unsubscribe = devspace.onHotkey((payload: any) => {
      const action = payload?.action
      if (action === 'play_pause') {
        togglePlayPause()
      } else if (action === 'stop') {
        stop()
      }
    })

    return () => {
      try {
        unsubscribe?.()
      } catch {
        // ignore
      }
    }
  }, [togglePlayPause, stop])

  const applyBind = React.useCallback(() => {
    const v = bindProcess.trim()
    ws.send({ type: 'bind_process', process: v.length ? v : null })
    saveConfig({ speed, transpose, maxPolyphony, chordMode, bindProcess: v, autoTranspose, linkLatencyMs, inputMode })
  }, [bindProcess, speed, transpose, maxPolyphony, chordMode, autoTranspose, linkLatencyMs, inputMode, ws])

  const refreshWindowsList = React.useCallback(() => {
    ws.send({ type: 'list_windows' })
  }, [ws])

  const handleScheduledTimeChange = React.useCallback((value: string) => {
    setScheduledTime(value)
  }, [])

  const schedulePlay = React.useCallback(() => {
    if (!scheduledTime) {
      setErrorMsg('请选择定时时间')
      setTimeout(() => setErrorMsg(null), 3000)
      return
    }

    if (status === 'idle') {
      setErrorMsg('请先导入 MIDI 文件')
      setTimeout(() => setErrorMsg(null), 3000)
      return
    }

    if (scheduledTimer) {
      clearTimeout(scheduledTimer)
    }

    // 点击设置定时后，启动网络延迟测量
    if (!latencyIntervalRef.current && connected) {
      ws.send({ type: 'measure_ntp_latency' })
      const interval = window.setInterval(() => {
        ws.send({ type: 'measure_ntp_latency' })
      }, 1000)
      latencyIntervalRef.current = interval
    }

    const [hours, minutes] = scheduledTime.split(':').map(Number)
    const now = new Date()
    const targetTime = new Date()
    targetTime.setHours(hours, minutes, 0, 0)

    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1)
    }

    const delayMs = targetTime.getTime() - now.getTime()

    const timer = window.setTimeout(() => {
      if (latencyIntervalRef.current) {
        clearInterval(latencyIntervalRef.current)
        latencyIntervalRef.current = null
      }
      ws.send({ type: 'play' })
      setSuccessMsg('定时演奏已开始')
      setTimeout(() => setSuccessMsg(null), 3000)
      setIsScheduled(false)
      setScheduledTimer(null)
    }, delayMs)

    setScheduledTimer(timer)
    setIsScheduled(true)
    setSuccessMsg(`已设置定时演奏，将在 ${scheduledTime} 开始`)
    setTimeout(() => setSuccessMsg(null), 5000)
  }, [scheduledTime, status, scheduledTimer, ws, connected, latencyIntervalRef])

  
  const cancelSchedule = React.useCallback(() => {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer)
      setScheduledTimer(null)
    }
    setIsScheduled(false)
    // 取消定时时停止网络延迟测量
    if (latencyIntervalRef.current) {
      clearInterval(latencyIntervalRef.current)
      latencyIntervalRef.current = null
    }
    setSuccessMsg('定时演奏已取消')
    setTimeout(() => setSuccessMsg(null), 3000)
  }, [scheduledTimer, latencyIntervalRef])

  React.useEffect(() => {
    return () => {
      cancelManualPlayCountdown()
      if (scheduledTimer) {
        clearTimeout(scheduledTimer)
      }
      if (latencyIntervalRef.current) {
        clearInterval(latencyIntervalRef.current)
        latencyIntervalRef.current = null
      }
    }
  }, [cancelManualPlayCountdown, scheduledTimer])

  const syncNtp = React.useCallback(() => {
    setNtpSyncing(true)
    ws.send({ type: 'sync_ntp' })
  }, [ws])

  const saveCurrentAsPreset = React.useCallback(() => {
    if (!presetNameInput.trim()) {
      setErrorMsg('请输入预设名称')
      setTimeout(() => setErrorMsg(null), 3000)
      return
    }
    
    const currentConfig = {
      speed,
      transpose,
      maxPolyphony,
      chordMode,
      bindProcess,
      autoTranspose,
      linkLatencyMs,
      instrument,
      inputMode,
      noteRangeLow,
      noteRangeHigh,
      preferNearestWhite,
      customKeyMap,
      selectedGameId: selectedGameId || undefined,
    }
    
    addPreset(presetNameInput.trim(), currentConfig)
    setPresets(loadPresets())
    setPresetNameInput('')
    setSuccessMsg(`预设「${presetNameInput.trim()}」已保存`)
    setTimeout(() => setSuccessMsg(null), 3000)
  }, [presetNameInput, speed, transpose, maxPolyphony, chordMode, bindProcess, autoTranspose, linkLatencyMs, instrument, inputMode, noteRangeLow, noteRangeHigh, preferNearestWhite, customKeyMap, selectedGameId])

  const loadPreset = React.useCallback((preset: Preset) => {
    const config = preset.config
    const targetProfileId = config.selectedGameId ?? selectedGameId
    const targetProfile = gameProfiles.find((profile) => profile.id === targetProfileId) || null
    const isLockedProfile = isSemitoneLockedGameProfile(targetProfile)
    if (config.speed !== undefined) setSpeed(config.speed)
    if (!isLockedProfile && config.transpose !== undefined) setTranspose(config.transpose)
    if (!isLockedProfile && config.maxPolyphony !== undefined) setMaxPolyphony(config.maxPolyphony)
    if (!isLockedProfile && config.chordMode !== undefined) setChordMode(config.chordMode)
    if (config.bindProcess !== undefined) setBindProcess(config.bindProcess)
    if (!isLockedProfile && config.autoTranspose !== undefined) setAutoTranspose(config.autoTranspose)
    if (config.linkLatencyMs !== undefined) setLinkLatencyMs(config.linkLatencyMs)
    if (config.inputMode !== undefined) setInputMode(config.inputMode)
    if (!isLockedProfile && config.noteRangeLow !== undefined) setNoteRangeLow(config.noteRangeLow)
    if (!isLockedProfile && config.noteRangeHigh !== undefined) setNoteRangeHigh(config.noteRangeHigh)
    if (!isLockedProfile && config.preferNearestWhite !== undefined) setPreferNearestWhite(config.preferNearestWhite)
    if (config.selectedGameId) {
      selectGameProfile(config.selectedGameId)
    }
    if (!isLockedProfile && config.instrument !== undefined) setInstrument(config.instrument as any)
    if (!isLockedProfile && config.customKeyMap !== undefined) {
      setCustomKeyMap(config.customKeyMap)
      setEditingKeyMap(config.customKeyMap)
    }
    
    const wsConfig = {
      speed: config.speed ?? speed,
      transpose_semitones: isLockedProfile ? transpose : (config.transpose ?? transpose),
      max_polyphony: isLockedProfile ? maxPolyphony : (config.maxPolyphony ?? maxPolyphony),
      chord_mode: isLockedProfile ? chordMode : (config.chordMode ?? chordMode),
      keep_melody_top_note: true,
      chord_cluster_window_ms: 40,
      auto_transpose: isLockedProfile ? autoTranspose : (config.autoTranspose ?? autoTranspose),
      link_latency_ms: config.linkLatencyMs ?? linkLatencyMs,
      instrument: isLockedProfile ? instrument : ((config.instrument as any) ?? instrument),
      input_mode: config.inputMode ?? inputMode,
      midi_channel_filter: ((isLockedProfile ? instrument : (config.instrument ?? instrument)) === 'drums') ? 9 : null,
      note_range_low: isLockedProfile ? noteRangeLow : (config.noteRangeLow ?? noteRangeLow),
      note_range_high: isLockedProfile ? noteRangeHigh : (config.noteRangeHigh ?? noteRangeHigh),
      prefer_nearest_white: isLockedProfile ? preferNearestWhite : (config.preferNearestWhite ?? preferNearestWhite),
      custom_key_map: isLockedProfile ? customKeyMap : (config.customKeyMap ?? customKeyMap)
    }
    ws.send({ type: 'set_config', config: wsConfig })
    saveConfig({
      speed: config.speed ?? speed,
      transpose: isLockedProfile ? transpose : (config.transpose ?? transpose),
      maxPolyphony: isLockedProfile ? maxPolyphony : (config.maxPolyphony ?? maxPolyphony),
      chordMode: isLockedProfile ? chordMode : (config.chordMode ?? chordMode),
      bindProcess: config.bindProcess ?? bindProcess,
      autoTranspose: isLockedProfile ? autoTranspose : (config.autoTranspose ?? autoTranspose),
      linkLatencyMs: config.linkLatencyMs ?? linkLatencyMs,
      inputMode: config.inputMode ?? inputMode,
      noteRangeLow: isLockedProfile ? noteRangeLow : (config.noteRangeLow ?? noteRangeLow),
      noteRangeHigh: isLockedProfile ? noteRangeHigh : (config.noteRangeHigh ?? noteRangeHigh),
      preferNearestWhite: isLockedProfile ? preferNearestWhite : (config.preferNearestWhite ?? preferNearestWhite),
      selectedGameId: config.selectedGameId ?? selectedGameId ?? undefined,
    })
    setSuccessMsg(`已加载预设「${preset.name}」`)
    setTimeout(() => setSuccessMsg(null), 3000)
  }, [speed, transpose, maxPolyphony, chordMode, bindProcess, autoTranspose, linkLatencyMs, instrument, inputMode, noteRangeLow, noteRangeHigh, preferNearestWhite, customKeyMap, selectedGameId, gameProfiles, selectGameProfile, ws])

  const handleDeletePreset = React.useCallback((presetId: string) => {
    deletePreset(presetId)
    setPresets(loadPresets())
    setSuccessMsg('预设已删除')
    setTimeout(() => setSuccessMsg(null), 3000)
  }, [])

  const selectProcess = React.useCallback((processName: string) => {
    const nextProcess = processName.trim()
    setBindProcess(nextProcess)
    setBoundProcess(nextProcess || null)
    setShowProcessSelector(false)
    ws.send({ type: 'bind_process', process: nextProcess.length ? nextProcess : null })
    saveConfig({
      speed,
      transpose,
      maxPolyphony,
      chordMode,
      bindProcess: nextProcess,
      autoTranspose,
      linkLatencyMs,
      inputMode,
    })
  }, [autoTranspose, chordMode, inputMode, linkLatencyMs, maxPolyphony, speed, transpose, ws])

  const checkAudioConverter = React.useCallback(() => {
    ws.send({ type: 'check_audio_converter' })
  }, [ws])

  const convertAudioFile = React.useCallback(async () => {
    const path = await window.devspace?.openAudioDialog?.()
    if (path) {
      setConvertedMidiPath(null)
      ws.send({ type: 'convert_audio', path })
    }
  }, [ws])

  const loadConvertedMidi = React.useCallback(() => {
    if (convertedMidiPath) {
      sendCurrentConfig()
      setTimeout(() => {
        ws.send({ type: 'load_midi', path: convertedMidiPath })
      }, 100)
    }
  }, [ws, convertedMidiPath, sendCurrentConfig])

  const selectPianoTransDirectory = React.useCallback(async () => {
    const path = await window.devspace?.openDirectoryDialog?.()
    if (path) {
      ws.send({ type: 'set_piano_trans_path', path })
    }
  }, [ws])

  const handleLocaleChange = React.useCallback((newLocale: Locale) => {
    setLocale(newLocale)
    saveConfig({ locale: newLocale })
  }, [])

  // 播放列表功能
  const addToPlaylist = React.useCallback(async () => {
    const path = await window.devspace?.openMidiDialog?.()
    if (path) {
      const fileName = path.split(/[/\\]/).pop() || path
      const newItem: PlaylistItem = {
        id: Date.now().toString(),
        path,
        name: fileName,
        addedAt: Date.now()
      }
      const newPlaylist = [...playlist, newItem]
      setPlaylist(newPlaylist)
      savePlaylist(newPlaylist)
      setSuccessMsg(`已添加: ${fileName}`)
      setTimeout(() => setSuccessMsg(null), 3000)
    }
  }, [playlist])

  const removeFromPlaylist = React.useCallback((id: string) => {
    const newPlaylist = playlist.filter(item => item.id !== id)
    setPlaylist(newPlaylist)
    savePlaylist(newPlaylist)
    if (currentPlaylistIndex >= newPlaylist.length) {
      setCurrentPlaylistIndex(newPlaylist.length - 1)
    }
  }, [playlist, currentPlaylistIndex])

  const playPlaylistItem = React.useCallback((index: number) => {
    if (index >= 0 && index < playlist.length) {
      setCurrentPlaylistIndex(index)
      sendCurrentConfig()
      setTimeout(() => {
        ws.send({ type: 'load_midi', path: playlist[index].path })
      }, 100)
    }
  }, [playlist, ws, sendCurrentConfig])

  const playNext = React.useCallback(() => {
    if (playlist.length > 0 && currentPlaylistIndex < playlist.length - 1) {
      playPlaylistItem(currentPlaylistIndex + 1)
    }
  }, [playlist, currentPlaylistIndex, playPlaylistItem])

  const playPrevious = React.useCallback(() => {
    if (playlist.length > 0 && currentPlaylistIndex > 0) {
      playPlaylistItem(currentPlaylistIndex - 1)
    }
  }, [playlist, currentPlaylistIndex, playPlaylistItem])

  const clearPlaylist = React.useCallback(() => {
    setPlaylist([])
    setCurrentPlaylistIndex(-1)
    savePlaylist([])
  }, [])

  // 曲库管理处理函数
  const importFolderToLibrary = React.useCallback(async () => {
    const devspace = (window as any).devspace
    if (!devspace?.openDirectoryDialog) {
      alert('[Error] openDirectoryDialog 不可用')
      return
    }
    const result = await devspace.openDirectoryDialog()
    if (result) {
      setScanAddedCount(0)
      ws.send({ type: 'library_scan_folder', path: result })
    }
  }, [ws])

  const cancelLibraryScan = React.useCallback(() => {
    ws.send({ type: 'library_scan_cancel' })
  }, [ws])

  // 日志导出处理函数
  const handleExportLogs = React.useCallback(async () => {
    try {
      setExportingLogs(true)
      setExportLogsResult(null)
      
      const devspace = (window as any).devspace
      if (!devspace?.saveFileDialog) {
        setExportLogsResult({ success: false, message: '保存文件对话框不可用' })
        setExportingLogs(false)
        return
      }
      
      // 打开保存文件对话框
      const outputPath = await devspace.saveFileDialog({
        title: '导出日志文件',
        defaultPath: 'backend.log',
        filters: [
          { name: '日志文件', extensions: ['log'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      
      if (!outputPath) {
        setExportingLogs(false)
        return
      }
      
      // 发送导出请求到后端
      ws.send({ type: 'export_logs', output_path: outputPath })
    } catch (error) {
      console.error('[Logs] 导出失败:', error)
      setExportLogsResult({ success: false, message: `导出失败：${error}` })
      setExportingLogs(false)
    }
  }, [ws])

  const addToPlaylistFromLibrary = React.useCallback((entry: LibraryEntry) => {
    const newItem: PlaylistItem = {
      id: Date.now().toString(),
      path: entry.path,
      name: entry.name,
      addedAt: Date.now()
    }
    const newPlaylist = [...playlist, newItem]
    setPlaylist(newPlaylist)
    savePlaylist(newPlaylist)
    setSuccessMsg(`已添加 "${entry.name}" 到播放列表`)
    setTimeout(() => setSuccessMsg(null), 3000)
  }, [playlist, setSuccessMsg])

  const playFromLibrary = React.useCallback((entry: LibraryEntry) => {
    sendCurrentConfig()
    setTimeout(() => {
      ws.send({ type: 'load_midi', path: entry.path })
    }, 100)
  }, [ws, sendCurrentConfig])

  const deleteFromLibrary = React.useCallback((entryId: string) => {
    ws.send({ type: 'library_delete', id: entryId })
  }, [ws])

  const deleteFolderFromLibrary = React.useCallback((folder: string) => {
    const count = libraryEntries.filter(e => e.folder === folder).length
    if (window.confirm(t.library.confirmDeleteFolder.replace('{count}', String(count)))) {
      ws.send({ type: 'library_delete_folder', folder })
    }
  }, [libraryEntries, ws, t])

  const clearLibrary = React.useCallback(() => {
    if (window.confirm(t.library.confirmClear)) {
      ws.send({ type: 'library_clear' })
    }
  }, [ws, t])

  const searchLibrary = React.useCallback((query: string) => {
    setLibrarySearchQuery(query)
  }, [])

  const triggerLibrarySearch = React.useCallback(() => {
    ws.send({
      type: 'library_get_page',
      offset: 0,
      limit: libraryLimit,
      folder: selectedFolder || undefined,
      query: librarySearchQuery.trim() || undefined
    })
  }, [ws, selectedFolder, librarySearchQuery])

  // 进入曲库页面时加载曲库
  React.useEffect(() => {
    if (activeMenu === 'library' && connected) {
      ws.send({ type: 'library_get_page', offset: 0, limit: libraryLimit })
    }
  }, [activeMenu, connected, ws])

  const loadMoreLibrary = React.useCallback(() => {
    const nextOffset = libraryEntries.length
    if (nextOffset >= libraryTotal) return
    ws.send({
      type: 'library_get_page',
      offset: nextOffset,
      limit: libraryLimit,
      folder: selectedFolder || undefined,
      query: librarySearchQuery || undefined
    })
  }, [libraryEntries.length, libraryTotal, ws, selectedFolder, librarySearchQuery])

  // 自定义键位映射处理
  // 编辑中的键位映射（未应用）
  const handleEditingKeyMapChange = React.useCallback((note: number, key: string) => {
    const newKeyMap = { ...editingKeyMap }
    if (key.trim() === '') {
      delete newKeyMap[note]
    } else {
      newKeyMap[note] = key.trim().toUpperCase()
    }
    setEditingKeyMap(newKeyMap)
  }, [editingKeyMap])

  // 应用键位映射设置
  const applyCustomKeyMap = React.useCallback(() => {
    setCustomKeyMap(editingKeyMap)
    saveCommonConfig({ instrument, customKeyMap: editingKeyMap })
    if (instrument === 'drums') {
      sendCurrentConfig({ instrument: 'drums', midi_channel_filter: 9, custom_key_map: editingKeyMap })
    } else if (instrument === 'microphone') {
      sendCurrentConfig({ instrument: 'microphone', midi_channel_filter: null, custom_key_map: editingKeyMap })
    } else {
      sendCurrentConfig({ instrument: 'piano', midi_channel_filter: null, custom_key_map: editingKeyMap })
    }
    setShowKeyMapEditor(false)
    setSuccessMsg(t.keyMapping.applySuccess)
    setTimeout(() => setSuccessMsg(null), 3000)
  }, [editingKeyMap, instrument, saveCommonConfig, sendCurrentConfig, t])

  const handleInstrumentChange = React.useCallback((v: 'piano' | 'drums' | 'microphone') => {
    const cfg = loadGameConfig(selectedGameId) as any

    setInstrument(v)

    let nextMap: Record<number, string>
    let midiChannelFilter: number | null = null
    let customKeyMapToSend: Record<number, string> | null | undefined

    if (v === 'drums') {
      nextMap = Object.keys(cfg.customKeyMap || {}).length ? cfg.customKeyMap : GM_DRUM_KEY_MAP
      midiChannelFilter = 9
      customKeyMapToSend = Object.keys(nextMap).length ? nextMap : {}
    } else if (v === 'microphone') {
      nextMap = Object.keys(cfg.customKeyMap || {}).length ? cfg.customKeyMap : {}
      midiChannelFilter = null
      customKeyMapToSend = Object.keys(nextMap).length ? nextMap : {}
    } else {
      nextMap = cfg.customKeyMap || {}
      midiChannelFilter = null
      customKeyMapToSend = Object.keys(nextMap).length ? nextMap : null
    }

    setEditingKeyMap(nextMap)
    setCustomKeyMap(nextMap)
    saveCommonConfig({ instrument: v, customKeyMap: nextMap, midiChannelFilter })
    setCursorMs(0)
    setProgressPercent(0)
    setActiveKeys(new Set())

    sendCurrentConfig({
      instrument: v,
      midi_channel_filter: midiChannelFilter,
      custom_key_map: customKeyMapToSend,
    })
  }, [saveCommonConfig, selectedGameId, sendCurrentConfig])

  const applyGmDrumTemplate = React.useCallback(() => {
    setInstrument('drums')
    setEditingKeyMap(GM_DRUM_KEY_MAP)
    setCustomKeyMap(GM_DRUM_KEY_MAP)
    saveCommonConfig({ instrument: 'drums', customKeyMap: GM_DRUM_KEY_MAP, midiChannelFilter: 9 })
    sendCurrentConfig({ instrument: 'drums', midi_channel_filter: 9, custom_key_map: GM_DRUM_KEY_MAP })
    setSuccessMsg('已应用 GM 架子鼓模板')
    setTimeout(() => setSuccessMsg(null), 3000)
  }, [saveCommonConfig, sendCurrentConfig])

  const resetCustomKeyMap = React.useCallback(() => {
    const emptyMap = {}
    setEditingKeyMap(emptyMap)
    setCustomKeyMap(emptyMap)
    if (instrument === 'drums') {
      saveCommonConfig({ instrument: 'drums', customKeyMap: emptyMap, midiChannelFilter: 9 })
      sendCurrentConfig({ instrument: 'drums', midi_channel_filter: 9, custom_key_map: emptyMap })
    } else if (instrument === 'microphone') {
      saveCommonConfig({ instrument: 'microphone', customKeyMap: emptyMap, midiChannelFilter: null })
      sendCurrentConfig({ instrument: 'microphone', midi_channel_filter: null, custom_key_map: emptyMap })
    } else {
      saveCommonConfig({ instrument: 'piano', customKeyMap: emptyMap, midiChannelFilter: null })
      sendCurrentConfig({ instrument: 'piano', midi_channel_filter: null, custom_key_map: null })
    }
    setSuccessMsg(t.keyMapping.resetSuccess)
    setTimeout(() => setSuccessMsg(null), 3000)
  }, [instrument, saveCommonConfig, sendCurrentConfig, t])

  const statusText = useMemo(() => {
    switch (status) {
      case 'idle':
        return connected ? t.status.idle : t.status.disconnected
      case 'loaded':
        return t.status.loaded
      case 'playing':
        return t.status.playing
      case 'paused':
        return t.status.paused
      case 'stopped':
        return t.status.stopped
      default:
        return status
    }
  }, [status, connected, t])

  const getStatusColor = () => {
    switch (status) {
      case 'playing':
        return '#10b981'
      case 'paused':
        return '#f59e0b'
      case 'loaded':
        return '#3b82f6'
      default:
        return connected ? '#6b7280' : '#ef4444'
    }
  }

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return `${min}:${sec.toString().padStart(2, '0')}`
  }

  const fitRatioLabel = preferNearestWhite ? '白键适配率' : '音域适配率'
  const rangeText = `${noteRangeLow} ~ ${noteRangeHigh}`
  const editableNotes = React.useMemo(() => {
    if (instrument === 'drums') {
      return Object.keys(customKeyMap).length
        ? Object.keys(customKeyMap).map(Number).sort((a, b) => a - b)
        : Object.keys(GM_DRUM_KEY_MAP).map(Number).sort((a, b) => a - b)
    }
    const notes: number[] = []
    for (let note = noteRangeLow; note <= noteRangeHigh; note += 1) {
      notes.push(note)
    }
    return notes
  }, [customKeyMap, instrument, noteRangeHigh, noteRangeLow])

  return (
    <div style={styles.page}>
      {errorMsg && (
        <div style={styles.errorToast}>
          <span style={styles.toastIcon}>!</span>
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div style={styles.successToast}>
          <span style={styles.toastIcon}>+</span>
          <span>{successMsg}</span>
        </div>
      )}
      {loading && (
        <div style={styles.loadingToast}>
          <span style={styles.toastIcon}>...</span>
          <span>处理中...</span>
        </div>
      )}
      
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.logoSection}>
            <div>
              <div style={styles.title}>{t.app.title}</div>
              <div style={styles.subtitle}>{t.app.subtitle}</div>
              <div style={styles.signature}>{t.app.signature}</div>
            </div>
          </div>
          <div style={styles.headerRight}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', color: '#6b7280' }}>{t.language.label}:</span>
              <select
                value={locale}
                onChange={(e) => handleLocaleChange(e.target.value as Locale)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  backgroundColor: '#ffffff',
                  color: '#374151',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <option value="zh-CN">{t.language.chinese}</option>
                <option value="en-US">{t.language.english}</option>
              </select>
            </div>
            <div style={{ ...styles.badge, backgroundColor: `${getStatusColor()}15`, borderColor: getStatusColor(), color: getStatusColor() }}>
              {statusText}
            </div>
            <div style={{ ...styles.badge, backgroundColor: isAdmin ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', borderColor: isAdmin ? '#10b981' : '#ef4444', color: isAdmin ? '#10b981' : '#ef4444' }}>
              {isAdmin ? t.status.admin : t.status.nonAdmin}
            </div>
          </div>
        </div>

        <div style={styles.topControlBar}>
          <div style={styles.topControlGroup}>
            <label style={styles.topControlLabel}>游戏配置</label>
            <select
              style={styles.topControlInput}
              value={selectedGameId || ''}
              onChange={(e) => selectGameProfile(e.target.value)}
            >
              <option value="" disabled>选择游戏配置</option>
              {gameProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </div>
          <div style={styles.topControlGroup}>
            <label style={styles.topControlLabel}>乐器模式</label>
            <select
              style={styles.topControlInput}
              value={instrument}
              onChange={(e) => handleInstrumentChange(e.target.value as any)}
              disabled={isSemitoneLockedProfile}
            >
              <option value="piano">钢琴</option>
              <option value="drums">架子鼓（Channel 10）</option>
              <option value="microphone">麦克风（15 键位）</option>
            </select>
          </div>
          <div style={styles.topControlGroup}>
            <label style={styles.topControlLabel}>发送方案</label>
            <select
              style={styles.topControlInput}
              value={inputMode}
              onChange={(e) => handleInputModeChange(e.target.value as 'sendinput' | 'message')}
            >
              <option value="sendinput">SendInput（前台演奏）</option>
              <option value="message">窗口消息（后台演奏，需管理员权限）</option>
            </select>
          </div>
          <div style={{ ...styles.topControlGroup, flex: 1.4 }}>
            <label style={styles.topControlLabel}>应用绑定</label>
            <div style={styles.topControlInline}>
              <input
                style={{ ...styles.topControlInput, flex: 1 }}
                placeholder="例如 DevSpace.exe 或 开放空间"
                value={bindProcess}
                onChange={(e) => setBindProcess(e.target.value)}
              />
              <button style={styles.btnRefresh} onClick={refreshWindowsList} disabled={!connected}>
                刷新列表
              </button>
              <button style={styles.btnSmall} onClick={applyBind} disabled={!connected}>
                应用绑定
              </button>
            </div>
            {boundProcess && (
              <div style={styles.topControlHint}>当前已绑定: {boundProcess}</div>
            )}
          </div>
        </div>

        {showProcessSelector && (
          <div style={styles.processSelectorDock}>
            <div style={styles.processSelectorHeader}>
              <span style={styles.processSelectorTitle}>选择进程</span>
              <button style={styles.btnClose} onClick={() => setShowProcessSelector(false)}>x</button>
            </div>
            <div style={styles.processList}>
              {windowsList.map((win, idx) => (
                <div
                  key={`${win.pid}-${idx}`}
                  style={styles.processItem}
                  onClick={() => selectProcess(win.name)}
                >
                  <div style={styles.processName}>{win.name}</div>
                  <div style={styles.processTitle}>{win.title || '(无标题)'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={styles.mainLayout}>
          {/* 左侧导航菜单 */}
          <div style={styles.sideNav}>
            <button
              style={{ ...styles.navItem, ...(activeMenu === 'main' ? styles.navItemActive : {}) }}
              onClick={() => setActiveMenu('main')}
            >
              主面板
            </button>
            <button
              style={{ ...styles.navItem, ...(activeMenu === 'settings' ? styles.navItemActive : {}) }}
              onClick={() => setActiveMenu('settings')}
            >
              参数设置
            </button>
            <button
              style={{ ...styles.navItem, ...(activeMenu === 'custom' ? styles.navItemActive : {}) }}
              onClick={() => setActiveMenu('custom')}
            >
              自定义映射
            </button>
            <button
              style={{ ...styles.navItem, ...(activeMenu === 'schedule' ? styles.navItemActive : {}) }}
              onClick={() => setActiveMenu('schedule')}
            >
              定时演奏
            </button>
            <button
              style={{ ...styles.navItem, ...(activeMenu === 'converter' ? styles.navItemActive : {}) }}
              onClick={() => setActiveMenu('converter')}
            >
              音频转MIDI
            </button>
            <button
              style={{ ...styles.navItem, ...(activeMenu === 'library' ? styles.navItemActive : {}) }}
              onClick={() => setActiveMenu('library')}
            >
              曲库管理
            </button>
            <button
              style={{ ...styles.navItem, ...(activeMenu === 'presets' ? styles.navItemActive : {}) }}
              onClick={() => setActiveMenu('presets')}
            >
              预设管理
            </button>
          </div>

          {/* 中间内容区域 */}
          <div style={styles.contentArea}>
            {/* 主面板 */}
            {activeMenu === 'main' && (
              <>
                {!isAdmin && (
                  <div style={styles.warningCard}>
                    <span style={styles.warningIcon}>!</span>
                    <div style={styles.warningText}>
                      <div style={styles.warningTitle}>{t.warnings.needAdminTitle}</div>
                      <div style={styles.warningDesc}>{t.warnings.needAdminDesc}</div>
                      <div style={{...styles.warningDesc, marginTop: '8px', fontWeight: 600}}>
                        右键点击程序 → "以管理员身份运行"
                        {inputMode === 'message' && '（后台演奏必须管理员权限）'}
                      </div>
                    </div>
                  </div>
                )}
                {inputMode === 'message' && isAdmin && (
                  <div style={{...styles.warningCard, borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.08)'}}>
                    <span style={{...styles.warningIcon, backgroundColor: '#f59e0b'}}>i</span>
                    <div style={styles.warningText}>
                      <div style={{...styles.warningTitle, color: '#f59e0b'}}>后台演奏模式已启用</div>
                      <div style={styles.warningDesc}>
                        请勿点击其他窗口，否则按键可能发送到错误的应用。建议将游戏窗口保持在可视范围内。
                      </div>
                    </div>
                  </div>
                )}

                <CollapsibleCard title="文件导入" defaultOpen={true}>
                  <div style={styles.btnRow}>
                    <button style={styles.btnPrimary} onClick={openAndLoadMidi} disabled={!connected}>
                      选择 MIDI 文件
                    </button>
                  </div>
                  <div style={styles.hint}>支持 .mid 和 .midi 格式</div>
                </CollapsibleCard>

                <CollapsibleCard title="播放控制" defaultOpen={true}>
                  <div style={styles.btnRow}>
                    {manualCountdown !== null ? (
                      <button style={styles.btnPrimary} onClick={stop} disabled={!connected || status === 'idle'}>
                        {`停止（${manualCountdown}）`}
                      </button>
                    ) : (
                      <>
                        <button style={styles.btnPrimary} onClick={play} disabled={!connected || status === 'idle' || status === 'playing'}>
                          演奏
                        </button>
                        <button style={styles.btn} onClick={pause} disabled={!connected || status !== 'playing'}>
                          暂停
                        </button>
                        <button style={styles.btn} onClick={stop} disabled={!connected || status === 'idle'}>
                          停止
                        </button>
                      </>
                    )}
                  </div>
                  {manualCountdown !== null ? (
                    <div style={styles.hint}>
                      将在 {manualCountdown} 秒后开始演奏，点击“停止”或使用停止热键可取消倒计时。
                    </div>
                  ) : null}
                  <div style={styles.hint}>
                    {hotkeysEnabled ? '全局热键：Ctrl+Shift+C 开始/暂停，F9 停止' : '全局热键未启用'}
                  </div>
                </CollapsibleCard>

                {/* 状态信息区域 */}
                <div style={styles.statsRow}>
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>倍速</span>
                    <span style={styles.statValue}>{speed.toFixed(2)}x</span>
                  </div>
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>移调</span>
                    <span style={styles.statValue}>{transpose >= 0 ? `+${transpose}` : transpose}</span>
                  </div>
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>并发</span>
                    <span style={styles.statValue}>{maxPolyphony}</span>
                  </div>
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>和弦</span>
                    <span style={styles.statValue}>{chordMode === 'off' ? '关闭' : chordMode === 'prefer' ? '优先' : chordMode === 'melody' ? '旋律' : '智能'}</span>
                  </div>
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>音域</span>
                    <span style={styles.statValue}>{rangeText}</span>
                  </div>
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>MIDI</span>
                    <span style={styles.statValue}>{midiPath ? '已选择' : '未选择'}</span>
                  </div>
                </div>

                {status === 'playing' && durationMs && (
                  <div style={styles.progressBar}>
                    <div style={styles.progressHeader}>
                      <span style={styles.progressLabel}>播放进度</span>
                      <div style={styles.progressTime}>
                        <span>{formatTime(cursorMs)}</span>
                        <span style={styles.progressDivider}>/</span>
                        <span>{formatTime(durationMs)}</span>
                      </div>
                    </div>
                    <div style={styles.progressTrack}>
                      <div style={{ ...styles.progressFill, width: `${progressPercent}%` }} />
                    </div>
                    <div style={styles.progressPercent}>{progressPercent.toFixed(1)}%</div>
                  </div>
                )}

                {status === 'playing' && (
            <VirtualKeyboard activeKeys={activeKeys} gameProfile={currentGameProfile} />
                )}

                <CollapsibleCard title="加载信息" defaultOpen={true}>
                  <div style={styles.panelGrid}>
                    <div style={styles.panelItem}>
                      <span style={styles.panelItemLabel}>路径</span>
                      <span style={styles.panelItemValue}>{midiPath ?? '-'}</span>
                    </div>
                    <div style={styles.panelItem}>
                      <span style={styles.panelItemLabel}>时长</span>
                      <span style={styles.panelItemValue}>{durationMs == null ? '-' : `${durationMs} ms`}</span>
                    </div>
                    <div style={styles.panelItem}>
                      <span style={styles.panelItemLabel}>音符数</span>
                      <span style={styles.panelItemValue}>{noteCount ?? '-'}</span>
                    </div>
                    <div style={styles.panelItem}>
                      <span style={styles.panelItemLabel}>按键事件</span>
                      <span style={styles.panelItemValue}>{eventCount ?? '-'}</span>
                    </div>
                    <div style={styles.panelItem}>
                      <span style={styles.panelItemLabel}>{fitRatioLabel}</span>
                      <span style={styles.panelItemValue}>{whiteKeyRatio != null ? `${whiteKeyRatio}%` : '-'}</span>
                    </div>
                    {originalWhiteKeyRatio != null && autoTransposeResult != null && (
                      <div style={styles.panelItem}>
                        <span style={styles.panelItemLabel}>原始{fitRatioLabel}</span>
                        <span style={styles.panelItemValue}>{originalWhiteKeyRatio}%</span>
                      </div>
                    )}
                  </div>
                </CollapsibleCard>

                <CollapsibleCard title="事件预览" defaultOpen={false}>
                  <div style={{ marginBottom: '12px' }}>
                    <button style={styles.btnSmall} onClick={refreshPreview} disabled={!connected || status === 'idle'}>
                      刷新
                    </button>
                  </div>
                  <div style={styles.previewBox}>
                    {preview.length === 0 ? (
                      <div style={styles.hint}>导入 MIDI 后将显示生成的 PlayEvent 预览</div>
                    ) : (
                      <div style={styles.previewList}>
                        {preview.slice(0, 200).map((e, idx) => (
                          <div key={idx} style={styles.previewRow}>
                            <span style={styles.previewT}>{String(e.t_ms).padStart(6, ' ')}</span>
                            <span style={{ ...styles.previewType, color: e.type === 'down' ? '#10b981' : '#ef4444' }}>{e.type}</span>
                            <span style={styles.previewKey}>{e.key}</span>
                            <span style={styles.previewSrc}>{e.source}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleCard>

              </>
            )}

            {/* 参数设置 */}
            {activeMenu === 'settings' && (
              <CollapsibleCard title="参数设置" defaultOpen={true}>
              <div style={styles.field}>
                <label style={styles.label}>倍速</label>
                <input
                  style={styles.input}
                  type="number"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={speed}
                  onChange={(e) => handleSpeedChange(Number(e.target.value))}
                />
              </div>
              <div style={styles.field}>
                <div style={styles.labelRow}>
                  <label style={styles.label}>整曲升降调（半音）</label>
                  <div style={styles.labelTags}>
                    {autoTransposeResult !== null && (
                      <span style={styles.autoTag}>
                        自动: {autoTransposeResult === 0 ? '已最优' : `${autoTransposeResult > 0 ? '+' : ''}${autoTransposeResult}`}
                      </span>
                    )}
                    {currentTransposeRatio !== null && (
                      <span style={styles.ratioTag}>{fitRatioLabel}: {currentTransposeRatio}%</span>
                    )}
                  </div>
                </div>
                <input
                  style={styles.input}
                  type="number"
                  min={-24}
                  max={24}
                  step={1}
                  value={transpose}
                  onChange={(e) => handleTransposeChange(Number(e.target.value))}
                  disabled={isSemitoneLockedProfile}
                />
              </div>
              <div style={styles.fieldCheckbox}>
                <label style={styles.label}>
                  <input
                    type="checkbox"
                    checked={autoTranspose}
                    onChange={(e) => handleAutoTransposeChange(e.target.checked)}
                    style={styles.checkbox}
                    disabled={isSemitoneLockedProfile}
                  />
                  <span style={styles.checkboxLabel}>启用自动移调（按当前游戏规则计算）</span>
                </label>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>最大并发音数</label>
                <input
                  style={styles.input}
                  type="number"
                  min={1}
                  max={21}
                  step={1}
                  value={maxPolyphony}
                  onChange={(e) => handleMaxPolyphonyChange(Number(e.target.value))}
                  disabled={isSemitoneLockedProfile}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>和弦处理模式</label>
                <select
                  style={styles.input}
                  value={chordMode}
                  onChange={(e) => handleChordModeChange(e.target.value)}
                  disabled={isSemitoneLockedProfile}
                >
                  <option value="off">关闭</option>
                  <option value="prefer">优先和弦</option>
                  <option value="melody">保留旋律</option>
                  <option value="smart">智能分配</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>当前游戏映射</label>
                <div style={styles.hint}>音域 {rangeText}，{preferNearestWhite ? '白键优先' : '保留黑键'}</div>
              </div>
              <div style={{ margin: '16px 0', borderTop: '1px solid #e5e7eb' }} />
              <div style={styles.field}>
                <label style={styles.label}>保存为预设</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    type="text"
                    placeholder="输入预设名称"
                    value={presetNameInput}
                    onChange={(e) => setPresetNameInput(e.target.value)}
                  />
                  <button
                    style={styles.btnSmall}
                    onClick={saveCurrentAsPreset}
                  >
                    保存
                  </button>
                </div>
              </div>
              {presets.length > 0 && (
                <div style={styles.field}>
                  <label style={styles.label}>预设列表</label>
                  <div style={{ maxHeight: '200px', overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                    {presets.map((preset) => (
                      <div
                        key={preset.id}
                        style={{
                          padding: '10px 12px',
                          borderBottom: '1px solid #f3f4f6',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer'
                        }}
                        onClick={() => loadPreset(preset)}
                      >
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: '#1f2937' }}>
                            {preset.name}
                          </div>
                          <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                            {new Date(preset.createdAt).toLocaleString('zh-CN')}
                          </div>
                        </div>
                        <button
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            backgroundColor: '#fee2e2',
                            border: '1px solid #fecaca',
                            color: '#991b1b',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeletePreset(preset.id)
                          }}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* 日志导出 */}
              <div style={{ margin: '24px 0 0 0', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
                <div style={styles.field}>
                  <label style={styles.label}>日志导出</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      style={styles.btn}
                      onClick={handleExportLogs}
                    >
                      导出日志文件
                    </button>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>
                      将日志导出到指定位置，方便反馈问题
                    </span>
                  </div>
                  {exportingLogs && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#3b82f6' }}>
                      正在导出日志...
                    </div>
                  )}
                  {exportLogsResult && (
                    <div style={{ 
                      marginTop: '8px', 
                      fontSize: '12px', 
                      color: exportLogsResult.success ? '#059669' : '#dc2626' 
                    }}>
                      {exportLogsResult.message}
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleCard>
            )}

            {activeMenu === 'custom' && (
              <CollapsibleCard title="自定义映射" defaultOpen={true}>
                <div style={styles.field}>
                  <div style={styles.labelRow}>
                    <label style={styles.label}>音域适配模式</label>
                  </div>
                  <select
                    style={styles.input}
                    value={preferNearestWhite ? 'white' : 'chromatic'}
                    onChange={(e) => handlePreferNearestWhiteChange(e.target.value === 'white')}
                    disabled={instrument === 'drums' || isSemitoneLockedProfile}
                  >
                    <option value="white">白键优先</option>
                    <option value="chromatic">保留黑键</option>
                  </select>
                </div>

                {instrument !== 'drums' && (
                  <>
                    <div style={styles.panelGrid}>
                      <div style={styles.field}>
                        <label style={styles.label}>最低音</label>
                        <input
                          style={styles.input}
                          type="number"
                          min={0}
                          max={127}
                          step={1}
                          value={noteRangeLow}
                          onChange={(e) => handleNoteRangeLowChange(Number(e.target.value))}
                          disabled={isSemitoneLockedProfile}
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>最高音</label>
                        <input
                          style={styles.input}
                          type="number"
                          min={0}
                          max={127}
                          step={1}
                          value={noteRangeHigh}
                          onChange={(e) => handleNoteRangeHighChange(Number(e.target.value))}
                          disabled={instrument === 'microphone' || isSemitoneLockedProfile}
                        />
                      </div>
                    </div>
                  </>
                )}

                <div style={{ margin: '16px 0', borderTop: '1px solid #e5e7eb' }} />

                <div style={styles.field}>
                  <div style={styles.labelRow}>
                    <label style={styles.label}>{t.keyMapping.title}</label>
                    <button
                      style={styles.btnSmall}
                      onClick={() => setShowKeyMapEditor(!showKeyMapEditor)}
                      disabled={isSemitoneLockedProfile}
                    >
                      {showKeyMapEditor ? t.keyMapping.collapse : t.keyMapping.expand}
                    </button>
                  </div>
                </div>

                {showKeyMapEditor && !isSemitoneLockedProfile && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{
                      padding: '12px',
                      backgroundColor: '#f9fafb',
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb',
                      marginBottom: '12px'
                    }}>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
                        默认参考映射
                      </div>
                      <div style={{ fontSize: '12px', fontFamily: 'ui-monospace, monospace', color: '#374151', lineHeight: '1.6' }}>
                        {currentGameProfile?.name || '当前配置'}
                      </div>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                      gap: '8px',
                      maxHeight: '360px',
                      overflow: 'auto',
                      padding: '8px',
                      backgroundColor: '#ffffff',
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb'
                    }}>
                      {editableNotes.map((note) => {
                        const defaultKey = String(currentGameProfile?.custom_key_map?.[note] ?? '')
                        return (
                          <div key={note} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', color: '#6b7280' }}>
                              {noteNumberToName(note)} ({note})
                            </label>
                            <input
                              style={{ ...styles.input, padding: '6px 8px', fontSize: '12px' }}
                              type="text"
                              maxLength={20}
                              placeholder={defaultKey}
                              value={editingKeyMap[note] || ''}
                              onChange={(e) => handleEditingKeyMapChange(note, e.target.value)}
                            />
                          </div>
                        )
                      })}
                    </div>

                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        style={{ ...styles.btnPrimary, fontSize: '12px', padding: '6px 16px' }}
                        onClick={applyCustomKeyMap}
                      >
                        {t.keyMapping.apply}
                      </button>
                      {instrument === 'drums' && (
                        <button
                          style={{ ...styles.btn, fontSize: '12px', padding: '6px 12px' }}
                          onClick={applyGmDrumTemplate}
                        >
                          应用 GM 架子鼓模板
                        </button>
                      )}
                      <button
                        style={{ ...styles.btn, fontSize: '12px', padding: '6px 12px' }}
                        onClick={resetCustomKeyMap}
                      >
                        {t.keyMapping.reset}
                      </button>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>
                        {t.keyMapping.customized.replace('{count}', String(Object.keys(customKeyMap).length))}
                      </span>
                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                        支持组合键，例如 `SHIFT+Q`、`CTRL+Z`
                      </span>
                    </div>
                  </div>
                )}
              </CollapsibleCard>
            )}

            {/* 定时演奏 */}
            {activeMenu === 'schedule' && (
            <CollapsibleCard title="定时演奏" defaultOpen={true}>
              <div style={styles.field}>
                <label style={styles.label}>链路延迟（毫秒）</label>
                <input
                  style={styles.input}
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={linkLatencyMs}
                  onChange={(e) => handleLinkLatencyChange(Number(e.target.value))}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>网络延迟（毫秒）</label>
                <div style={{ 
                  ...styles.input, 
                  backgroundColor: networkLatency === -1 ? '#fee2e2' : '#f9fafb', 
                  color: networkLatency === -1 ? '#991b1b' : '#6b7280', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between' 
                }}>
                  <span>
                    {networkLatency > 0 
                      ? `${networkLatency} ms` 
                      : networkLatency === -1 
                        ? '测量失败' 
                        : '测量中...'}
                  </span>
                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                    {ntpServer || 'HTTP服务器'}
                  </span>
                </div>
              </div>
              <div style={styles.fieldCheckbox}>
                <label style={styles.label}>
                  <input
                    type="checkbox"
                    checked={enableDynamicCompensation}
                    onChange={(e) => handleDynamicCompensationChange(e.target.checked)}
                    style={styles.checkbox}
                  />
                  <span style={styles.checkboxLabel}>启用网络延迟动态补偿</span>
                </label>
              </div>
              <div style={{ 
                padding: '12px', 
                backgroundColor: networkLatency === -1 ? '#fef3c7' : '#f0f9ff', 
                borderRadius: '8px', 
                border: `1px solid ${networkLatency === -1 ? '#f59e0b' : '#bfdbfe'}`, 
                marginBottom: '12px' 
              }}>
                <div style={{ fontSize: '13px', color: networkLatency === -1 ? '#92400e' : '#1e40af' }}>
                  <strong>总补偿延迟: </strong>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '14px', fontWeight: 600 }}>
                    {calculateTotalLatency()} ms
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: networkLatency === -1 ? '#b45309' : '#3b82f6', marginTop: '4px' }}>
                  {enableDynamicCompensation 
                    ? networkLatency > 0 
                      ? `链路延迟 ${linkLatencyMs} ms + 网络延迟 ${networkLatency} ms`
                      : networkLatency === -1
                        ? `链路延迟 ${linkLatencyMs} ms（网络延迟测量失败，未计入）`
                        : `链路延迟 ${linkLatencyMs} ms（网络延迟测量中...）`
                    : `仅使用链路延迟 ${linkLatencyMs} ms`
                  }
                </div>
              </div>
              <div style={styles.hint}>链路延迟用于补偿演奏时序，网络延迟自动测量精确到毫秒级</div>
              <div style={{ margin: '16px 0', borderTop: '1px solid #e5e7eb' }} />
              <div style={styles.field}>
                <label style={styles.label}>NTP 时间同步</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    style={{ ...styles.btnSmall, flex: 1 }}
                    onClick={syncNtp}
                    disabled={!connected || ntpSyncing}
                  >
                    {ntpSyncing ? '同步中...' : '同步时间'}
                  </button>
                </div>
              </div>
              {ntpInfo && (
                <div style={{ 
                  padding: '12px', 
                  backgroundColor: ntpInfo.success ? '#d1fae5' : '#fee2e2', 
                  borderRadius: '8px', 
                  border: `1px solid ${ntpInfo.success ? '#10b981' : '#fecaca'}`,
                  marginBottom: '12px'
                }}>
                  <div style={{ fontSize: '13px', color: ntpInfo.success ? '#065f46' : '#991b1b', fontWeight: 600 }}>
                    {ntpInfo.success ? '同步成功' : '同步失败'}
                  </div>
                  {ntpInfo.success && (
                    <>
                      <div style={{ fontSize: '12px', color: ntpInfo.success ? '#065f46' : '#991b1b', marginTop: '4px' }}>
                        服务器: {ntpInfo.server}
                      </div>
                      <div style={{ fontSize: '12px', color: ntpInfo.success ? '#065f46' : '#991b1b', marginTop: '2px' }}>
                        时钟偏移: <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{ntpInfo.offset_ms?.toFixed(2)} ms</span>
                      </div>
                    </>
                  )}
                  {!ntpInfo.success && ntpInfo.message && (
                    <div style={{ fontSize: '12px', color: '#991b1b', marginTop: '4px' }}>
                      {ntpInfo.message}
                    </div>
                  )}
                </div>
              )}
              <div style={styles.hint}>使用国内 NTP 服务器同步系统时间，确保精确的定时演奏</div>
              <div style={{ margin: '16px 0', borderTop: '1px solid #e5e7eb' }} />
              <div style={styles.field}>
                <label style={styles.label}>定时时间</label>
                <input
                  style={styles.input}
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => handleScheduledTimeChange(e.target.value)}
                  disabled={isScheduled}
                />
              </div>
              {isScheduled ? (
                <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#d1fae5', borderRadius: '8px', border: '1px solid #10b981', color: '#065f46' }}>
                  <span style={{ fontWeight: 600 }}>定时已设置</span>
                  <div style={{ fontSize: '13px', marginTop: '4px' }}>将在 {scheduledTime} 开始演奏</div>
                </div>
              ) : null}
              <div style={styles.btnRow}>
                {!isScheduled ? (
                  <button
                    style={styles.btnPrimary}
                    onClick={schedulePlay}
                    disabled={!connected || status === 'idle'}
                  >
                    设置定时
                  </button>
                ) : (
                  <button
                    style={{ ...styles.btn, backgroundColor: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}
                    onClick={cancelSchedule}
                  >
                    取消定时
                  </button>
                )}
              </div>
              <div style={styles.hint}>请先导入 MIDI 文件，然后设置定时时间</div>
            </CollapsibleCard>
            )}

            {/* 音频转 MIDI */}
            {activeMenu === 'converter' && (
            <CollapsibleCard title={t.audioConverter.title} defaultOpen={true}>
              <div style={styles.field}>
                <div style={{ 
                  padding: '12px', 
                  borderRadius: '8px', 
                  backgroundColor: audioConverterAvailable ? '#d1fae5' : '#fee2e2', 
                  border: `1px solid ${audioConverterAvailable ? '#10b981' : '#fecaca'}`,
                  marginBottom: '12px'
                }}>
                  <div style={{ 
                    fontSize: '13px', 
                    color: audioConverterAvailable ? '#065f46' : '#991b1b',
                    fontWeight: 600 
                  }}>
                    {audioConverterAvailable ? t.audioConverter.available : t.audioConverter.notAvailable}
                  </div>
                  {pianoTransPath && (
                    <div style={{ fontSize: '12px', color: audioConverterAvailable ? '#065f46' : '#991b1b', marginTop: '4px' }}>
                      {t.audioConverter.currentPath}: {pianoTransPath}
                    </div>
                  )}
                  {audioConverterAvailable && supportedFormats.length > 0 && (
                    <div style={{ fontSize: '12px', color: '#065f46', marginTop: '4px' }}>
                      {t.audioConverter.supportedFormats}: {supportedFormats.join(', ')}
                    </div>
                  )}
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>{t.audioConverter.selectDirectory}</label>
                <div style={styles.btnRow}>
                  <button
                    style={{ ...styles.btn, flex: 1 }}
                    onClick={selectPianoTransDirectory}
                    disabled={!connected}
                  >
                    {t.audioConverter.selectDirectory}
                  </button>
                </div>
              </div>
              <div style={{ margin: '16px 0', borderTop: '1px solid #e5e7eb' }} />
              <div style={styles.field}>
                <div style={styles.btnRow}>
                  <button
                    style={{ ...styles.btnPrimary, flex: 1 }}
                    onClick={convertAudioFile}
                    disabled={!connected || !audioConverterAvailable || audioConverting}
                  >
                    {audioConverting ? t.audioConverter.converting : t.audioConverter.selectAudio}
                  </button>
                </div>
              </div>
              {audioConverting && (
                <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#dbeafe', borderRadius: '8px', border: '1px solid #3b82f6', color: '#1e40af', textAlign: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{t.audioConverter.converting}</span>
                </div>
              )}
              {convertedMidiPath && (
                <>
                  <div style={styles.field}>
                    <label style={styles.label}>转换结果</label>
                    <div style={{ padding: '12px', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                      <div style={{ fontSize: '13px', color: '#374151', marginBottom: '4px' }}>
                        MIDI: <strong>{convertedMidiPath}</strong>
                      </div>
                    </div>
                  </div>
                  <div style={styles.btnRow}>
                    <button
                      style={styles.btnPrimary}
                      onClick={loadConvertedMidi}
                      disabled={!connected}
                    >
                      {t.audioConverter.loadMidi}
                    </button>
                  </div>
                </>
              )}
              <div style={styles.hint}>{t.audioConverter.hint}</div>
            </CollapsibleCard>
            )}

            {/* 曲库管理 */}
            {activeMenu === 'library' && (
              <CollapsibleCard title={t.library.title} defaultOpen={true}>
                {/* 工具栏 */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <button
                    style={styles.btnPrimary}
                    onClick={importFolderToLibrary}
                    disabled={libraryScanning || !connected}
                  >
                    {libraryScanning ? t.library.scanning : t.library.importFolder}
                  </button>
                  <button
                    style={styles.btn}
                    onClick={clearLibrary}
                    disabled={libraryEntries.length === 0}
                  >
                    {t.library.clear}
                  </button>
                </div>
                
                {/* 扫描进度 */}
                {libraryScanning && scanProgress && (
                  <div style={{ 
                    padding: '12px', 
                    backgroundColor: '#eff6ff', 
                    borderRadius: '8px', 
                    marginBottom: '16px',
                    border: '1px solid #bfdbfe'
                  }}>
                    <div style={{ fontSize: '14px', color: '#1e40af', marginBottom: '8px' }}>
                      {t.library.scanProgress}: {scanProgress.current} / {scanProgress.total}
                    </div>
                    <div style={{ fontSize: '12px', color: '#1e40af', marginBottom: '8px' }}>
                      新增: {scanAddedCount}
                    </div>
                    <div style={{ 
                      height: '8px', 
                      backgroundColor: '#dbeafe', 
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}>
                      <div style={{ 
                        height: '100%', 
                        width: `${(scanProgress.current / Math.max(scanProgress.total, 1)) * 100}%`,
                        backgroundColor: '#3b82f6',
                        transition: 'width 0.3s'
                      }} />
                    </div>
                    {scanProgress.name && (
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                        {scanProgress.name}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                      <button
                        style={{ ...styles.btnSmall, color: '#ef4444' }}
                        onClick={cancelLibraryScan}
                        disabled={!connected}
                      >
                        取消扫描
                      </button>
                    </div>
                  </div>
                )}
                
                {/* 搜索框 */}
                <div style={styles.field}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      type="text"
                      placeholder={t.library.searchPlaceholder}
                      value={librarySearchQuery}
                      onChange={(e) => searchLibrary(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          triggerLibrarySearch()
                        }
                      }}
                    />
                    <button
                      style={styles.btn}
                      onClick={triggerLibrarySearch}
                      disabled={!connected}
                    >
                      搜索
                    </button>
                  </div>
                </div>
                
                {/* 文件夹筛选 */}
                {libraryFolders.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <button
                      style={{ 
                        ...styles.btnSmall, 
                        backgroundColor: selectedFolder === '' ? '#3b82f6' : '#f3f4f6',
                        color: selectedFolder === '' ? '#fff' : '#374151'
                      }}
                      onClick={() => {
                        setSelectedFolder('')
                        ws.send({ type: 'library_get_page', offset: 0, limit: libraryLimit })
                      }}
                    >
                      {t.library.allTracks} ({libraryTotal})
                    </button>
                    {libraryFolders.map(folder => (
                      <button
                        key={folder}
                        style={{ 
                          ...styles.btnSmall, 
                          backgroundColor: selectedFolder === folder ? '#3b82f6' : '#f3f4f6',
                          color: selectedFolder === folder ? '#fff' : '#374151'
                        }}
                        onClick={() => {
                          setSelectedFolder(folder)
                          ws.send({ type: 'library_get_page', offset: 0, limit: libraryLimit, folder })
                        }}
                      >
                        {folder}
                      </button>
                    ))}
                  </div>
                )}
                
                {/* 曲库列表 */}
                {libraryEntries.length === 0 ? (
                  <div style={{ 
                    padding: '40px', 
                    textAlign: 'center', 
                    color: '#6b7280',
                    backgroundColor: '#f9fafb',
                    borderRadius: '8px'
                  }}>
                    {t.library.empty}
                  </div>
                ) : (
                  <div style={{ maxHeight: '500px', overflow: 'auto' }}>
                    {libraryEntries.map(entry => (
                      <div
                        key={entry.id}
                        style={{
                          padding: '12px',
                          borderBottom: '1px solid #e5e7eb',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          backgroundColor: midiPath === entry.path ? '#f0fdf4' : 'transparent'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.name}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6b7280', display: 'flex', gap: '12px' }}>
                            <span>{entry.folder}</span>
                            <span>{Math.round(entry.duration_ms / 1000)}s</span>
                            <span>{entry.notes} notes</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            style={styles.btnSmall}
                            onClick={() => playFromLibrary(entry)}
                            title={t.library.playNow}
                          >
                            ▶
                          </button>
                          <button
                            style={styles.btnSmall}
                            onClick={() => addToPlaylistFromLibrary(entry)}
                            title={t.library.addToPlaylist}
                          >
                            +
                          </button>
                          <button
                            style={{ ...styles.btnSmall, color: '#ef4444' }}
                            onClick={() => {
                              if (window.confirm(t.library.confirmDelete)) {
                                deleteFromLibrary(entry.id)
                              }
                            }}
                            title={t.library.delete}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {libraryEntries.length > 0 && libraryEntries.length < libraryTotal && (
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center' }}>
                    <button style={styles.btn} onClick={loadMoreLibrary} disabled={!connected}>
                      加载更多（{libraryEntries.length}/{libraryTotal}）
                    </button>
                  </div>
                )}
                
                {/* 统计信息 */}
                {libraryEntries.length > 0 && (
                  <div style={{ 
                    marginTop: '12px', 
                    fontSize: '12px', 
                    color: '#6b7280',
                    textAlign: 'right'
                  }}>
                    {t.library.trackCount.replace('{count}', String(libraryTotal || libraryEntries.length))}
                  </div>
                )}
              </CollapsibleCard>
            )}

            {/* 预设管理 */}
            {activeMenu === 'presets' && (
              <CollapsibleCard title="预设管理" defaultOpen={true}>
                <div style={styles.field}>
                  <label style={styles.label}>保存为预设</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      type="text"
                      placeholder="输入预设名称"
                      value={presetNameInput}
                      onChange={(e) => setPresetNameInput(e.target.value)}
                    />
                    <button
                      style={styles.btnSmall}
                      onClick={saveCurrentAsPreset}
                    >
                      保存
                    </button>
                  </div>
                </div>
                {presets.length > 0 && (
                  <div style={styles.field}>
                    <label style={styles.label}>预设列表</label>
                    <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                      {presets.map((preset) => (
                        <div
                          key={preset.id}
                          style={{
                            padding: '10px 12px',
                            borderBottom: '1px solid #f3f4f6',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer'
                          }}
                          onClick={() => loadPreset(preset)}
                        >
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1f2937' }}>
                              {preset.name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                              {new Date(preset.createdAt).toLocaleString('zh-CN')}
                            </div>
                          </div>
                          <button
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              backgroundColor: '#fee2e2',
                              border: '1px solid #fecaca',
                              color: '#991b1b',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeletePreset(preset.id)
                            }}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CollapsibleCard>
            )}
          </div>

          {/* 右侧播放列表侧边栏 */}
          <div style={{
            ...styles.playlistSidebar,
            width: showPlaylist ? '280px' : '48px',
            transition: 'width 0.3s ease'
          }}>
            <div style={styles.playlistToggle} onClick={() => setShowPlaylist(!showPlaylist)}>
              <span style={{ transform: showPlaylist ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>&lt;</span>
              <span style={{ writingMode: showPlaylist ? 'horizontal-tb' : 'vertical-rl', textOrientation: 'mixed' }}>
                {showPlaylist ? t.playlist.collapse : t.playlist.title}
              </span>
            </div>
            {showPlaylist && (
              <div style={styles.playlistContent}>
                <div style={styles.playlistHeader}>
                  <span style={styles.playlistTitle}>{t.playlist.title}</span>
                  <span style={styles.playlistCount}>({playlist.length})</span>
                </div>
                <div style={styles.playlistControls}>
                  <button style={styles.playlistBtn} onClick={addToPlaylist} disabled={!connected}>
                    + {t.playlist.add}
                  </button>
                  <button style={styles.playlistBtn} onClick={clearPlaylist} disabled={playlist.length === 0}>
                    {t.playlist.clear}
                  </button>
                </div>
                <div style={styles.playlistItems}>
                  {playlist.length === 0 ? (
                    <div style={styles.playlistEmpty}>{t.playlist.noFiles}</div>
                  ) : (
                    playlist.map((item, index) => (
                      <div
                        key={item.id}
                        style={{
                          ...styles.playlistItem,
                          backgroundColor: index === currentPlaylistIndex ? '#dbeafe' : 'transparent',
                          borderColor: index === currentPlaylistIndex ? '#3b82f6' : 'transparent'
                        }}
                        onClick={() => playPlaylistItem(index)}
                      >
                        <div style={styles.playlistItemIndex}>{index + 1}</div>
                        <div style={styles.playlistItemName}>{item.name}</div>
                        <button
                          style={styles.playlistItemRemove}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeFromPlaylist(item.id)
                          }}
                        >
                          x
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {playlist.length > 0 && (
                  <div style={styles.playlistNav}>
                    <button
                      style={styles.playlistNavBtn}
                      onClick={playPrevious}
                      disabled={currentPlaylistIndex <= 0}
                    >
                      &lt; 上一首
                    </button>
                    <button
                      style={styles.playlistNavBtn}
                      onClick={playNext}
                      disabled={currentPlaylistIndex >= playlist.length - 1}
                    >
                      下一首 &gt;
                    </button>
                  </div>
                )}
                <div style={styles.playlistAutoPlay}>
                  <label style={styles.label}>
                    <input
                      type="checkbox"
                      checked={autoPlayNext}
                      onChange={(e) => setAutoPlayNext(e.target.checked)}
                      style={styles.checkbox}
                    />
                    <span style={styles.checkboxLabel}>自动播放下一首</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    padding: '24px',
    boxSizing: 'border-box',
    backgroundColor: '#f5f7fa',
    color: '#1f2937',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  },
  container: {
    maxWidth: '100%',
    margin: '0 auto'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
    padding: '20px 24px',
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e5e7eb'
  },
  logoSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#111827'
  },
  subtitle: {
    fontSize: '14px',
    color: '#6b7280',
    marginTop: '4px'
  },
  signature: {
    fontSize: '11px',
    color: '#9ca3af',
    marginTop: '2px',
    fontStyle: 'italic'
  },
  headerRight: {
    display: 'flex',
    gap: '12px'
  },
  badge: {
    padding: '8px 16px',
    borderRadius: '20px',
    border: '2px solid',
    fontSize: '14px',
    fontWeight: 600
  },
  topControlBar: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    marginBottom: '16px',
    padding: '16px 20px',
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e5e7eb'
  },
  topControlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: '220px'
  },
  topControlLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#374151'
  },
  topControlInput: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#111827',
    fontSize: '14px',
    outline: 'none'
  },
  topControlInline: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  topControlHint: {
    fontSize: '12px',
    color: '#6b7280'
  },
  processSelectorDock: {
    marginBottom: '16px',
    borderRadius: '12px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    overflow: 'hidden'
  },
  mainLayout: {
    display: 'grid',
    gridTemplateColumns: '200px 1fr auto',
    gap: '24px'
  },
  sideNav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  navItem: {
    padding: '12px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    color: '#4b5563',
    backgroundColor: 'transparent',
    border: 'none',
    textAlign: 'left' as const,
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  navItemActive: {
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    fontWeight: 600
  },
  contentArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minWidth: '0'
  },
  warningCard: {
    padding: '16px',
    borderRadius: '12px',
    backgroundColor: '#fef3c7',
    border: '1px solid #f59e0b',
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start'
  },
  warningIcon: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: '#f59e0b',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '14px'
  },
  warningText: {
    flex: 1
  },
  warningTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#92400e'
  },
  warningDesc: {
    fontSize: '13px',
    color: '#b45309',
    marginTop: '4px'
  },
  card: {
    borderRadius: '12px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    overflow: 'hidden'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    cursor: 'pointer',
    backgroundColor: '#fafafa',
    borderBottom: '1px solid #e5e7eb',
    transition: 'background-color 0.2s'
  },
  cardTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#374151'
  },
  chevron: {
    fontSize: '12px',
    color: '#6b7280',
    transition: 'transform 0.2s'
  },
  cardContent: {
    padding: '20px'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '16px'
  },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151'
  },
  labelTags: {
    display: 'flex',
    gap: '8px'
  },
  autoTag: {
    fontSize: '12px',
    padding: '2px 8px',
    borderRadius: '4px',
    backgroundColor: '#dbeafe',
    color: '#1e40af',
    fontWeight: 600
  },
  ratioTag: {
    fontSize: '12px',
    padding: '2px 8px',
    borderRadius: '4px',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    fontWeight: 600
  },
  input: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#111827',
    fontSize: '14px',
    outline: 'none'
  },
  btnRefresh: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#374151',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer'
  },
  boundStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    borderRadius: '6px',
    backgroundColor: '#d1fae5',
    border: '1px solid #10b981',
    color: '#065f46',
    fontSize: '13px',
    marginTop: '8px'
  },
  boundIcon: {
    fontWeight: 700
  },
  processSelector: {
    marginBottom: '16px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    overflow: 'hidden'
  },
  processSelectorHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#f9fafb',
    borderBottom: '1px solid #e5e7eb'
  },
  processSelectorTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151'
  },
  btnClose: {
    padding: '2px 8px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    fontSize: '16px',
    cursor: 'pointer'
  },
  processList: {
    maxHeight: '200px',
    overflow: 'auto'
  },
  processItem: {
    padding: '12px 16px',
    borderBottom: '1px solid #f3f4f6',
    cursor: 'pointer'
  },
  processName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#111827'
  },
  processTitle: {
    fontSize: '12px',
    color: '#6b7280',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  btnRow: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '10px',
    marginTop: '12px'
  },
  btnPrimary: {
    padding: '12px 20px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#6366f1',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btn: {
    padding: '12px 20px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#374151',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer'
  },
  hint: {
    marginTop: '12px',
    fontSize: '13px',
    color: '#6b7280'
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '12px'
  },
  statItem: {
    padding: '16px',
    borderRadius: '12px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px'
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280'
  },
  statValue: {
    fontSize: '16px',
    color: '#111827',
    fontWeight: 600
  },
  progressBar: {
    padding: '20px',
    borderRadius: '12px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb'
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  progressLabel: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151'
  },
  progressTime: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#111827',
    fontFamily: 'ui-monospace, monospace'
  },
  progressDivider: {
    color: '#9ca3af',
    margin: '0 6px'
  },
  progressTrack: {
    height: '8px',
    borderRadius: '4px',
    backgroundColor: '#e5e7eb',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    transition: 'width 0.1s linear'
  },
  progressPercent: {
    textAlign: 'right',
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '8px'
  },
  panelGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px'
  },
  panelItem: {
    padding: '12px 16px',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  panelItemLabel: {
    fontSize: '13px',
    color: '#6b7280'
  },
  panelItemValue: {
    fontSize: '13px',
    color: '#111827',
    fontWeight: 500,
    maxWidth: '60%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  btnSmall: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#374151',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer'
  },
  previewBox: {
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
    maxHeight: '280px',
    overflow: 'auto'
  },
  previewList: {
    padding: '12px'
  },
  previewRow: {
    display: 'grid',
    gridTemplateColumns: '70px 60px 50px 1fr',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: '6px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    marginBottom: '6px'
  },
  previewT: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '12px',
    color: '#6b7280'
  },
  previewType: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '12px',
    fontWeight: 600
  },
  previewKey: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '12px',
    fontWeight: 600,
    color: '#6366f1'
  },
  previewSrc: {
    fontSize: '12px',
    color: '#9ca3af'
  },
  fieldCheckbox: {
    marginBottom: '16px'
  },
  checkbox: {
    marginRight: '10px',
    width: '16px',
    height: '16px'
  },
  checkboxLabel: {
    fontSize: '14px',
    color: '#374151'
  },
  errorToast: {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 20px',
    borderRadius: '8px',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    fontWeight: 600,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  successToast: {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 20px',
    borderRadius: '8px',
    backgroundColor: '#d1fae5',
    border: '1px solid #a7f3d0',
    color: '#065f46',
    fontWeight: 600,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  loadingToast: {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 20px',
    borderRadius: '8px',
    backgroundColor: '#dbeafe',
    border: '1px solid #bfdbfe',
    color: '#1e40af',
    fontWeight: 600,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  toastIcon: {
    fontWeight: 700
  },
  // 播放列表侧边栏样式
  playlistSidebar: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  playlistToggle: {
    padding: '12px',
    backgroundColor: '#fafafa',
    borderBottom: '1px solid #e5e7eb',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151'
  },
  playlistContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  playlistHeader: {
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  playlistTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151'
  },
  playlistCount: {
    fontSize: '12px',
    color: '#9ca3af'
  },
  playlistControls: {
    padding: '12px 16px',
    display: 'flex',
    gap: '8px'
  },
  playlistBtn: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#374151',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer'
  },
  playlistItems: {
    flex: 1,
    overflow: 'auto',
    padding: '8px'
  },
  playlistEmpty: {
    padding: '24px',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '13px'
  },
  playlistItem: {
    padding: '10px 12px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    marginBottom: '4px',
    border: '1px solid transparent'
  },
  playlistItemIndex: {
    fontSize: '12px',
    color: '#9ca3af',
    width: '20px',
    textAlign: 'center' as const
  },
  playlistItemName: {
    flex: 1,
    fontSize: '13px',
    color: '#374151',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  playlistItemRemove: {
    padding: '2px 6px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#9ca3af',
    fontSize: '12px',
    cursor: 'pointer'
  },
  playlistNav: {
    padding: '12px 16px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    gap: '8px'
  },
  playlistNavBtn: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#374151',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer'
  },
  playlistAutoPlay: {
    padding: '12px 16px',
    borderTop: '1px solid #e5e7eb'
  }
}
