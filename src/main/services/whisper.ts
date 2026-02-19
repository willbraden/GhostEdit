import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static')
const execFileAsync = promisify(execFile)

export interface TranscriptionWord {
  word: string
  start: number
  end: number
}

export interface TranscriptionResult {
  words: TranscriptionWord[]
  text: string
}

// nodejs-whisper expects an audio file and returns segments with timestamps
async function transcribeWithNodeWhisper(
  audioPath: string,
  modelName: string,
  onProgress?: (msg: string) => void
): Promise<TranscriptionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nodewhisper } = require('nodejs-whisper')

  onProgress?.('Running Whisper transcription...')

  const result = await nodewhisper(audioPath, {
    modelName,
    autoDownloadModelName: modelName,
    removeWavFileAfterTranscription: false,
    withCuda: false,
    whisperOptions: {
      outputInJson: true,
      word_timestamps: true,
      language: 'auto',
    },
  })

  // nodejs-whisper returns array of segments
  const words: TranscriptionWord[] = []
  let fullText = ''

  if (Array.isArray(result)) {
    for (const segment of result) {
      if (segment.tokens) {
        for (const token of segment.tokens) {
          if (token.text && token.text.trim()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tok = token as any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const seg = segment as any
            words.push({
              word: token.text.trim(),
              start: (tok.offsets?.from ?? seg.offsets?.from ?? 0) / 1000,
              end: (tok.offsets?.to ?? seg.offsets?.to ?? 0) / 1000,
            })
          }
        }
      }
      if (segment.speech) fullText += segment.speech + ' '
    }
  }

  return { words, text: fullText.trim() }
}

export async function transcribeAudio(
  inputPath: string,
  onProgress?: (msg: string) => void
): Promise<TranscriptionResult> {
  const tmpDir = os.tmpdir()
  const audioPath = path.join(tmpDir, `ve_whisper_${Date.now()}.wav`)

  onProgress?.('Extracting audio...')

  // Convert to 16kHz mono WAV (required by Whisper)
  await execFileAsync(ffmpegPath, [
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    '-y',
    audioPath,
  ])

  onProgress?.('Loading Whisper model (downloading if first use)...')

  try {
    const result = await transcribeWithNodeWhisper(audioPath, 'base.en', onProgress)
    fs.unlink(audioPath, () => {})
    return result
  } catch (err) {
    fs.unlink(audioPath, () => {})
    throw err
  }
}

// Group words into caption lines based on pauses and max words per line
export function groupWordsIntoCaptions(
  words: TranscriptionWord[],
  maxWords = 5,
  maxGapSeconds = 0.5
): Array<{ text: string; startTime: number; endTime: number }> {
  if (words.length === 0) return []

  const captions: Array<{ text: string; startTime: number; endTime: number }> = []
  let group: TranscriptionWord[] = []

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const prev = words[i - 1]

    const gap = prev ? word.start - prev.end : 0
    const shouldBreak = group.length >= maxWords || (group.length > 0 && gap > maxGapSeconds)

    if (shouldBreak && group.length > 0) {
      captions.push({
        text: group.map((w) => w.word).join(' '),
        startTime: group[0].start,
        endTime: group[group.length - 1].end,
      })
      group = []
    }

    group.push(word)
  }

  if (group.length > 0) {
    captions.push({
      text: group.map((w) => w.word).join(' '),
      startTime: group[0].start,
      endTime: group[group.length - 1].end,
    })
  }

  return captions
}
