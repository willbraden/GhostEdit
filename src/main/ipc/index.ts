import { registerFileIpc } from './file'
import { registerFfmpegIpc } from './ffmpeg'
import { registerWhisperIpc } from './whisper'

export function registerAllIpc(): void {
  registerFileIpc()
  registerFfmpegIpc()
  registerWhisperIpc()
}
