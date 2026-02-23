import { useRef, useEffect, useCallback } from 'react'
import { useProjectStore } from '../../store/project'
import type { Caption, CaptionWord, Effect, PixelateParams, DuotoneParams } from '../../types/project'
import styles from './Preview.module.css'

function pathToFileUrl(filePath: string): string {
  const p = filePath.replace(/\\/g, '/')
  return p.startsWith('/') ? `file://${p}` : `file:///${p}`
}

function getActiveClip(
  project: ReturnType<typeof useProjectStore.getState>['project'],
  currentTime: number
): { filePath: string; sourceTime: number; timelineStart: number; sourceStart: number } | null {
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]
    if (track.type !== 'video') continue
    for (const clip of track.clips) {
      if (currentTime >= clip.timelineStart && currentTime < clip.timelineEnd) {
        const asset = project.assets.find((a) => a.id === clip.assetId)
        if (!asset) continue
        const sourceTime = clip.sourceStart + (currentTime - clip.timelineStart)
        return { filePath: asset.filePath, sourceTime, timelineStart: clip.timelineStart, sourceStart: clip.sourceStart }
      }
    }
  }
  return null
}

function getActiveCaptions(captions: Caption[], currentTime: number): Caption[] {
  return captions.filter(
    (c) => c.endTime > c.startTime && currentTime >= c.startTime && currentTime <= c.endTime
  )
}

function getActiveEffects(effects: Effect[] | undefined, currentTime: number): Effect[] {
  if (!effects) return []
  return effects.filter(
    (e) => e.timelineEnd > e.timelineStart && currentTime >= e.timelineStart && currentTime < e.timelineEnd
  )
}

// Returns an OffscreenCanvas with pixelation applied to the source image
function applyPixelate(source: CanvasImageSource, blockSize: number, width: number, height: number): OffscreenCanvas {
  const smallW = Math.max(1, Math.floor(width / blockSize))
  const smallH = Math.max(1, Math.floor(height / blockSize))
  const small = new OffscreenCanvas(smallW, smallH)
  small.getContext('2d')!.drawImage(source, 0, 0, smallW, smallH)
  const result = new OffscreenCanvas(width, height)
  const rCtx = result.getContext('2d')!
  rCtx.imageSmoothingEnabled = false
  rCtx.drawImage(small, 0, 0, width, height)
  return result
}

// Returns an OffscreenCanvas with duotone applied to the source image
function applyDuotone(source: CanvasImageSource, shadowHex: string, highlightHex: string, width: number, height: number): OffscreenCanvas {
  const ph = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
  const [sr, sg, sb] = ph(shadowHex)
  const [hr, hg, hb] = ph(highlightHex)

  // Work at half resolution for performance
  const w = Math.max(1, Math.floor(width / 2))
  const h = Math.max(1, Math.floor(height / 2))
  const off = new OffscreenCanvas(w, h)
  const offCtx = off.getContext('2d')!
  offCtx.drawImage(source, 0, 0, w, h)

  const imageData = offCtx.getImageData(0, 0, w, h)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255
    data[i]     = Math.round(sr + lum * (hr - sr))
    data[i + 1] = Math.round(sg + lum * (hg - sg))
    data[i + 2] = Math.round(sb + lum * (hb - sb))
  }
  offCtx.putImageData(imageData, 0, 0)

  const result = new OffscreenCanvas(width, height)
  result.getContext('2d')!.drawImage(off, 0, 0, width, height)
  return result
}

// Break words into visual lines that fit within maxWidth at the current ctx font.
function computeVisualLines(words: CaptionWord[], ctx: CanvasRenderingContext2D, maxWidth: number): CaptionWord[][] {
  if (words.length === 0) return []
  const spaceW = ctx.measureText(' ').width
  const lines: CaptionWord[][] = []
  let line: CaptionWord[] = []
  let lineW = 0

  for (const word of words) {
    const ww = ctx.measureText(word.word).width
    const needed = line.length > 0 ? spaceW + ww : ww
    if (line.length > 0 && lineW + needed > maxWidth) {
      lines.push(line)
      line = [word]
      lineW = ww
    } else {
      line.push(word)
      lineW += needed
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

function drawCaptions(
  ctx: CanvasRenderingContext2D,
  captions: Caption[],
  currentTime: number,
  width: number,
  height: number
): void {
  for (const caption of captions) {
    const fontSize = caption.style.fontSize || 32
    const bold = caption.style.bold ? 'bold ' : ''
    const family = caption.style.fontFamily
      ? `"${caption.style.fontFamily}", Arial, sans-serif`
      : 'Arial, sans-serif'
    ctx.font = `${bold}${fontSize}px ${family}`
    ctx.textBaseline = 'middle'

    const y = ((caption.style.positionY ?? 85) / 100) * height
    const padding = 12
    const bg = caption.style.background || 'rgba(0,0,0,0.5)'
    const strokeWidth = caption.style.strokeWidth || 0

    const words: CaptionWord[] = caption.words ?? []

    if (words.length > 0) {
      // Dynamic visual lines: number of words per line adjusts to font size
      const lines = computeVisualLines(words, ctx, width * 0.85)
      const spaceW = ctx.measureText(' ').width

      const activeWordIdx = words.findIndex((w) => currentTime >= w.start && currentTime <= w.end)

      // Determine which line to show
      const lineForWord = (wi: number): number => {
        let count = 0
        for (let li = 0; li < lines.length; li++) {
          if (wi < count + lines[li].length) return li
          count += lines[li].length
        }
        return lines.length - 1
      }

      let activeLineIdx = 0
      if (activeWordIdx >= 0) {
        activeLineIdx = lineForWord(activeWordIdx)
      } else {
        // Show the line of the most recently completed word
        let lastSpoken = -1
        for (let wi = 0; wi < words.length; wi++) {
          if (words[wi].end <= currentTime) lastSpoken = wi
          else break
        }
        if (lastSpoken >= 0) activeLineIdx = lineForWord(lastSpoken)
      }

      const activeLine = lines[activeLineIdx]
      let lineStartIdx = 0
      for (let li = 0; li < activeLineIdx; li++) lineStartIdx += lines[li].length
      const activeInLine = activeWordIdx >= lineStartIdx && activeWordIdx < lineStartIdx + activeLine.length
        ? activeWordIdx - lineStartIdx
        : -1

      const lineWidths = activeLine.map((w) => ctx.measureText(w.word).width)
      const totalW = lineWidths.reduce((a, b) => a + b, 0) + Math.max(0, activeLine.length - 1) * spaceW
      const startX = width / 2 - totalW / 2

      if (bg !== 'transparent') {
        ctx.fillStyle = bg
        ctx.roundRect(startX - padding, y - fontSize / 2 - padding / 2, totalW + padding * 2, fontSize + padding, 6)
        ctx.fill()
      }

      ctx.textAlign = 'left'

      if (strokeWidth > 0) {
        ctx.lineWidth = strokeWidth * 2
        ctx.lineJoin = 'round'
        ctx.strokeStyle = caption.style.strokeColor || '#000000'
        let x = startX
        for (let i = 0; i < activeLine.length; i++) {
          ctx.strokeText(activeLine[i].word, x, y)
          x += lineWidths[i] + spaceW
        }
      }

      const highlightColor = caption.style.highlightColor || '#ffe400'
      const normalColor = caption.style.color || '#ffffff'
      let x = startX
      for (let i = 0; i < activeLine.length; i++) {
        ctx.fillStyle = i === activeInLine ? highlightColor : normalColor
        ctx.fillText(activeLine[i].word, x, y)
        x += lineWidths[i] + spaceW
      }
    } else {
      // Full-text fallback (no word timestamps — old projects or manually edited)
      ctx.textAlign = 'center'
      const textWidth = ctx.measureText(caption.text).width

      if (bg !== 'transparent') {
        ctx.fillStyle = bg
        ctx.roundRect(
          width / 2 - textWidth / 2 - padding,
          y - fontSize / 2 - padding / 2,
          textWidth + padding * 2,
          fontSize + padding,
          6
        )
        ctx.fill()
      }

      if (strokeWidth > 0) {
        ctx.lineWidth = strokeWidth * 2
        ctx.lineJoin = 'round'
        ctx.strokeStyle = caption.style.strokeColor || '#000000'
        ctx.strokeText(caption.text, width / 2, y)
      }

      ctx.fillStyle = caption.style.color || 'white'
      ctx.fillText(caption.text, width / 2, y)
    }
  }
}

export function Preview() {
  const { project, currentTime, isPlaying, setIsPlaying } = useProjectStore()

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasAnimRef = useRef<number | null>(null)
  const lastVideoSrcRef = useRef<string | null>(null)
  const audioElemsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  // Keep latest values in refs so event handlers always see current state
  const projectRef = useRef(project)
  const currentTimeRef = useRef(currentTime)
  projectRef.current = project
  currentTimeRef.current = currentTime

  const aspect = project.aspectRatio === '16:9' ? 16 / 9 : 9 / 16

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const t = currentTimeRef.current
    const proj = projectRef.current
    const activeEffects = getActiveEffects(proj.effects, t)

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (activeEffects.length > 0 && video && video.readyState >= 2) {
      // Chain effects in the same order as the FFmpeg export (pixelate → duotone)
      const sorted = [...activeEffects].sort((a, b) => {
        const order: Record<string, number> = { pixelate: 0, duotone: 1 }
        return (order[a.type] ?? 0) - (order[b.type] ?? 0)
      })

      let source: CanvasImageSource = video
      for (const effect of sorted) {
        if (effect.type === 'pixelate') {
          const p = effect.params as PixelateParams
          const progress = (t - effect.timelineStart) / (effect.timelineEnd - effect.timelineStart)
          const blockSize = Math.max(1, Math.round(p.startBlockSize + (p.endBlockSize - p.startBlockSize) * progress))
          source = applyPixelate(source, blockSize, canvas.width, canvas.height)
        } else if (effect.type === 'duotone') {
          const p = effect.params as DuotoneParams
          source = applyDuotone(source, p.shadowColor, p.highlightColor, canvas.width, canvas.height)
        }
      }
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    }

    const active = getActiveCaptions(proj.captions, t)
    drawCaptions(ctx, active, t, canvas.width, canvas.height)
  }, [])

  // Sync video element to timeline
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const activeClip = getActiveClip(project, currentTime)
    renderCanvas()

    if (!activeClip) {
      if (!video.paused) video.pause()
      return
    }

    const src = pathToFileUrl(activeClip.filePath)
    const targetTime = activeClip.sourceTime

    if (src !== lastVideoSrcRef.current) {
      // New source: load, then seek and play once metadata is ready
      lastVideoSrcRef.current = src
      video.pause()
      video.src = src
      video.load()

      video.addEventListener(
        'loadedmetadata',
        () => {
          // Re-read store in case time changed while loading
          const s = useProjectStore.getState()
          const clip = getActiveClip(s.project, s.currentTime)
          video.currentTime = clip ? clip.sourceTime : 0
          if (s.isPlaying) video.play().catch(() => {})
        },
        { once: true }
      )

      video.addEventListener(
        'error',
        () => {
          console.error('Video failed to load:', src, video.error?.message)
        },
        { once: true }
      )
      return
    }

    // Same source
    if (!isPlaying) {
      // Scrubbing: keep video in sync with playhead
      const drift = Math.abs(video.currentTime - targetTime)
      if (drift > 0.08) video.currentTime = targetTime
      if (!video.paused) video.pause()
    } else {
      // Playing
      if (video.paused) {
        // Video is paused but should be playing. Seek to the correct position
        // before resuming (handles stale position from previous play session).
        const drift = Math.abs(video.currentTime - targetTime)
        if (drift > 0.1) video.currentTime = targetTime
        video.play().catch(() => {})
      } else if (video.readyState >= 2) {
        // Video is actively playing. Correct significant drift — this handles
        // clip transitions where two clips share the same source file but have
        // different source positions (trimmed clips, multi-track, etc).
        const drift = Math.abs(video.currentTime - targetTime)
        if (drift > 0.5) video.currentTime = targetTime
      }
    }
  }, [currentTime, isPlaying, project, renderCanvas])

  // Sync audio clips (audio tracks)
  useEffect(() => {
    const audioClips = project.tracks
      .filter((t) => t.type === 'audio')
      .flatMap((t) => t.clips)

    // Create audio elements for new clips
    for (const clip of audioClips) {
      const asset = project.assets.find((a) => a.id === clip.assetId)
      if (!asset) continue
      if (!audioElemsRef.current.has(clip.id)) {
        const el = new Audio()
        el.preload = 'auto'
        el.src = pathToFileUrl(asset.filePath)
        audioElemsRef.current.set(clip.id, el)
      }
    }

    // Remove stale audio elements
    const activeIds = new Set(audioClips.map((c) => c.id))
    for (const [id, el] of audioElemsRef.current) {
      if (!activeIds.has(id)) {
        el.pause()
        audioElemsRef.current.delete(id)
      }
    }

    // Sync playback state for each audio clip
    for (const clip of audioClips) {
      const el = audioElemsRef.current.get(clip.id)
      if (!el) continue

      const inRange = currentTime >= clip.timelineStart && currentTime < clip.timelineEnd
      const targetTime = clip.sourceStart + (currentTime - clip.timelineStart)

      if (!inRange) {
        if (!el.paused) el.pause()
      } else if (!isPlaying) {
        el.currentTime = targetTime
        if (!el.paused) el.pause()
      } else {
        const drift = Math.abs(el.currentTime - targetTime)
        if (el.paused || drift > 1.5) {
          el.currentTime = targetTime
          el.play().catch(() => {})
        }
      }
    }
  }, [currentTime, isPlaying, project])

  // Canvas repaint loop during playback
  useEffect(() => {
    if (isPlaying) {
      const tick = (): void => {
        renderCanvas()
        canvasAnimRef.current = requestAnimationFrame(tick)
      }
      canvasAnimRef.current = requestAnimationFrame(tick)
    } else {
      if (canvasAnimRef.current) cancelAnimationFrame(canvasAnimRef.current)
      renderCanvas()
    }
    return () => {
      if (canvasAnimRef.current) cancelAnimationFrame(canvasAnimRef.current)
    }
  }, [isPlaying, renderCanvas])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      for (const el of audioElemsRef.current.values()) el.pause()
    }
  }, [])

  const activeClip = getActiveClip(project, currentTime)

  return (
    <div className={styles.previewWrapper}>
      <div className={styles.previewContainer} style={{ aspectRatio: String(aspect) }}>
        <video
          ref={videoRef}
          className={styles.video}
          preload="auto"
          playsInline
          onEnded={() => setIsPlaying(false)}
        />
        <canvas
          ref={canvasRef}
          className={styles.captionCanvas}
          width={project.aspectRatio === '16:9' ? 1920 : 1080}
          height={project.aspectRatio === '16:9' ? 1080 : 1920}
        />
        {!activeClip && (
          <div className={styles.emptyOverlay}>
            <span>Drop clips on the timeline to preview</span>
          </div>
        )}
      </div>
    </div>
  )
}
