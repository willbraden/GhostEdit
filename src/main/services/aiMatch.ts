import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import { getMediaMetadata } from './ffmpeg'

export interface ClipInfo {
  filename: string
  duration: number
}

export interface ScriptSegment {
  text: string
  startTime: number
  endTime: number
}

export interface ClipMatch {
  filename: string
  timelineStart: number
  timelineEnd: number
  sourceStart: number
  reason: string
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])

export async function scanClipsFolder(folderPath: string): Promise<ClipInfo[]> {
  const files = fs.readdirSync(folderPath)
  const clips: ClipInfo[] = []
  for (const file of files) {
    const ext = path.extname(file).toLowerCase()
    if (!VIDEO_EXTS.has(ext)) continue
    const fullPath = path.join(folderPath, file)
    try {
      const meta = await getMediaMetadata(fullPath)
      clips.push({ filename: file, duration: meta.duration })
    } catch {
      clips.push({ filename: file, duration: 30 })
    }
  }
  return clips
}

export async function matchClipsToScript(
  apiKey: string,
  clipsFolder: string,
  segments: ScriptSegment[],
  onProgress: (msg: string) => void
): Promise<ClipMatch[]> {
  onProgress('Scanning clips folder...')
  const clips = await scanClipsFolder(clipsFolder)
  if (clips.length === 0) throw new Error('No video files found in folder')

  const client = new Anthropic({ apiKey })

  const totalDuration = segments[segments.length - 1]?.endTime ?? 60

  const segmentsText = segments
    .map(
      (s, i) =>
        `  ${i + 1}. [${s.startTime.toFixed(1)}s – ${s.endTime.toFixed(1)}s] "${s.text}"`
    )
    .join('\n')

  const clipsText = clips
    .map((c, i) => {
      const label = path.basename(c.filename, path.extname(c.filename)).replace(/_/g, ' ')
      return `  ${i + 1}. "${c.filename}" | label: "${label}" | duration: ${c.duration.toFixed(1)}s`
    })
    .join('\n')

  const prompt = `You are a video editor AI. Assign B-roll clips to timestamped voiceover segments.

## Script segments:
${segmentsText}

## Available B-roll clips:
${clipsText}

## Rules:
- Match each segment's topic and mood to the most semantically appropriate clip filename.
- Cover the ENTIRE timeline from 0s to ${totalDuration.toFixed(1)}s with NO gaps between clips.
- Clips may be reused. Set sourceStart to 0 unless a later start is meaningfully better.
- Output ONLY a JSON array — no explanation text outside the JSON.

Output format:
[
  { "filename": "exact_filename.mp4", "timelineStart": 0.0, "timelineEnd": 5.5, "sourceStart": 0.0, "reason": "brief reason" },
  ...
]`

  onProgress('Calling Claude AI...')
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  onProgress('Parsing response...')
  const jsonMatch = content.text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('Could not parse JSON array from Claude response')

  return JSON.parse(jsonMatch[0]) as ClipMatch[]
}
