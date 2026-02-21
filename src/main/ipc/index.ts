import { registerFileIpc } from './file'
import { registerFfmpegIpc } from './ffmpeg'
import { registerWhisperIpc } from './whisper'
import { registerFontsIpc } from './fonts'

export function registerAllIpc(): void {
  registerFileIpc()
  registerFfmpegIpc()
  registerWhisperIpc()
  registerFontsIpc()
}
