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
  onProgress?: (percent: number) => void
}

export async function exportVideo(options: ExportJobOptions): Promise<void> {
  const { clips, audioClips, muteVideoAudio, captions, effects, outputPath, width, height, fps, crf, onProgress } = options

  if (clips.length === 0) {
    throw new Error('No clips to export')
  }

  // Resolve the real long path — os.tmpdir() can return 8.3 short names on Windows
  // (e.g. WILLBR~1 instead of willbraden) which FFmpeg's concat demuxer may not resolve.
  const tmpDir = fs.realpathSync(os.tmpdir())
  const segmentListPath = path.join(tmpDir, 've_segments.txt')

  // Build individual trimmed segments then concat
  const segmentPaths: string[] = []

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const segPath = path.join(tmpDir, `ve_seg_${i}.mp4`)
    segmentPaths.push(segPath)
    const duration = Math.max(0.01, clip.sourceEnd - clip.sourceStart)

    await execFileAsync(ffmpegPath, [
      '-ss', String(clip.sourceStart),
      '-i', clip.filePath,
      '-t', String(duration),
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'fast',
      '-fps_mode', 'cfr',
      '-r', String(fps),
      '-c:a', 'aac',
      '-ar', '44100',
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
  // CRITICAL: the filtergraph parser does NOT treat \' as an escaped apostrophe — the ' still
  // opens single-quote mode, silently consuming all remaining options into the text value and
  // rendering a blank frame. Solution: replace the ASCII apostrophe (U+0027) with the Unicode
  // right single quotation mark (U+2019), which has no special meaning to the parser.
  // U+2019 is typographically correct and supported by all major fonts.
  // % must be doubled (→ %%) because drawtext uses % for text expansion sequences.
  const escapeText = (t: string): string =>
    t
      .replace(/'/g, '\u2019')  // ASCII apostrophe → U+2019 right single quote (avoids parser quote mode)
      .replace(/\\/g, '\\\\')  // backslash → \\ (must be before other escapes)
      .replace(/"/g, '\\"')    // double-quote → \"
      .replace(/:/g, '\\:')    // colon (option delimiter) → \:
      .replace(/,/g, '\\,')    // comma (filter separator) → \,
      .replace(/\[/g, '\\[')   // bracket (pad label) → \[
      .replace(/\]/g, '\\]')   // bracket (pad label) → \]
      .replace(/%/g, '%%')     // percent → %% (drawtext text expansion)

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
  const drawtextFilters = validCaptions.flatMap((cap) => {
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

    const filters: string[] = []

    if (cap.words && cap.words.length > 0 && cap.lineWidthPx && cap.lineWidthPx > 0 && cap.highlightColor) {
      // Karaoke mode: render each word as an independent drawtext at its canvas-measured
      // x position. The highlight overlay for each word uses the IDENTICAL x,y formula as
      // the normal-color render, so alignment is always pixel-perfect regardless of any
      // canvas vs FreeType advance-width differences.
      const lw = cap.lineWidthPx
      const hlColor = toFfmpegColor(cap.highlightColor)

      // Background box: invisible text just to draw the line's background box.
      filters.push(
        `drawtext=fontfile='${fontFile}'` +
        `:text=${escapeText(cap.text)}` +
        `:fontsize=${fontsize}:fontcolor=black@0` +
        `:box=1:boxcolor=${boxcolor}:boxborderw=8` +
        `:x=(w-${lw})/2:y=${y}` +
        `:enable=between(t\\,${cap.startTime}\\,${cap.endTime})`
      )

      for (const w of cap.words) {
        const wx = `(w-${lw})/2+${w.xOffset}`
        // Shift each word down so its baseline aligns with the full-line baseline.
        // FreeType positions text at y = top-of-bounding-box; words with only x-height
        // glyphs (no ascenders) have a shorter bounding box and sit too high otherwise.
        const wy = w.yAdjustPx > 0 ? `${y}+${w.yAdjustPx}` : y
        const wt = escapeText(w.word)
        // Normal color word — visible throughout the caption's time range
        filters.push(
          `drawtext=fontfile='${fontFile}'` +
          `:text=${wt}:fontsize=${fontsize}:fontcolor=${fontcolor}` +
          strokePart + `:box=0` +
          `:x=${wx}:y=${wy}` +
          `:enable=between(t\\,${cap.startTime}\\,${cap.endTime})`
        )
        // Highlight color word — shown only during this word's time window (drawn on top)
        filters.push(
          `drawtext=fontfile='${fontFile}'` +
          `:text=${wt}:fontsize=${fontsize}:fontcolor=${hlColor}` +
          strokePart + `:box=0` +
          `:x=${wx}:y=${wy}` +
          `:enable=between(t\\,${w.startTime}\\,${w.endTime})`
        )
      }
    } else {
      // Standard mode: single full-line drawtext, no karaoke
      const xBase = cap.lineWidthPx && cap.lineWidthPx > 0
        ? `(w-${cap.lineWidthPx})/2`
        : `(w-text_w)/2`
      filters.push(
        `drawtext=fontfile='${fontFile}'` +
        `:text=${escapeText(cap.text)}` +
        `:fontsize=${fontsize}:fontcolor=${fontcolor}` +
        strokePart +
        `:box=1:boxcolor=${boxcolor}:boxborderw=8` +
        `:x=${xBase}:y=${y}` +
        `:enable=between(t\\,${cap.startTime}\\,${cap.endTime})`
      )
    }

    return filters
  })

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

  const allVfFilters = [...pixelizeFilters, ...duotoneFilters, ...drawtextFilters]
  const vfFilterStr = allVfFilters.length > 0 ? allVfFilters.join(',') : 'null'
  const hasAudioClips = audioClips.length > 0

  // Write filter strings to temp files to avoid ENAMETOOLONG on Windows.
  // With per-word karaoke drawtext filters the inline argument can exceed Windows' ~32KB limit.
  const vfScriptPath = path.join(tmpDir, 've_vf_script.txt')
  const fcScriptPath = path.join(tmpDir, 've_fc_script.txt')

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

    fs.writeFileSync(fcScriptPath, filterParts.join(';'))
    finalArgs.push(
      '-filter_complex_script', fcScriptPath,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100',
      '-r', String(fps), '-y', outputPath,
    )
  } else if (muteVideoAudio || !concatHasAudio) {
    // No audio clips and either muting or no audio in video — export video only
    fs.writeFileSync(vfScriptPath, vfFilterStr)
    finalArgs.push(
      '-filter_script:v', vfScriptPath,
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-an',
      '-r', String(fps), '-y', outputPath,
    )
  } else {
    // No audio clips, video has audio — pass it through
    fs.writeFileSync(vfScriptPath, vfFilterStr)
    finalArgs.push(
      '-filter_script:v', vfScriptPath,
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100',
      '-r', String(fps), '-y', outputPath,
    )
  }

  // Large maxBuffer: FFmpeg writes continuous progress to stderr during encoding.
  // The default 1MB fills up for longer videos, deadlocking the process.
  await execFileAsync(ffmpegPath, finalArgs, { maxBuffer: 500 * 1024 * 1024 })

  if (onProgress) onProgress(100)

  // Cleanup temp files
  for (const seg of segmentPaths) {
    fs.unlink(seg, () => {})
  }
  fs.unlink(segmentListPath, () => {})
  fs.unlink(concatPath, () => {})
  fs.unlink(vfScriptPath, () => {})
  fs.unlink(fcScriptPath, () => {})
}
