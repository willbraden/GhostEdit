import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static')

import { resolveFontPath } from './fonts'

const execFileAsync = promisify(execFile)

export interface MediaMetadata {
  duration: number
  width?: number
  height?: number
  type: 'video' | 'audio' | 'image'
}

export async function getMediaMetadata(filePath: string): Promise<MediaMetadata> {
  const ext = path.extname(filePath).toLowerCase()
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']

  if (imageExts.includes(ext)) {
    return { duration: 0, type: 'image' }
  }

  // Run ffmpeg -i to get file info from stderr (always "fails" with no output file, that's expected)
  const { stderr } = await execFileAsync(ffmpegPath, ['-i', filePath], { env: { ...process.env } })
    .catch((e) => ({ stderr: (e.stderr ?? '') as string }))

  const combined = stderr

  let duration = 0
  let width: number | undefined
  let height: number | undefined

  const durationMatch = combined.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
  if (durationMatch) {
    duration =
      parseInt(durationMatch[1]) * 3600 +
      parseInt(durationMatch[2]) * 60 +
      parseFloat(durationMatch[3])
  }

  const videoMatch = combined.match(/(\d+)x(\d+)/)
  if (videoMatch) {
    width = parseInt(videoMatch[1])
    height = parseInt(videoMatch[2])
  }

  const hasVideo = combined.includes('Video:')
  const type = hasVideo ? 'video' : 'audio'

  return { duration, width, height, type }
}

export async function generateThumbnail(
  filePath: string,
  outputDir: string,
  assetId: string
): Promise<string> {
  const thumbPath = path.join(outputDir, `${assetId}.jpg`)

  if (fs.existsSync(thumbPath)) return thumbPath

  await execFileAsync(ffmpegPath, [
    '-i', filePath,
    '-ss', '00:00:01',
    '-vframes', '1',
    '-q:v', '2',
    '-y',
    thumbPath,
  ]).catch(() => {
    // Try from start if 1s seek fails
    return execFileAsync(ffmpegPath, [
      '-i', filePath,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      thumbPath,
    ])
  })

  return thumbPath
}

export interface ExportClip {
  filePath: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  timelineEnd: number
}

export interface ExportCaption {
  text: string
  startTime: number
  endTime: number
  fontSize: number
  color: string
  background: string
  bold: boolean
  positionY: number
  fontFamily?: string  // Google Font family name; undefined = system Arial
  strokeWidth?: number // text outline width in px
  strokeColor?: string // text outline color hex
}

export interface ExportAudioClip {
  filePath: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  timelineEnd: number
}

export interface ExportJobOptions {
  clips: ExportClip[]
  audioClips: ExportAudioClip[]
  muteVideoAudio: boolean
  captions: ExportCaption[]
  outputPath: string
  width: number
  height: number
  fps: number
  crf: number
  onProgress?: (percent: number) => void
}

export async function exportVideo(options: ExportJobOptions): Promise<void> {
  const { clips, audioClips, muteVideoAudio, captions, outputPath, width, height, fps, crf, onProgress } = options

  if (clips.length === 0) {
    throw new Error('No clips to export')
  }

  const tmpDir = os.tmpdir()
  const segmentListPath = path.join(tmpDir, 've_segments.txt')

  // Build individual trimmed segments then concat
  const segmentPaths: string[] = []

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const segPath = path.join(tmpDir, `ve_seg_${i}.mp4`)
    segmentPaths.push(segPath)
    const duration = clip.sourceEnd - clip.sourceStart

    await execFileAsync(ffmpegPath, [
      '-ss', String(clip.sourceStart),
      '-i', clip.filePath,
      '-t', String(duration),
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-ar', '44100',
      '-y',
      segPath,
    ])

    if (onProgress) onProgress(Math.round(((i + 1) / clips.length) * 60))
  }

  // Write concat list
  const concatContent = segmentPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n')
  fs.writeFileSync(segmentListPath, concatContent)

  const concatPath = path.join(tmpDir, 've_concat.mp4')

  await execFileAsync(ffmpegPath, [
    '-f', 'concat',
    '-safe', '0',
    '-i', segmentListPath,
    '-c', 'copy',
    '-y',
    concatPath,
  ])

  if (onProgress) onProgress(70)

  // Convert rgba(r,g,b,a) → 0xRRGGBB@alpha so FFmpeg drawtext gets no commas in color values
  const toFfmpegColor = (color: string): string => {
    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
    if (!m) return color
    const r = parseInt(m[1]).toString(16).padStart(2, '0')
    const g = parseInt(m[2]).toString(16).padStart(2, '0')
    const b = parseInt(m[3]).toString(16).padStart(2, '0')
    const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1
    return `0x${r}${g}${b}@${alpha}`
  }

  // Validate captions: drop bad time ranges, sort by start
  const validCaptions = captions
    .map((c) => ({ ...c, startTime: Number(c.startTime), endTime: Number(c.endTime) }))
    .filter((c) => Number.isFinite(c.startTime) && Number.isFinite(c.endTime) && c.endTime > c.startTime)
    .sort((a, b) => a.startTime - b.startTime)

  // Escape text for drawtext text= option.
  // Wrap in single quotes so commas, colons, double-quotes are all protected at the filtergraph level.
  // Single quotes inside the text are broken out as '\'' (exit quote, escaped quote, re-enter quote).
  // Backslashes are doubled at the option level.
  const escapeText = (t: string): string =>
    "'" + t.replace(/\\/g, '\\\\').replace(/'/g, "'\\''") + "'"

  // Pre-resolve font paths for all unique family+bold combos (downloads from Google Fonts if needed)
  const fontPathCache = new Map<string, string>()
  for (const cap of validCaptions) {
    const key = `${cap.fontFamily || ''}:${cap.bold}`
    if (!fontPathCache.has(key)) {
      const resolved = await resolveFontPath(cap.fontFamily, cap.bold)
      console.log(`[export] Font "${key}" → ${resolved}`)
      fontPathCache.set(key, resolved)
    }
  }

  // Scale font sizes from the preview canvas reference resolution to the actual export resolution.
  // Preview canvas: 1920px wide for 16:9, 1080px wide for 9:16 (portrait).
  // This keeps caption sizes visually consistent across export resolutions.
  const referenceWidth = width > height ? 1920 : 1080
  const fontScale = width / referenceWidth

  // Build drawtext filters for captions
  const drawtextFilters = validCaptions.map((cap) => {
    const fontsize = Math.max(8, Math.round((cap.fontSize || 32) * fontScale))
    const fontcolor = toFfmpegColor(cap.color || 'white')
    const boxcolor = cap.background === 'transparent' ? 'black@0.0' : toFfmpegColor(cap.background || 'black@0.5')
    const y = `${cap.positionY || 85}*h/100`
    const fontFile = fontPathCache.get(`${cap.fontFamily || ''}:${cap.bold}`)!
      .replace(/\\/g, '/')          // FFmpeg needs forward slashes on Windows
      .replace(/^([A-Za-z]):/, '$1\\:')  // Escape Windows drive letter colon (C: → C\:) — FFmpeg's filter parser breaks on it
    // Convert stroke color hex → FFmpeg color. borderw= draws the outline outside the text.
    const strokeW = Math.round((cap.strokeWidth || 0) * fontScale)
    const strokePart = strokeW > 0
      ? `:borderw=${strokeW}:bordercolor=${toFfmpegColor(cap.strokeColor || '#000000')}`
      : ''
    return (
      `drawtext=fontfile='${fontFile}'` +
      `:text=${escapeText(cap.text)}` +
      `:fontsize=${fontsize}` +
      `:fontcolor=${fontcolor}` +
      strokePart +
      `:box=1:boxcolor=${boxcolor}:boxborderw=8` +
      `:x=(w-text_w)/2:y=${y}` +
      `:enable=between(t\\,${cap.startTime}\\,${cap.endTime})`
    )
  })

  const vfFilterStr = drawtextFilters.length > 0 ? drawtextFilters.join(',') : 'null'
  const hasAudioClips = audioClips.length > 0

  // Check whether the concatenated video actually has an audio stream.
  // Video-only clips produce a concat with no audio, so referencing [0:a] in
  // filter_complex would cause FFmpeg to fail. We probe once and skip [0:a]
  // if there is nothing to mix in from the video side.
  const concatHasAudio = await execFileAsync(ffmpegPath, ['-i', concatPath], { env: process.env })
    .catch((e: { stderr?: string }) => ({ stderr: (e.stderr ?? '') as string }))
    .then((r) => r.stderr.includes('Audio:'))

  const finalArgs: string[] = ['-i', concatPath]

  if (hasAudioClips) {
    // Add each audio clip as a trimmed input
    for (const ac of audioClips) {
      const dur = ac.sourceEnd - ac.sourceStart
      finalArgs.push('-ss', String(ac.sourceStart), '-t', String(dur), '-i', ac.filePath)
    }

    // Build filter_complex: video caption filter + audio delay/mix
    const filterParts: string[] = []
    filterParts.push(`[0:v]${vfFilterStr}[vout]`)

    const audioLabels: string[] = []
    for (let i = 0; i < audioClips.length; i++) {
      const delayMs = Math.round(audioClips[i].timelineStart * 1000)
      const label = `[a${i}]`
      filterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs}${label}`)
      audioLabels.push(label)
    }

    // Only include [0:a] if the concat actually has an audio stream
    const includeVideoAudio = !muteVideoAudio && concatHasAudio
    const mixInputs = includeVideoAudio ? ['[0:a]', ...audioLabels] : audioLabels
    if (mixInputs.length === 1) {
      filterParts.push(`${mixInputs[0]}anull[aout]`)
    } else {
      filterParts.push(
        `${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0:dropout_transition=0[aout]`
      )
    }

    finalArgs.push(
      '-filter_complex', filterParts.join(';'),
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-c:a', 'aac', '-ar', '44100',
      '-r', String(fps), '-y', outputPath,
    )
  } else if (muteVideoAudio || !concatHasAudio) {
    // No audio clips and either muting or no audio in video — export video only
    finalArgs.push(
      '-vf', vfFilterStr,
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-an',
      '-r', String(fps), '-y', outputPath,
    )
  } else {
    // No audio clips, video has audio — pass it through
    finalArgs.push(
      '-vf', vfFilterStr,
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-c:a', 'aac', '-ar', '44100',
      '-r', String(fps), '-y', outputPath,
    )
  }

  await execFileAsync(ffmpegPath, finalArgs)

  if (onProgress) onProgress(100)

  // Cleanup temp files
  for (const seg of segmentPaths) {
    fs.unlink(seg, () => {})
  }
  fs.unlink(segmentListPath, () => {})
  fs.unlink(concatPath, () => {})
}
