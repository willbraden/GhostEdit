import { useRef, useEffect, useCallback } from 'react'
import { useProjectStore } from '../../store/project'
import type { Caption, Effect } from '../../types/project'
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

function getActiveEffect(effects: Effect[] | undefined, currentTime: number): Effect | null {
  if (!effects) return null
  return effects.find((e) => e.timelineEnd > e.timelineStart && currentTime >= e.timelineStart && currentTime < e.timelineEnd) ?? null
}

function drawPixelated(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  blockSize: number,
  width: number,
  height: number
): void {
  const smallW = Math.max(1, Math.floor(width / blockSize))
  const smallH = Math.max(1, Math.floor(height / blockSize))
  const off = new OffscreenCanvas(smallW, smallH)
  off.getContext('2d')!.drawImage(video, 0, 0, smallW, smallH)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(off, 0, 0, width, height)
  ctx.imageSmoothingEnabled = true
}

function drawCaptions(
  ctx: CanvasRenderingContext2D,
  captions: Caption[],
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
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const y = ((caption.style.positionY ?? 85) / 100) * height
    const padding = 12
    const metrics = ctx.measureText(caption.text)
    const textWidth = metrics.width

    const bg = caption.style.background || 'rgba(0,0,0,0.5)'
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

    // Stroke / outline
    const strokeWidth = caption.style.strokeWidth || 0
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
    const activeEffect = getActiveEffect(proj.effects, t)

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (activeEffect && video && video.readyState >= 2) {
      const progress = (t - activeEffect.timelineStart) / (activeEffect.timelineEnd - activeEffect.timelineStart)
      const blockSize = Math.max(1, Math.round(
        activeEffect.params.startBlockSize +
        (activeEffect.params.endBlockSize - activeEffect.params.startBlockSize) * progress
      ))
      drawPixelated(ctx, video, blockSize, canvas.width, canvas.height)
      // No opacity change needed — the canvas draw fills the entire frame, covering the video element
    }

    const active = getActiveCaptions(proj.captions, t)
    drawCaptions(ctx, active, canvas.width, canvas.height)
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
