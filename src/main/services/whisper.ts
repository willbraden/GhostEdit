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

// Cache the pipeline across calls so the model isn't reloaded each time
let _pipeline: unknown = null

async function getWhisperPipeline(onProgress?: (msg: string) => void): Promise<unknown> {
  if (_pipeline) return _pipeline

  onProgress?.('Loading Whisper model (first use downloads ~244MB)...')

  // @xenova/transformers is ESM — use dynamic import from CJS main process
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { pipeline, env } = await (import('@xenova/transformers') as any)

  // Single thread is most compatible in Electron main process
  env.backends.onnx.wasm.numThreads = 1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _pipeline = await (pipeline as any)('automatic-speech-recognition', 'Xenova/whisper-small.en', {
    quantized: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (info: any) => {
      if (info.status === 'downloading' && info.total > 0) {
        const pct = Math.round((info.loaded / info.total) * 100)
        onProgress?.(`Downloading model: ${pct}%`)
      } else if (info.status === 'loading') {
        onProgress?.('Loading model into memory...')
      }
    },
  })

  return _pipeline
}

// Parse a 16kHz mono PCM WAV file into a Float32Array of normalized samples.
// Scans for the "data" chunk header to handle any WAV header size.
function readWavAsFloat32(wavPath: string): Float32Array {
  const buf = fs.readFileSync(wavPath)

  // Find "data" marker
  let dataOffset = 12
  while (dataOffset < buf.length - 8) {
    const marker = buf.toString('ascii', dataOffset, dataOffset + 4)
    const chunkSize = buf.readUInt32LE(dataOffset + 4)
    if (marker === 'data') {
      dataOffset += 8
      break
    }
    dataOffset += 8 + chunkSize
  }

  const sampleCount = (buf.length - dataOffset) / 2
  const samples = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768.0
  }
  return samples
}

export async function transcribeAudio(
  inputPath: string,
  onProgress?: (msg: string) => void
): Promise<TranscriptionResult> {
  const tmpDir = os.tmpdir()
  const audioPath = path.join(tmpDir, `ve_whisper_${Date.now()}.wav`)

  onProgress?.('Extracting audio...')

  // Convert to 16kHz mono WAV with loudness normalization (required by Whisper)
  await execFileAsync(ffmpegPath, [
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-af', 'loudnorm',
    '-c:a', 'pcm_s16le',
    '-y',
    audioPath,
  ]).catch((e: Error) => {
    throw new Error(`Audio extraction failed: ${e.message}`)
  })

  onProgress?.('Running Whisper transcription...')

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transcriber = (await getWhisperPipeline(onProgress)) as any

    // AudioContext is not available in Node.js — read WAV bytes and convert to Float32Array
    const audioData = readWavAsFloat32(audioPath)
    const wavStat = fs.statSync(audioPath)
    const maxAmp = audioData.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    console.log(`[whisper] WAV: ${wavStat.size} bytes, ${audioData.length} samples, max amplitude: ${maxAmp.toFixed(4)}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await transcriber(audioData, {
      sampling_rate: 16000,
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    })

    console.log('[whisper] raw result text:', result.text)

    // Filter out Whisper special tokens and hallucinations
    const SPECIAL_TOKEN = /^\[.*\]$/ // [BLANK_AUDIO], [MUSIC], etc.

    const words: TranscriptionWord[] = []
    if (result.chunks && Array.isArray(result.chunks)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const chunk of result.chunks as any[]) {
        const text = (chunk.text as string)?.trim()
        // Skip empty, special tokens, and hallucinations (no alphabetic characters)
        if (!text || SPECIAL_TOKEN.test(text) || !/[a-zA-Z]/.test(text)) continue
        words.push({
          word: text,
          start: (chunk.timestamp as number[])?.[0] ?? 0,
          end: (chunk.timestamp as number[])?.[1] ?? (chunk.timestamp as number[])?.[0] ?? 0,
        })
      }
    }

    // Deduplicate words from chunk overlap regions.
    // When chunks overlap, the same word near the boundary gets transcribed twice
    // with slightly different timestamps, causing rapid-fire or doubled captions.
    const deduped: TranscriptionWord[] = []
    for (const word of words) {
      const last = deduped[deduped.length - 1]
      if (
        last &&
        last.word.toLowerCase() === word.word.toLowerCase() &&
        Math.abs(word.start - last.start) < 0.5
      ) {
        // Keep whichever has the longer/more defined duration
        if ((word.end - word.start) > (last.end - last.start)) {
          deduped[deduped.length - 1] = word
        }
        continue
      }
      deduped.push(word)
    }

    fs.unlink(audioPath, () => {})
    return { words: deduped, text: (result.text as string) || '' }
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
