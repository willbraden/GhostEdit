import { ipcMain } from 'electron'
import { IPC } from '../../renderer/src/types/project'
import { downloadGoogleFont } from '../services/fonts'

export function registerFontsIpc(): void {
  // Pre-download both weights of a Google Font so export can use them offline
  ipcMain.handle(IPC.FONTS_DOWNLOAD, async (_, familyName: string) => {
    await Promise.all([
      downloadGoogleFont(familyName, false).catch(() => {}),
      downloadGoogleFont(familyName, true).catch(() => {}),
    ])
  })
}
