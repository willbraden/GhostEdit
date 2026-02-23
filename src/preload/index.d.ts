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

interface ProjectResult {
  project: unknown
  filePath: string
}

interface Api {
  openFileDialog: () => Promise<string[]>
  getMediaMetadata: (filePath: string, assetId: string) => Promise<MediaMetadata>
  saveProject: (project: unknown, filePath: string) => Promise<boolean>
  saveProjectAs: (project: unknown, defaultName?: string) => Promise<string | null>
  openProject: () => Promise<ProjectResult | null>
  openProjectPath: (filePath: string) => Promise<ProjectResult | null>
  getRecentFiles: () => Promise<string[]>
  saveDialog: (defaultName: string) => Promise<string | null>
  exportVideo: (options: unknown) => Promise<void>
  onExportProgress: (cb: (percent: number) => void) => () => void
  transcribe: (filePath: string) => Promise<CaptionRaw[]>
  onWhisperProgress: (cb: (msg: string) => void) => () => void
  downloadFont: (familyName: string) => Promise<string>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
