import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static')

import { resolveFontPath, getFontsDir } from './fonts'

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

export interface ExportCaptionWord {
  word: string
  startTime: number
  endTime: number
  xOffset: number    // px from left edge of the rendered line (canvas-measured at export res)
  yAdjustPx: number  // px to shift DOWN so word baseline aligns with the full-line baseline
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
  fontFamily?: string    // Google Font family name; undefined = system Arial
  strokeWidth?: number   // text outline width in px
  strokeColor?: string   // text outline color hex
  highlightColor?: string // karaoke active-word color
  lineWidthPx?: number   // total line width in px (canvas-measured) for centering word overlays
  words?: ExportCaptionWord[]
}

export interface ExportAudioClip {
  filePath: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  timelineEnd: number
}

export type ExportEffect =
  | { type: 'pixelate'; timelineStart: number; timelineEnd: number; startBlockSize: number; endBlockSize: number }
  | { type: 'duotone';  timelineStart: number; timelineEnd: number; shadowColor: string; highlightColor: string }
  | { type: 'ascii'; timelineStart: number; timelineEnd: number; cellSize: number; contrast: number }
  | { type: 'dither'; timelineStart: number; timelineEnd: number; levels: number; amount: number }
  | { type: 'chromatic_aberration'; timelineStart: number; timelineEnd: number; offsetPx: number }

export interface ExportJobOptions {
  clips: ExportClip[]
  audioClips: ExportAudioClip[]
  muteVideoAudio: boolean
  captions: ExportCaption[]
  effects: ExportEffect[]
  outputPath: string
  width: number
  height: number
  fps: number
  crf: number
  debug?: boolean
  onProgress?: (percent: number) => void
}

export interface ExportResult {
  debugBundlePath?: string
}

// ── ASS subtitle helpers ──────────────────────────────────────────────────────

function toASSTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// Convert a color in various formats to ASS &HAABBGGRR (alpha 0=opaque, FF=transparent).
function toASSColor(color: string, forceAlpha?: number): string {
  let r = 255, g = 255, b = 255, a = 1.0
  const rgbaM = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgbaM) {
    r = parseInt(rgbaM[1]); g = parseInt(rgbaM[2]); b = parseInt(rgbaM[3])
    a = rgbaM[4] !== undefined ? parseFloat(rgbaM[4]) : 1
  } else if (/^#[0-9a-fA-F]{6}/.test(color)) {
    r = parseInt(color.slice(1, 3), 16); g = parseInt(color.slice(3, 5), 16); b = parseInt(color.slice(5, 7), 16)
  } else if (color === 'white') { r = g = b = 255 }
  else if (color === 'black') { r = g = b = 0 }
  else if (color.startsWith('black@')) { r = g = b = 0; a = parseFloat(color.slice(6)) }
  else if (color === 'transparent') { a = 0 }
  if (forceAlpha !== undefined) a = forceAlpha
  const aa = Math.round((1 - Math.max(0, Math.min(1, a))) * 255)
  const hex2 = (n: number): string => Math.round(n).toString(16).padStart(2, '0').toUpperCase()
  return `&H${hex2(aa)}${hex2(b)}${hex2(g)}${hex2(r)}`
}

function escapeASSText(text: string): string {
  return text.replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N')
}

function buildASSFile(
  captions: ExportCaption[],
  width: number,
  height: number,
  fontScale: number,
): string {
  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ]

  // One style per caption to carry per-caption visual settings.
  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i]
    const fontsize = Math.max(8, Math.round((cap.fontSize || 32) * fontScale))
    const bold = cap.bold ? -1 : 0
    const fontname = (cap.fontFamily || 'Arial').replace(/,/g, '')
    const primary = toASSColor(cap.color || 'white', 1.0)
    // SecondaryColour is the "before-karaoke-sweep" colour — set to highlight so the word
    // sweeps from highlightColor → primaryColor as it's spoken (closest match to preview).
    const secondary = cap.highlightColor ? toASSColor(cap.highlightColor, 1.0) : primary
    const strokeW = Math.round((cap.strokeWidth || 0) * fontScale)
    const outlineColor = strokeW > 0 ? toASSColor(cap.strokeColor || '#000000', 1.0) : '&H00000000'
    const isTransparentBg = !cap.background
      || cap.background === 'transparent'
      || cap.background.endsWith('@0')
      || cap.background.endsWith('@0.0')
    const borderStyle = isTransparentBg ? 1 : 3
    const backColor = isTransparentBg ? '&H00000000' : toASSColor(cap.background!)
    const outline = isTransparentBg ? strokeW : 0
    // Alignment 8 = top-center; exact position set per-event via \pos()
    lines.push(
      `Style: Cap_${i},${fontname},${fontsize},${primary},${secondary},${outlineColor},${backColor},` +
      `${bold},0,0,0,100,100,0,0,${borderStyle},${outline},0,8,10,10,10,1`
    )
  }

  lines.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')

  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i]
    const textX = Math.round(width / 2)
    const textY = Math.round((cap.positionY || 85) * height / 100)
    const pos = `{\\pos(${textX},${textY})}`

    let text: string
    if (cap.words && cap.words.length > 0 && cap.highlightColor) {
      // Karaoke: \kf sweeps SecondaryColour→PrimaryColour over each word's duration.
      const parts = cap.words
        .map((w) => `{\\kf${Math.max(1, Math.round((w.endTime - w.startTime) * 100))}}${escapeASSText(w.word)}`)
        .join(' ')
      text = pos + parts
    } else {
      text = pos + escapeASSText(cap.text)
    }

    lines.push(`Dialogue: 0,${toASSTime(cap.startTime)},${toASSTime(cap.endTime)},Cap_${i},,0,0,0,,${text}`)
  }

  return lines.join('\n')
}

export async function exportVideo(options: ExportJobOptions): Promise<ExportResult> {
  const { clips, audioClips, muteVideoAudio, captions, effects, outputPath, width, height, fps, crf, debug, onProgress } = options

  if (clips.length === 0) {
    throw new Error('No clips to export')
  }

  const debugEnabled = Boolean(debug)
  const outputDir = path.dirname(outputPath)
  const outputBaseName = path.basename(outputPath, path.extname(outputPath))
  const debugDir = debugEnabled
    ? path.join(outputDir, `${outputBaseName}_debug_${Date.now()}`)
    : undefined
  if (debugDir) fs.mkdirSync(debugDir, { recursive: true })

  // Resolve the real long path — os.tmpdir() can return 8.3 short names on Windows
  // (e.g. WILLBR~1 instead of willbraden) which FFmpeg's concat demuxer may not resolve.
  const tmpDir = debugDir ?? fs.realpathSync(os.tmpdir())
  const segmentListPath = path.join(tmpDir, 've_segments.txt')
  const debugLogPath = debugDir ? path.join(debugDir, 'ffmpeg-debug.log') : null
  const appendDebug = (label: string, payload: string): void => {
    if (!debugLogPath) return
    fs.appendFileSync(debugLogPath, `\n\n=== ${label} ===\n${payload}\n`)
  }
  const toText = (v: string | Buffer | undefined): string => {
    if (!v) return ''
    return typeof v === 'string' ? v : v.toString('utf8')
  }
  const runFfmpeg = async (label: string, args: string[], extra: Parameters<typeof execFileAsync>[2] = {}): Promise<{ stdout: string; stderr: string }> => {
    appendDebug(`${label} command`, `${ffmpegPath} ${args.join(' ')}`)
    try {
      const res = await execFileAsync(ffmpegPath, args, extra)
      const stdout = toText(res.stdout)
      const stderr = toText(res.stderr)
      if (stdout) appendDebug(`${label} stdout`, stdout)
      if (stderr) appendDebug(`${label} stderr`, stderr)
      return { stdout, stderr }
    } catch (e) {
      const err = e as { message?: string; stdout?: string | Buffer; stderr?: string | Buffer }
      const stdout = toText(err.stdout)
      const stderr = toText(err.stderr)
      if (stdout) appendDebug(`${label} stdout`, stdout)
      if (stderr) appendDebug(`${label} stderr`, stderr)
      appendDebug(`${label} error`, err.message ?? String(e))
      throw e
    }
  }

  // Build individual trimmed segments then concat
  const segmentPaths: string[] = []

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const segPath = path.join(tmpDir, `ve_seg_${i}.mp4`)
    segmentPaths.push(segPath)
    const duration = Math.max(0.01, clip.sourceEnd - clip.sourceStart)

    await runFfmpeg(`segment-${i}`, [
      '-ss', String(clip.sourceStart),
      '-i', clip.filePath,
      '-t', String(duration),
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'fast',
      '-fps_mode', 'cfr',
      '-r', String(fps),
      '-an',
      '-y',
      segPath,
    ]).catch((e: Error) => {
      throw new Error(`Failed to encode segment ${i} (${path.basename(clip.filePath)}): ${e.message}`)
    })

    if (!fs.existsSync(segPath)) {
      throw new Error(`Segment ${i} was not created — FFmpeg produced no output for "${path.basename(clip.filePath)}"`)
    }

    if (onProgress) onProgress(Math.round(((i + 1) / clips.length) * 60))
  }

  // Write concat list
  const concatContent = segmentPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n')
  fs.writeFileSync(segmentListPath, concatContent)

  const concatPath = path.join(tmpDir, 've_concat.mp4')

  await runFfmpeg('concat', [
    '-f', 'concat',
    '-safe', '0',
    '-i', segmentListPath,
    '-c', 'copy',
    '-y',
    concatPath,
  ])

  if (onProgress) onProgress(70)

  // Validate captions: drop bad time ranges, sort by start
  const validCaptions = captions
    .map((c) => ({ ...c, startTime: Number(c.startTime), endTime: Number(c.endTime) }))
    .filter((c) => Number.isFinite(c.startTime) && Number.isFinite(c.endTime) && c.endTime > c.startTime)
    .sort((a, b) => a.startTime - b.startTime)

  // Scale font sizes from the preview canvas reference resolution to the actual export resolution.
  const referenceWidth = width > height ? 1920 : 1080
  const fontScale = width / referenceWidth

  // Ensure all needed fonts are downloaded so libass can find them in fontsDir.
  const seenFontKeys = new Set<string>()
  for (const cap of validCaptions) {
    const key = `${cap.fontFamily || ''}:${cap.bold}`
    if (!seenFontKeys.has(key)) {
      seenFontKeys.add(key)
      await resolveFontPath(cap.fontFamily, cap.bold).catch(() => {})
    }
  }

  // Write captions as an ASS subtitle file — avoids Windows ENAMETOOLONG by replacing
  // hundreds of drawtext= filters with a single ass= filter argument.
  let assFilterStr = ''
  const assFilePath = path.join(tmpDir, 've_captions.ass')
  if (validCaptions.length > 0) {
    fs.writeFileSync(assFilePath, buildASSFile(validCaptions, width, height, fontScale), 'utf8')
    const fontsDir = getFontsDir()
    const toFfPath = (p: string): string =>
      p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:')
    assFilterStr = `ass='${toFfPath(assFilePath)}':fontsdir='${toFfPath(fontsDir)}'`
  }

  // Build animated pixelation filters from effects.
  // pixelize only accepts integer block sizes (no per-frame expressions), so we approximate
  // the animation by splitting each effect into 16 equal time slices, each with a linearly
  // interpolated integer block size. At 16 steps the staircase is barely noticeable.
  type PixelateExport = Extract<ExportEffect, { type: 'pixelate' }>
  const pixelizeFilters = (effects ?? [])
    .filter((e): e is PixelateExport => e.type === 'pixelate' && e.timelineEnd > e.timelineStart)
    .flatMap((e) => {
      const STEPS = 16
      const dur = e.timelineEnd - e.timelineStart
      const stepDur = dur / STEPS
      return Array.from({ length: STEPS }, (_, i) => {
        const t0 = (e.timelineStart + i * stepDur).toFixed(4)
        const t1 = (e.timelineStart + (i + 1) * stepDur).toFixed(4)
        const progress = (i + 0.5) / STEPS
        const N = Math.max(2, Math.round(e.startBlockSize + (e.endBlockSize - e.startBlockSize) * progress))
        return `pixelize=width=${N}:height=${N}:enable=between(t\\,${t0}\\,${t1})`
      })
    })

  // Build duotone filters — desaturate with hue=s=0 then remap via curves.
  // Both filters operate in YUV space so output stays yuv420p-compatible (no gbrp issues).
  // curves= maps grayscale [0,1] shadow→highlight for each R/G/B channel.
  type DuotoneExport = Extract<ExportEffect, { type: 'duotone' }>
  const hexToRgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
  const duotoneFilters = (effects ?? [])
    .filter((e): e is DuotoneExport => e.type === 'duotone' && e.timelineEnd > e.timelineStart)
    .flatMap((e) => {
      const [sr, sg, sb] = hexToRgb(e.shadowColor)
      const [hr, hg, hb] = hexToRgb(e.highlightColor)
      const TS = e.timelineStart.toFixed(4)
      const TE = e.timelineEnd.toFixed(4)
      const en = `enable=between(t\\,${TS}\\,${TE})`
      // Normalize shadow/highlight to 0–1 for curves control points: "0/shadow 1/highlight"
      return [
        `hue=s=0:${en}`,
        // No shell quoting here — execFile passes args directly, single-quotes would be literal.
        // Spaces within each option value are fine; FFmpeg's option parser uses : as delimiter.
        `curves=red=0/${(sr/255).toFixed(4)} 1/${(hr/255).toFixed(4)}:green=0/${(sg/255).toFixed(4)} 1/${(hg/255).toFixed(4)}:blue=0/${(sb/255).toFixed(4)} 1/${(hb/255).toFixed(4)}:${en}`,
      ]
    })

  // Build ASCII-like filters: pixelate + grayscale + contrast.
  // Uses pixelize (which supports enable=) instead of scale (which does not).
  type AsciiExport = Extract<ExportEffect, { type: 'ascii' }>
  const asciiFilters = (effects ?? [])
    .filter((e): e is AsciiExport => e.type === 'ascii' && e.timelineEnd > e.timelineStart)
    .flatMap((e) => {
      const TS = e.timelineStart.toFixed(4)
      const TE = e.timelineEnd.toFixed(4)
      const cell = Math.max(4, Math.min(20, Math.round(e.cellSize)))
      const c = Math.max(0.5, Math.min(2.0, e.contrast))
      return [
        `pixelize=width=${cell}:height=${cell}:enable=between(t\\,${TS}\\,${TE})`,
        `hue=s=0:enable=between(t\\,${TS}\\,${TE})`,
        `eq=contrast=${c.toFixed(3)}:enable=between(t\\,${TS}\\,${TE})`,
      ]
    })

  // Build dither-like filters via noise + RGB quantization.
  type DitherExport = Extract<ExportEffect, { type: 'dither' }>
  const ditherFilters = (effects ?? [])
    .filter((e): e is DitherExport => e.type === 'dither' && e.timelineEnd > e.timelineStart)
    .flatMap((e) => {
      const TS = e.timelineStart.toFixed(4)
      const TE = e.timelineEnd.toFixed(4)
      const lv = Math.max(2, Math.min(16, Math.round(e.levels)))
      const step = Math.max(1, Math.round(255 / (lv - 1)))
      const amount = Math.max(0, Math.min(1, e.amount))
      const noise = Math.round(6 + amount * 34)
      const en = `enable=between(t\\,${TS}\\,${TE})`
      return [
        `noise=alls=${noise}:allf=t+u:${en}`,
        `lutrgb=r=trunc(val/${step})*${step}:g=trunc(val/${step})*${step}:b=trunc(val/${step})*${step}:${en}`,
      ]
    })

  // Build chromatic aberration filters via RGB plane shifts.
  type ChromaticExport = Extract<ExportEffect, { type: 'chromatic_aberration' }>
  const chromaticFilters = (effects ?? [])
    .filter((e): e is ChromaticExport => e.type === 'chromatic_aberration' && e.timelineEnd > e.timelineStart)
    .map((e) => {
      const TS = e.timelineStart.toFixed(4)
      const TE = e.timelineEnd.toFixed(4)
      const off = Math.max(0, Math.min(20, Math.round(e.offsetPx)))
      return `rgbashift=rh=${off}:rv=0:gh=0:gv=0:bh=-${off}:bv=0:enable=between(t\\,${TS}\\,${TE})`
    })

  const allVfFilters = [
    ...pixelizeFilters,
    ...ditherFilters,
    ...duotoneFilters,
    ...asciiFilters,
    ...chromaticFilters,
    ...(assFilterStr ? [assFilterStr] : []),
  ]
  const vfFilterStr = allVfFilters.length > 0 ? allVfFilters.join(',') : 'null'
  const includeVideoAudio = !muteVideoAudio
  const timelineVideoAudioClips: ExportAudioClip[] = includeVideoAudio
    ? clips.map((c) => ({
      filePath: c.filePath,
      sourceStart: c.sourceStart,
      sourceEnd: c.sourceEnd,
      timelineStart: c.timelineStart,
      timelineEnd: c.timelineEnd,
    }))
    : []
  const allTimedAudioClips: ExportAudioClip[] = [...timelineVideoAudioClips, ...audioClips]
  const hasAnyTimedAudio = allTimedAudioClips.length > 0

  const finalArgs: string[] = ['-i', concatPath]

  if (hasAnyTimedAudio) {
    // Add each timed audio source (video clip audio + explicit audio track clips) as a trimmed input.
    for (const ac of allTimedAudioClips) {
      const dur = ac.sourceEnd - ac.sourceStart
      finalArgs.push('-ss', String(ac.sourceStart), '-t', String(dur), '-i', ac.filePath)
    }

    // Build filter_complex: video caption filter + audio delay/mix
    const filterParts: string[] = []
    filterParts.push(`[0:v]${vfFilterStr}[vout]`)

    const audioLabels: string[] = []
    for (let i = 0; i < allTimedAudioClips.length; i++) {
      const delayMs = Math.round(allTimedAudioClips[i].timelineStart * 1000)
      const label = `[a${i}]`
      filterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs}${label}`)
      audioLabels.push(label)
    }

    if (audioLabels.length === 1) {
      filterParts.push(`${audioLabels[0]}anull[aout]`)
    } else {
      filterParts.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0[aout]`
      )
    }

    finalArgs.push(
      '-filter_complex', filterParts.join(';'),
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100',
      '-r', String(fps), '-y', outputPath,
    )
  } else {
    // No audio requested/available — export video only.
    finalArgs.push(
      '-vf', vfFilterStr,
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-an',
      '-r', String(fps), '-y', outputPath,
    )
  }

  // Large maxBuffer: FFmpeg writes continuous progress to stderr during encoding.
  // The default 1MB fills up for longer videos, deadlocking the process.
  await runFfmpeg('final-export', finalArgs, { maxBuffer: 500 * 1024 * 1024 })

  if (onProgress) onProgress(100)

  // Cleanup temp files
  if (!debugEnabled) {
    for (const seg of segmentPaths) {
      fs.unlink(seg, () => {})
    }
    fs.unlink(segmentListPath, () => {})
    fs.unlink(concatPath, () => {})
    fs.unlink(assFilePath, () => {})
  }

  if (debugLogPath) {
    appendDebug('summary', `output=${outputPath}\nwidth=${width}\nheight=${height}\nfps=${fps}\ncrf=${crf}\nsegments=${segmentPaths.length}\nvideoAudioInputs=${timelineVideoAudioClips.length}\naudioTrackInputs=${audioClips.length}`)
  }

  return { debugBundlePath: debugDir }
}
