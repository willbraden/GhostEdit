import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../renderer/src/types/project'

const api = {
  // File operations
  openFileDialog: () => ipcRenderer.invoke(IPC.FILE_OPEN_DIALOG),
  getMediaMetadata: (filePath: string, assetId: string) =>
    ipcRenderer.invoke(IPC.FILE_GET_METADATA, filePath, assetId),
  saveProject: (project: unknown) => ipcRenderer.invoke(IPC.FILE_SAVE_PROJECT, project),
  openProject: () => ipcRenderer.invoke(IPC.FILE_OPEN_PROJECT),
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
