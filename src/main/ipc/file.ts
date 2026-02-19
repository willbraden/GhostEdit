import { ipcMain, dialog, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { IPC } from '../../renderer/src/types/project'
import { getMediaMetadata, generateThumbnail } from '../services/ffmpeg'

function getThumbDir(): string {
  return path.join(app.getPath('userData'), 'thumbnails')
}

function ensureThumbDir(): string {
  const dir = getThumbDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function registerFileIpc(): void {
  // Open file dialog to import media
  ipcMain.handle(IPC.FILE_OPEN_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media Files',
          extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'aac', 'm4a', 'ogg',
            'jpg', 'jpeg', 'png', 'gif', 'webp'],
        },
      ],
    })

    if (result.canceled) return []
    return result.filePaths
  })

  // Get metadata + generate thumbnail for a file
  ipcMain.handle(IPC.FILE_GET_METADATA, async (_, filePath: string, assetId: string) => {
    const thumbDir = ensureThumbDir()
    const metadata = await getMediaMetadata(filePath)
    let thumbnailPath: string | undefined

    if (metadata.type === 'video' || metadata.type === 'image') {
      try {
        thumbnailPath = await generateThumbnail(filePath, thumbDir, assetId)
      } catch {
        // thumbnail generation is non-critical
      }
    }

    return { ...metadata, thumbnailPath }
  })

  // Save project to JSON file
  ipcMain.handle(IPC.FILE_SAVE_PROJECT, async (_, project: unknown) => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'project.vep',
      filters: [{ name: 'Video Editor Project', extensions: ['vep'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, JSON.stringify(project, null, 2))
    return true
  })

  // Open project from JSON file
  ipcMain.handle(IPC.FILE_OPEN_PROJECT, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Video Editor Project', extensions: ['vep'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
    return JSON.parse(raw)
  })

  // Save dialog for export output path
  ipcMain.handle(IPC.FILE_SAVE_DIALOG, async (_, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    return result.filePath ?? null
  })
}
