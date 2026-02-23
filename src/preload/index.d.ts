import { ElectronAPI } from '@electron-toolkit/preload'

interface MediaMetadata {
  duration: number
  width?: number
  height?: number
  type: 'video' | 'audio' | 'image'
  thumbnailPath?: string
}

interface CaptionWord {
  word: string
  start: number
  end: number
}

interface CaptionRaw {
  text: string
  startTime: number
  endTime: number
  words?: CaptionWord[]
}

interface Api {
  openFileDialog: () => Promise<string[]>
  getMediaMetadata: (filePath: string, assetId: string) => Promise<MediaMetadata>
  saveProject: (project: unknown) => Promise<boolean>
  openProject: () => Promise<unknown>
  saveDialog: (defaultName: string) => Promise<string | null>
  exportVideo: (options: unknown) => Promise<void>
  onExportProgress: (cb: (percent: number) => void) => () => void
  transcribe: (filePath: string) => Promise<CaptionRaw[]>
  onWhisperProgress: (cb: (msg: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
