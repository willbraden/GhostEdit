import { useState, useEffect } from 'react'
import { useProjectStore } from '../../store/project'
import type { AspectRatio, Caption, CaptionWord, ExportEffect, PixelateParams, DuotoneParams } from '../../types/project'
import styles from './ExportDialog.module.css'

interface WordOffset {
  word: string
  start: number
  end: number
  xOffset: number   // px from left edge of the rendered line
  yAdjustPx: number // px to shift word DOWN so its baseline matches the full-line baseline
}

interface LineCaptionData {
  text: string
  startTime: number
  endTime: number
  style: Caption['style']
  lineWidthPx: number
  wordOffsets: WordOffset[]
}

// Pre-compute visual line breaks + per-word x-offsets at export resolution.
// Mirrors the Preview's computeVisualLines so positions match what the viewer sees.
async function computeExportCaptions(captions: Caption[], exportWidth: number, exportHeight: number): Promise<LineCaptionData[]> {
  const referenceWidth = exportWidth > exportHeight ? 1920 : 1080
  const fontScale = exportWidth / referenceWidth
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const maxLineW = exportWidth * 0.85
  const result: LineCaptionData[] = []

  // Track font specs we've already awaited so we don't await the same one repeatedly
  const loadedFontSpecs = new Set<string>()

  for (const cap of captions) {
    if (!cap.words || cap.words.length === 0) {
      result.push({ text: cap.text, startTime: cap.startTime, endTime: cap.endTime, style: cap.style, lineWidthPx: 0, wordOffsets: [] })
      continue
    }

    const scaledSize = Math.round((cap.style.fontSize || 32) * fontScale)
    const family = cap.style.fontFamily ? `"${cap.style.fontFamily}", Arial, sans-serif` : 'Arial, sans-serif'
    const fontSpec = `${cap.style.bold ? 'bold ' : ''}${scaledSize}px ${family}`

    // Ensure the font is actually loaded in the browser before measuring.
    // If we skip this, measureText silently falls back to Arial/Times and all
    // x-offsets are computed with the wrong font — causing misaligned highlights.
    if (!loadedFontSpecs.has(fontSpec)) {
      try {
        await document.fonts.load(fontSpec)
      } catch {
        // Best-effort; measurement will use whatever fallback the browser has
      }
      loadedFontSpecs.add(fontSpec)
    }

    ctx.font = fontSpec
    const spaceW = ctx.measureText(' ').width

    // Offset to apply to all word timestamps: accounts for captions that were
    // moved/trimmed on the timeline after transcription. cap.startTime reflects
    // the current timeline position; words[0].start is the original Whisper time.
    const wordOffset = cap.startTime - cap.words[0].start

    // Apply offset AND clamp to monotonically non-overlapping windows.
    // Whisper can produce word timestamps that regress (word N+1 starts before word N
    // ends), especially at 30-second chunk boundaries. In FFmpeg every word gets its
    // own drawtext layer, so overlapping highlight windows cause the later word to
    // visually overwrite the earlier one — highlighting the wrong word.
    let prevEnd = cap.words[0].start + wordOffset
    const adjustedWords: CaptionWord[] = cap.words.map((word) => {
      const adjStart = Math.max(prevEnd, word.start + wordOffset)
      const adjEnd = Math.max(adjStart + 0.01, word.end + wordOffset)
      prevEnd = adjEnd
      return { ...word, start: adjStart, end: adjEnd }
    })

    const lines: CaptionWord[][] = []
    let line: CaptionWord[] = []
    let lineW = 0

    for (const word of adjustedWords) {
      const ww = ctx.measureText(word.word).width
      const needed = line.length > 0 ? spaceW + ww : ww
      if (line.length > 0 && lineW + needed > maxLineW) {
        lines.push(line)
        line = [word]
        lineW = ww
      } else {
        line.push(word)
        lineW += needed
      }
    }
    if (line.length > 0) lines.push(line)

    for (const l of lines) {
      const lineText = l.map((w) => w.word).join(' ')
      // Measure the full line as a single string so lineWidthPx matches FFmpeg's
      // text_w for the same string, and measure prefix strings for each word's
      // xOffset so kerning at word boundaries is accounted for.
      const lineMetrics = ctx.measureText(lineText)
      const lineWidthPx = Math.round(lineMetrics.width)
      // Full-line ascent (baseline → top of tallest glyph in the line).
      // FreeType positions text at y = top-of-bounding-box. Words with only x-height
      // characters have a smaller ascender than words with capitals/ascenders, so they
      // sit too high when all words share the same y. We shift each word down by
      // (lineAscent - wordAscent) so every word's baseline lands at the same pixel.
      const lineAscent = lineMetrics.actualBoundingBoxAscent
      const wordOffsets: WordOffset[] = []
      for (let wi = 0; wi < l.length; wi++) {
        const prefix = wi === 0 ? '' : l.slice(0, wi).map((w) => w.word).join(' ') + ' '
        const xOffset = Math.round(ctx.measureText(prefix).width)
        const wordAscent = ctx.measureText(l[wi].word).actualBoundingBoxAscent
        const yAdjustPx = Math.round(lineAscent - wordAscent)
        // l[wi] already contains the clamped start/end from adjustedWords
        wordOffsets.push({ word: l[wi].word, start: l[wi].start, end: l[wi].end, xOffset, yAdjustPx })
      }

      result.push({
        text: lineText,
        startTime: l[0].start,
        endTime: l[l.length - 1].end,
        style: cap.style,
        lineWidthPx,
        wordOffsets,
      })
    }
  }

  return result
}

interface Props {
  onClose: () => void
}

const RESOLUTIONS: Record<AspectRatio, Array<{ label: string; width: number; height: number }>> = {
  '16:9': [
    { label: '1080p', width: 1920, height: 1080 },
    { label: '720p', width: 1280, height: 720 },
    { label: '480p', width: 854, height: 480 },
  ],
  '9:16': [
    { label: '1080p', width: 1080, height: 1920 },
    { label: '720p', width: 720, height: 1280 },
    { label: '480p', width: 480, height: 854 },
  ],
}

export function ExportDialog({ onClose }: Props) {
  const { project } = useProjectStore()
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const resolutions = RESOLUTIONS[project.aspectRatio]
  const [resIdx, setResIdx] = useState(0)
  const [crf, setCrf] = useState(23)
  const [fps, setFps] = useState<30 | 60>(project.fps)
  const [muteVideoAudio, setMuteVideoAudio] = useState(false)

  useEffect(() => {
    const unsub = window.api.onExportProgress((p) => setProgress(p))
    return unsub
  }, [])

  const handleExport = async (): Promise<void> => {
    const outputPath = await window.api.saveDialog(`${project.name}.mp4`)
    if (!outputPath) return

    setExporting(true)
    setProgress(0)
    setDone(false)
    setError('')

    try {
      const res = resolutions[resIdx]

      // Gather all video clips sorted by timeline position
      const clips = project.tracks
        .filter((t) => t.type === 'video')
        .flatMap((t) => t.clips)
        .sort((a, b) => a.timelineStart - b.timelineStart)
        .map((clip) => {
          const asset = project.assets.find((a) => a.id === clip.assetId)!
          return {
            filePath: asset.filePath,
            sourceStart: clip.sourceStart,
            sourceEnd: clip.sourceEnd,
            timelineStart: clip.timelineStart,
            timelineEnd: clip.timelineEnd,
          }
        })

      // Gather audio track clips
      const audioClips = project.tracks
        .filter((t) => t.type === 'audio')
        .flatMap((t) => t.clips)
        .map((clip) => {
          const asset = project.assets.find((a) => a.id === clip.assetId)!
          return {
            filePath: asset.filePath,
            sourceStart: clip.sourceStart,
            sourceEnd: clip.sourceEnd,
            timelineStart: clip.timelineStart,
            timelineEnd: clip.timelineEnd,
          }
        })

      // Break captions into visual lines at export resolution (same logic as Preview)
      const lineCaptions = await computeExportCaptions(project.captions, res.width, res.height)
      const captions = lineCaptions.map((c) => ({
        text: c.text,
        startTime: c.startTime,
        endTime: c.endTime,
        fontSize: c.style.fontSize,
        color: c.style.color,
        background: c.style.background,
        bold: c.style.bold,
        positionY: c.style.positionY,
        fontFamily: c.style.fontFamily,
        strokeWidth: c.style.strokeWidth,
        strokeColor: c.style.strokeColor,
        highlightColor: c.style.highlightColor,
        lineWidthPx: c.lineWidthPx,
        words: c.wordOffsets.length > 0
          ? c.wordOffsets.map((w) => ({ word: w.word, startTime: w.start, endTime: w.end, xOffset: w.xOffset, yAdjustPx: w.yAdjustPx }))
          : undefined,
      }))

      const effects: ExportEffect[] = (project.effects ?? []).map((e) => {
        if (e.type === 'pixelate') {
          const p = e.params as PixelateParams
          return { type: 'pixelate', timelineStart: e.timelineStart, timelineEnd: e.timelineEnd, startBlockSize: p.startBlockSize, endBlockSize: p.endBlockSize }
        } else {
          const p = e.params as DuotoneParams
          return { type: 'duotone', timelineStart: e.timelineStart, timelineEnd: e.timelineEnd, shadowColor: p.shadowColor, highlightColor: p.highlightColor }
        }
      })

      await window.api.exportVideo({
        clips,
        audioClips,
        muteVideoAudio,
        captions,
        effects,
        outputPath,
        width: res.width,
        height: res.height,
        fps,
        crf,
      })

      setDone(true)
      setProgress(100)
    } catch (e) {
      setError(String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Export Video</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.field}>
            <label>Aspect Ratio</label>
            <span className={styles.fieldValue}>{project.aspectRatio}</span>
          </div>

          <div className={styles.field}>
            <label>Resolution</label>
            <div className={styles.btnGroup}>
              {resolutions.map((r, i) => (
                <button
                  key={r.label}
                  className={`${styles.optionBtn} ${resIdx === i ? styles.optionBtnActive : ''}`}
                  onClick={() => setResIdx(i)}
                >
                  {r.label}
                  <span className={styles.optionSub}>{r.width}×{r.height}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label>Frame Rate</label>
            <div className={styles.btnGroup}>
              {([30, 60] as const).map((f) => (
                <button
                  key={f}
                  className={`${styles.optionBtn} ${fps === f ? styles.optionBtnActive : ''}`}
                  onClick={() => setFps(f)}
                >
                  {f} fps
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label>Quality (CRF)</label>
            <input
              type="range"
              min={15}
              max={35}
              value={crf}
              onChange={(e) => setCrf(Number(e.target.value))}
              className={styles.slider}
            />
            <span className={styles.crfLabel}>
              {crf} — {crf <= 18 ? 'High' : crf <= 24 ? 'Medium' : 'Low'}
            </span>
          </div>

          <div className={styles.field}>
            <label>Video Audio</label>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={muteVideoAudio}
                onChange={(e) => setMuteVideoAudio(e.target.checked)}
              />
              Mute
            </label>
          </div>

          {exporting && (
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              <span className={styles.progressLabel}>{progress}%</span>
            </div>
          )}

          {done && <div className={styles.success}>Export complete!</div>}
          {error && <div className={styles.errorMsg}>{error}</div>}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={exporting}>
            {done ? 'Close' : 'Cancel'}
          </button>
          <button
            className={styles.exportBtn}
            onClick={handleExport}
            disabled={exporting || done}
          >
            {exporting ? `Exporting ${progress}%` : 'Export MP4'}
          </button>
        </div>
      </div>
    </div>
  )
}
