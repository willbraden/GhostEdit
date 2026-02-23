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

// ── Recent files ────────────────────────────────────────────────────────────

const recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json')

function readRecents(): string[] {
  try {
    const list: string[] = JSON.parse(fs.readFileSync(recentFilesPath, 'utf-8'))
    return list.filter((p) => fs.existsSync(p)).slice(0, 10)
  } catch {
    return []
  }
}

function addRecent(filePath: string): void {
  const list = [filePath, ...readRecents().filter((p) => p !== filePath)].slice(0, 10)
  fs.writeFileSync(recentFilesPath, JSON.stringify(list, null, 2))
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

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

  // Save project directly to a known path — no dialog
  ipcMain.handle(IPC.FILE_SAVE_PROJECT, async (_, project: unknown, filePath: string) => {
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2))
    addRecent(filePath)
    return true
  })

  // Save project with a dialog (Save As) — returns the chosen file path or null
  ipcMain.handle(IPC.FILE_SAVE_AS_PROJECT, async (_, project: unknown, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName ? `${defaultName}.vep` : 'project.vep',
      filters: [{ name: 'Video Editor Project', extensions: ['vep'] }],
    })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, JSON.stringify(project, null, 2))
    addRecent(result.filePath)
    return result.filePath
  })

  // Open project via dialog — returns { project, filePath } or null
  ipcMain.handle(IPC.FILE_OPEN_PROJECT, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Video Editor Project', extensions: ['vep'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const project = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    addRecent(filePath)
    return { project, filePath }
  })

  // Open a specific project file path (used by recent files)
  ipcMain.handle(IPC.FILE_OPEN_PROJECT_PATH, async (_, filePath: string) => {
    if (!fs.existsSync(filePath)) return null
    const project = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    addRecent(filePath)
    return { project, filePath }
  })

  // Return the current recent files list (non-existent paths are filtered out)
  ipcMain.handle(IPC.FILE_GET_RECENTS, () => readRecents())

  // Save dialog for export output path
  ipcMain.handle(IPC.FILE_SAVE_DIALOG, async (_, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    return result.filePath ?? null
  })
}
