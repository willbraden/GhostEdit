import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../renderer/src/types/project'
import { exportVideo, type ExportJobOptions } from '../services/ffmpeg'

export function registerFfmpegIpc(): void {
  ipcMain.handle(
    IPC.FFMPEG_EXPORT,
    async (event, options: Omit<ExportJobOptions, 'onProgress'>) => {
      const win = BrowserWindow.fromWebContents(event.sender)

      const jobOptions: ExportJobOptions = {
        ...options,
        onProgress: (percent) => {
          win?.webContents.send(IPC.FFMPEG_EXPORT_PROGRESS, percent)
        },
      }

      await exportVideo(jobOptions)
    }
  )
}
