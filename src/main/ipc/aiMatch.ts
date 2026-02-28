import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IPC } from '../../renderer/src/types/project'
import { matchClipsToScript } from '../services/aiMatch'
import type { ScriptSegment } from '../services/aiMatch'

export function registerAiMatchIpc(): void {
  ipcMain.handle(IPC.AI_MATCH_OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(
    IPC.AI_MATCH_CLIPS,
    async (event, apiKey: string, clipsFolder: string, segments: ScriptSegment[]) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return matchClipsToScript(apiKey, clipsFolder, segments, (msg) => {
        win?.webContents.send(IPC.AI_MATCH_PROGRESS, msg)
      })
    }
  )
}
