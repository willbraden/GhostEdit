import { registerFileIpc } from './file'
import { registerFfmpegIpc } from './ffmpeg'
import { registerWhisperIpc } from './whisper'
import { registerFontsIpc } from './fonts'
import { registerAiMatchIpc } from './aiMatch'

export function registerAllIpc(): void {
  registerFileIpc()
  registerFfmpegIpc()
  registerWhisperIpc()
  registerFontsIpc()
  registerAiMatchIpc()
}
