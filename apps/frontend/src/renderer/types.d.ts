export {}

declare global {
  interface Window {
    devspace?: {
      version: string
      openMidiDialog: () => Promise<string | null>
      openAudioDialog: () => Promise<string | null>
      saveMidiDialog: () => Promise<string | null>
      openDirectoryDialog: () => Promise<string | null>
    }
  }
}
