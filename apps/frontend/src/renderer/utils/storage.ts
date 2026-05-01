export interface AppConfig {
  speed: number
  transpose: number
  maxPolyphony: number
  chordMode: string
  bindProcess: string
  autoTranspose: boolean
  linkLatencyMs: number
  locale?: string
  pianoTransPath?: string
  customKeyMap?: Record<number, string>  // 自定义键位映射 {note: key}
  instrument?: 'piano' | 'drums' | 'microphone'
  inputMode?: 'sendinput' | 'message'
  midiChannelFilter?: number | null
  noteRangeLow?: number
  noteRangeHigh?: number
  preferNearestWhite?: boolean
  pianoKeyMap?: Record<number, string>
  drumKeyMap?: Record<number, string>
  microphoneKeyMap?: Record<number, string>
  selectedGameId?: string
  gameConfigs?: Record<string, Partial<AppConfig>>
}

export interface Preset {
  id: string
  name: string
  config: Partial<AppConfig>
  createdAt: number
}

/**
 * 播放列表项
 */
export interface PlaylistItem {
  id: string
  path: string
  name: string
  addedAt: number
}

const STORAGE_KEY = 'devspace-autoplayer-config'
const PRESETS_KEY = 'devspace-autoplayer-presets'
const PLAYLIST_KEY = 'devspace-autoplayer-playlist'

export function loadConfig(): Partial<AppConfig> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return {}
    return JSON.parse(stored) as Partial<AppConfig>
  } catch {
    return {}
  }
}

export function saveConfig(config: Partial<AppConfig>): void {
  try {
    const existing = loadConfig()
    const merged = { ...existing, ...config }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    console.log('保存配置到 localStorage:', merged)
  } catch (e) {
    console.error('保存配置失败:', e)
  }
}

export function loadSelectedGameId(): string | null {
  return loadConfig().selectedGameId || null
}

export function saveSelectedGameId(gameId: string): void {
  saveConfig({ selectedGameId: gameId })
}

export function loadGameConfig(gameId: string | null | undefined): Partial<AppConfig> {
  if (!gameId) return {}
  const root = loadConfig()
  return root.gameConfigs?.[gameId] || {}
}

export function saveGameConfig(gameId: string, config: Partial<AppConfig>): void {
  const root = loadConfig()
  const existing = root.gameConfigs || {}
  const current = existing[gameId] || {}
  saveConfig({
    gameConfigs: {
      ...existing,
      [gameId]: {
        ...current,
        ...config,
      },
    },
  })
}

export function loadPresets(): Preset[] {
  try {
    const stored = localStorage.getItem(PRESETS_KEY)
    if (!stored) return []
    return JSON.parse(stored) as Preset[]
  } catch {
    return []
  }
}

export function savePresets(presets: Preset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch (e) {
    console.error('保存预设失败:', e)
  }
}

export function createPreset(name: string, config: Partial<AppConfig>): Preset {
  return {
    id: Date.now().toString(),
    name,
    config: { ...config },
    createdAt: Date.now()
  }
}

export function addPreset(name: string, config: Partial<AppConfig>): Preset {
  const presets = loadPresets()
  const newPreset = createPreset(name, config)
  presets.push(newPreset)
  savePresets(presets)
  return newPreset
}

export function deletePreset(presetId: string): void {
  const presets = loadPresets().filter(p => p.id !== presetId)
  savePresets(presets)
}

export function updatePreset(presetId: string, updates: Partial<Preset>): void {
  const presets = loadPresets()
  const index = presets.findIndex(p => p.id === presetId)
  if (index !== -1) {
    presets[index] = { ...presets[index], ...updates }
    savePresets(presets)
  }
}

/**
 * 加载播放列表
 */
export function loadPlaylist(): PlaylistItem[] {
  try {
    const stored = localStorage.getItem(PLAYLIST_KEY)
    if (!stored) return []
    return JSON.parse(stored) as PlaylistItem[]
  } catch {
    return []
  }
}

/**
 * 保存播放列表
 */
export function savePlaylist(playlist: PlaylistItem[]): void {
  try {
    localStorage.setItem(PLAYLIST_KEY, JSON.stringify(playlist))
  } catch (e) {
    console.error('保存播放列表失败:', e)
  }
}

/**
 * 添加到播放列表
 */
export function addToPlaylist(item: Omit<PlaylistItem, 'id' | 'addedAt'>): PlaylistItem {
  const playlist = loadPlaylist()
  const newItem: PlaylistItem = {
    ...item,
    id: Date.now().toString(),
    addedAt: Date.now()
  }
  playlist.push(newItem)
  savePlaylist(playlist)
  return newItem
}

/**
 * 从播放列表移除
 */
export function removeFromPlaylist(itemId: string): void {
  const playlist = loadPlaylist().filter(item => item.id !== itemId)
  savePlaylist(playlist)
}

/**
 * 清空播放列表
 */
export function clearPlaylist(): void {
  savePlaylist([])
}
