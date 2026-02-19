import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static')

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
}

export interface ExportJobOptions {
  clips: ExportClip[]
  captions: ExportCaption[]
  outputPath: string
  width: number
  height: number
  fps: number
  crf: number
  onProgress?: (percent: number) => void
}

export async function exportVideo(options: ExportJobOptions): Promise<void> {
  const { clips, captions, outputPath, width, height, fps, crf, onProgress } = options

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

  // Build drawtext filters for captions
  const drawtextFilters = captions.map((cap) => {
    const safeText = cap.text.replace(/'/g, "\\'").replace(/:/g, '\\:')
    const fontsize = cap.fontSize || 32
    const fontcolor = cap.color || 'white'
    const boxcolor = cap.background === 'transparent' ? 'black@0.0' : cap.background || 'black@0.5'
    const y = `${cap.positionY || 85}*h/100`
    const bold = cap.bold ? ':fontstyle=Bold' : ''
    return (
      `drawtext=text='${safeText}'` +
      `:fontsize=${fontsize}` +
      `:fontcolor=${fontcolor}` +
      `${bold}` +
      `:box=1:boxcolor=${boxcolor}:boxborderw=8` +
      `:x=(w-text_w)/2:y=${y}` +
      `:enable='between(t,${cap.startTime},${cap.endTime})'`
    )
  })

  const vfFilter = drawtextFilters.length > 0 ? drawtextFilters.join(',') : 'null'

  await execFileAsync(ffmpegPath, [
    '-i', concatPath,
    '-vf', vfFilter,
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', 'medium',
    '-c:a', 'aac',
    '-ar', '44100',
    '-r', String(fps),
    '-y',
    outputPath,
  ])

  if (onProgress) onProgress(100)

  // Cleanup temp files
  for (const seg of segmentPaths) {
    fs.unlink(seg, () => {})
  }
  fs.unlink(segmentListPath, () => {})
  fs.unlink(concatPath, () => {})
}
