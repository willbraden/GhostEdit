import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../renderer/src/types/project'
import { transcribeAudio, groupWordsIntoCaptions } from '../services/whisper'

export function registerWhisperIpc(): void {
  ipcMain.handle(IPC.WHISPER_TRANSCRIBE, async (event, filePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    const result = await transcribeAudio(filePath, (msg) => {
      win?.webContents.send(IPC.WHISPER_PROGRESS, msg)
    })

    const captions = groupWordsIntoCaptions(result.words)
    return captions
  })
}
