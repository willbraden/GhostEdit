import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../renderer/src/types/project'

const api = {
  // File operations
  openFileDialog: () => ipcRenderer.invoke(IPC.FILE_OPEN_DIALOG),
  getMediaMetadata: (filePath: string, assetId: string) =>
    ipcRenderer.invoke(IPC.FILE_GET_METADATA, filePath, assetId),
  saveProject: (project: unknown, filePath: string) =>
    ipcRenderer.invoke(IPC.FILE_SAVE_PROJECT, project, filePath),
  saveProjectAs: (project: unknown, defaultName?: string) =>
    ipcRenderer.invoke(IPC.FILE_SAVE_AS_PROJECT, project, defaultName),
  openProject: () => ipcRenderer.invoke(IPC.FILE_OPEN_PROJECT),
  openProjectPath: (filePath: string) =>
    ipcRenderer.invoke(IPC.FILE_OPEN_PROJECT_PATH, filePath),
  getRecentFiles: () => ipcRenderer.invoke(IPC.FILE_GET_RECENTS),
  saveDialog: (defaultName: string) => ipcRenderer.invoke(IPC.FILE_SAVE_DIALOG, defaultName),

  // FFmpeg
  exportVideo: (options: unknown) => ipcRenderer.invoke(IPC.FFMPEG_EXPORT, options),
  onExportProgress: (cb: (percent: number) => void) => {
    const listener = (_: Electron.IpcRendererEvent, percent: number): void => cb(percent)
    ipcRenderer.on(IPC.FFMPEG_EXPORT_PROGRESS, listener)
    return () => ipcRenderer.off(IPC.FFMPEG_EXPORT_PROGRESS, listener)
  },

  // Whisper
  transcribe: (filePath: string) => ipcRenderer.invoke(IPC.WHISPER_TRANSCRIBE, filePath),
  onWhisperProgress: (cb: (msg: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on(IPC.WHISPER_PROGRESS, listener)
    return () => ipcRenderer.off(IPC.WHISPER_PROGRESS, listener)
  },

  // Fonts
  downloadFont: (familyName: string) => ipcRenderer.invoke(IPC.FONTS_DOWNLOAD, familyName),

  // AI B-Roll Matcher
  openFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.AI_MATCH_OPEN_FOLDER_DIALOG),
  matchClips: (apiKey: string, clipsFolder: string, segments: unknown): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.AI_MATCH_CLIPS, apiKey, clipsFolder, segments),
  onAiMatchProgress: (cb: (msg: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on(IPC.AI_MATCH_PROGRESS, listener)
    return () => ipcRenderer.off(IPC.AI_MATCH_PROGRESS, listener)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
