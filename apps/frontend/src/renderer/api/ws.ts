export type BackendStatus = 'idle' | 'loaded' | 'playing' | 'paused' | 'stopped'

export type PreviewEvent = {
  t_ms: number
  type: 'down' | 'up'
  key: string
  source: string
  note?: number | null
}

export type GameProfile = {
  id: string
  name: string
  instrument: 'piano' | 'drums' | 'microphone'
  midi_channel_filter?: number | null
  note_range_low?: number
  note_range_high?: number
  prefer_nearest_white?: boolean
  transpose_semitones?: number
  speed?: number
  max_polyphony?: number
  chord_mode?: string
  keep_melody_top_note?: boolean
  chord_cluster_window_ms?: number
  auto_transpose?: boolean
  link_latency_ms?: number
  custom_key_map?: Record<number, string> | null
}

export type WsMessage =
  | { type: 'ping' }
  | { type: 'get_game_profiles' }
  | { type: 'set_game_profile'; profile_id: string }
  | { type: 'set_config'; config: any }
  | { type: 'load_midi'; path: string }
  | { type: 'get_preview'; limit?: number }
  | { type: 'calc_white_key_ratio'; transpose: number }
  | { type: 'auto_transpose' }
  | { type: 'bind_process'; process: string | null }
  | { type: 'list_windows' }
  | { type: 'check_admin' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'sync_ntp' }
  | { type: 'measure_ntp_latency' }
  | { type: 'check_audio_converter' }
  | { type: 'set_piano_trans_path'; path: string }
  | { type: 'convert_audio'; path: string }
  // 曲库管理
  | { type: 'library_get_all' }
  | { type: 'library_get_page'; offset?: number; limit?: number; folder?: string; query?: string }
  | { type: 'library_get_folders' }
  | { type: 'library_scan_folder'; path: string }
  | { type: 'library_scan_cancel' }
  | { type: 'library_add'; path: string; name?: string; folder?: string }
  | { type: 'library_update'; id: string; name?: string; folder?: string }
  | { type: 'library_delete'; id: string }
  | { type: 'library_delete_folder'; folder: string }
  | { type: 'library_clear' }
  | { type: 'library_search'; query: string }

export type WindowInfo = {
  pid: number
  name: string
  title: string
}

export type ConfigInfo = {
  transpose_semitones?: number
  speed?: number
  max_polyphony?: number
  chord_mode?: string
  auto_transpose?: boolean
  link_latency_ms?: number
  instrument?: 'piano' | 'drums' | 'microphone'
  input_mode?: 'sendinput' | 'message'
  midi_channel_filter?: number | null
  note_range_low?: number
  note_range_high?: number
  prefer_nearest_white?: boolean
}

export type LibraryEntry = {
  id: string
  path: string
  name: string
  folder: string
  duration_ms: number
  notes: number
  added_at: string
}

export type WsIncoming =
  | { type: 'pong' }
  | { type: 'game_profiles'; profiles: GameProfile[]; active_profile_id: string }
  | { type: 'status'; status: BackendStatus; midi?: any; config?: ConfigInfo; game_profile?: GameProfile; hotkeys_enabled?: boolean; is_admin?: boolean; bind?: { process: string | null }; auto_transpose?: number; original_white_key_ratio?: number }
  | { type: 'events_preview'; events: PreviewEvent[] }
  | { type: 'progress'; cursor_ms: number; percent: number }
  | { type: 'active_keys'; keys: string[] }
  | { type: 'log'; level: string; message: string }
  | { type: 'error'; message: string }
  | { type: 'windows_list'; windows: WindowInfo[] }
  | { type: 'admin_status'; is_admin: boolean }
  | { type: 'white_key_ratio'; transpose: number; ratio: number }
  | { type: 'ntp_sync'; success: boolean; ntp_time?: number; offset_ms?: number; server?: string; message?: string }
  | { type: 'ntp_latency'; latency_ms: number; server?: string; error?: string }
  | { type: 'audio_converter_status'; available: boolean; current_path?: string; supported_formats?: string[]; message: string }
  | { type: 'piano_trans_path_set'; success: boolean; message: string; current_path?: string; available: boolean }
  | { type: 'audio_conversion_status'; status: 'converting' | 'completed' | 'failed'; midi_path?: string; message: string; auto_loaded?: boolean; midi_info?: { duration_ms: number; notes: number; events: number } }
  // 曲库管理
  | { type: 'library_list'; entries: LibraryEntry[]; folders: string[] }
  | { type: 'library_list_page'; entries: LibraryEntry[]; folders: string[]; total: number; offset: number; limit: number; folder?: string; query?: string }
  | { type: 'library_folders'; folders: string[] }
  | { type: 'library_scan_progress'; status: string; current: number; total: number; name?: string; added_count?: number }
  | { type: 'library_scan_result'; success: boolean; added_count: number; entries?: LibraryEntry[]; message: string }
  | { type: 'library_entry_added'; entry: LibraryEntry }
  | { type: 'library_entry_updated'; entry: LibraryEntry }
  | { type: 'library_entry_deleted'; id: string; success: boolean }
  | { type: 'library_folder_deleted'; folder: string; deleted_count: number }
  | { type: 'library_cleared'; deleted_count: number }
  | { type: 'library_search_result'; query: string; entries: LibraryEntry[] }

export class BackendWs {
  private ws: WebSocket | null = null
  private url: string
  private reconnectTimer: number | null = null
  private shouldReconnect = true
  private isConnecting = false
  onMessage?: (msg: WsIncoming) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: string) => void

  constructor(url = 'ws://127.0.0.1:18765/ws') {
    this.url = url
  }

  connect() {
    if (this.ws || this.isConnecting) return
    
    this.isConnecting = true
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.onopen = () => {
        this.isConnecting = false
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
        this.onOpen?.()
      }

      ws.onclose = () => {
        this.ws = null
        this.isConnecting = false
        this.onClose?.()
        
        if (this.shouldReconnect && !this.reconnectTimer) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null
            this.connect()
          }, 2000)
        }
      }

      ws.onerror = () => {
        this.isConnecting = false
        this.onError?.('WebSocket 连接错误')
      }

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as WsIncoming
          console.log('[WS] 收到消息:', data.type)
          
          if (data.type === 'error') {
            this.onError?.(data.message || '未知错误')
          }
          
          this.onMessage?.(data)
        } catch (e) {
          console.log('[WS] 解析消息失败:', e)
        }
      }
    } catch (err) {
      this.isConnecting = false
      this.onError?.('无法连接到后端服务')
    }
  }

  send(msg: WsMessage) {
    console.log('[WS] 发送消息:', msg)
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('[WS] 未连接，无法发送')
      this.onError?.('未连接到后端')
      return
    }
    try {
      this.ws.send(JSON.stringify(msg))
    } catch (e) {
      console.log('[WS] 发送失败:', e)
      this.onError?.('发送消息失败')
    }
  }

  close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (!this.ws) return
    this.ws.close()
    this.ws = null
    this.isConnecting = false
  }
}
