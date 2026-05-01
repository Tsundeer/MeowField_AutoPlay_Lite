import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('devspace', {
  version: '0.1.0',
  openMidiDialog: () => ipcRenderer.invoke('open-midi-dialog'),
  openAudioDialog: () => ipcRenderer.invoke('open-audio-dialog'),
  saveMidiDialog: () => ipcRenderer.invoke('save-midi-dialog'),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  saveFileDialog: (options) => ipcRenderer.invoke('save-file-dialog', options),
  onHotkey: (cb) => {
    const handler = (_event, payload) => cb?.(payload)
    ipcRenderer.on('hotkey', handler)
    return () => ipcRenderer.removeListener('hotkey', handler)
  }
})
