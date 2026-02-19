import React, { useRef, useCallback, useEffect } from 'react'
import { useProjectStore } from '../../store/project'
import type { Clip, Asset } from '../../types/project'
import styles from './Timeline.module.css'

const TRACK_HEIGHT = 56
const RULER_HEIGHT = 24


function TimeRuler({ zoom, totalDuration }: { zoom: number; totalDuration: number }) {
  const width = Math.max(totalDuration * zoom + 200, 800)
  const ticks: React.ReactElement[] = []

  const step = zoom >= 100 ? 1 : zoom >= 40 ? 5 : 10

  for (let t = 0; t <= totalDuration + step; t += step) {
    const x = t * zoom
    const isMain = t % (step * 5) === 0
    const label = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
    ticks.push(
      <g key={t}>
        <line
          x1={x}
          y1={isMain ? 8 : 14}
          x2={x}
          y2={RULER_HEIGHT}
          stroke={isMain ? '#666' : '#444'}
          strokeWidth="1"
        />
        {isMain && (
          <text x={x + 3} y={RULER_HEIGHT - 4} fill="#888" fontSize="10">
            {label}
          </text>
        )}
      </g>
    )
  }

  return (
    <svg width={width} height={RULER_HEIGHT} style={{ display: 'block' }}>
      <rect width={width} height={RULER_HEIGHT} fill="#1e1e1e" />
      {ticks}
    </svg>
  )
}

interface ClipBlockProps {
  clip: Clip
  zoom: number
  asset: Asset | undefined
  isSelected: boolean
  onSelect: (id: string) => void
  onDragMove: (clipId: string, deltaSeconds: number) => void
  onTrimLeft: (clipId: string, deltaSeconds: number) => void
  onTrimRight: (clipId: string, deltaSeconds: number) => void
}

function ClipBlock({
  clip,
  zoom,
  asset,
  isSelected,
  onSelect,
  onDragMove,
  onTrimLeft,
  onTrimRight,
}: ClipBlockProps) {
  const left = clip.timelineStart * zoom
  const width = Math.max((clip.timelineEnd - clip.timelineStart) * zoom, 20)
  const dragRef = useRef<{ startX: number; startTimelineStart: number } | null>(null)

  const handleMouseDownMove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onSelect(clip.id)
    dragRef.current = { startX: e.clientX, startTimelineStart: clip.timelineStart }

    const onMove = (me: MouseEvent): void => {
      if (!dragRef.current) return
      const delta = (me.clientX - dragRef.current.startX) / zoom
      onDragMove(clip.id, delta)
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const makeTrimHandler = (side: 'left' | 'right') => (e: React.MouseEvent): void => {
    e.stopPropagation()
    const startX = e.clientX

    const onMove = (me: MouseEvent): void => {
      const delta = (me.clientX - startX) / zoom
      if (side === 'left') onTrimLeft(clip.id, delta)
      else onTrimRight(clip.id, delta)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const thumbStyle = asset?.thumbnailPath
    ? { backgroundImage: `url(file://${asset.thumbnailPath})`, backgroundSize: 'cover' }
    : {}

  return (
    <div
      className={`${styles.clip} ${isSelected ? styles.clipSelected : ''}`}
      style={{ left, width, ...thumbStyle }}
      onMouseDown={handleMouseDownMove}
    >
      <div className={styles.clipTrimHandle} onMouseDown={makeTrimHandler('left')} />
      <div className={styles.clipLabel}>{asset?.name ?? 'Clip'}</div>
      <div
        className={`${styles.clipTrimHandle} ${styles.clipTrimRight}`}
        onMouseDown={makeTrimHandler('right')}
      />
    </div>
  )
}

export function Timeline() {
  const { project, zoom, setZoom, currentTime, setCurrentTime, isPlaying, addClip, updateClip, removeClip, selectClip, selectedClipId } =
    useProjectStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  const playheadAnimRef = useRef<number | null>(null)
  const playStartRef = useRef<{ wallTime: number; projectTime: number } | null>(null)
  const totalDuration = useProjectStore((s) => s.totalDuration())

  // Animate playhead when playing
  useEffect(() => {
    if (isPlaying) {
      playStartRef.current = { wallTime: performance.now(), projectTime: currentTime }
      const tick = (): void => {
        if (!playStartRef.current) return
        const elapsed = (performance.now() - playStartRef.current.wallTime) / 1000
        const newTime = playStartRef.current.projectTime + elapsed
        if (newTime >= totalDuration) {
          useProjectStore.getState().setIsPlaying(false)
          useProjectStore.getState().setCurrentTime(totalDuration)
          return
        }
        useProjectStore.getState().setCurrentTime(newTime)
        playheadAnimRef.current = requestAnimationFrame(tick)
      }
      playheadAnimRef.current = requestAnimationFrame(tick)
    } else {
      if (playheadAnimRef.current) cancelAnimationFrame(playheadAnimRef.current)
      playStartRef.current = null
    }
    return () => {
      if (playheadAnimRef.current) cancelAnimationFrame(playheadAnimRef.current)
    }
  }, [isPlaying])

  // Space bar to toggle play
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        const s = useProjectStore.getState()
        s.setIsPlaying(!s.isPlaying)
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = useProjectStore.getState()
        if (s.selectedClipId && !(e.target instanceof HTMLInputElement)) {
          removeClip(s.selectedClipId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeClip])

  const handleRulerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
      setCurrentTime(Math.max(0, x / zoom))
    },
    [zoom, setCurrentTime]
  )

  const handleDragMove = useCallback(
    (clipId: string, delta: number) => {
      const allClips = project.tracks.flatMap((t) => t.clips)
      const clip = allClips.find((c) => c.id === clipId)
      if (!clip) return
      const dur = clip.timelineEnd - clip.timelineStart
      const newStart = Math.max(0, clip.timelineStart + delta)
      updateClip(clipId, { timelineStart: newStart, timelineEnd: newStart + dur })
    },
    [project.tracks, updateClip]
  )

  const handleTrimLeft = useCallback(
    (clipId: string, delta: number) => {
      const allClips = project.tracks.flatMap((t) => t.clips)
      const clip = allClips.find((c) => c.id === clipId)
      if (!clip) return
      const newStart = Math.max(0, clip.timelineStart + delta)
      const newSourceStart = Math.max(0, clip.sourceStart + delta)
      const minWidth = 0.1
      if (newStart >= clip.timelineEnd - minWidth) return
      if (newSourceStart >= clip.sourceEnd - minWidth) return
      updateClip(clipId, { timelineStart: newStart, sourceStart: newSourceStart })
    },
    [project.tracks, updateClip]
  )

  const handleTrimRight = useCallback(
    (clipId: string, delta: number) => {
      const allClips = project.tracks.flatMap((t) => t.clips)
      const clip = allClips.find((c) => c.id === clipId)
      if (!clip) return
      const asset = project.assets.find((a) => a.id === clip.assetId)
      const maxSourceDur = asset?.duration ?? Infinity
      const newEnd = clip.timelineEnd + delta
      const newSourceEnd = Math.min(maxSourceDur, clip.sourceEnd + delta)
      const minWidth = 0.1
      if (newEnd <= clip.timelineStart + minWidth) return
      if (newSourceEnd <= clip.sourceStart + minWidth) return
      updateClip(clipId, { timelineEnd: newEnd, sourceEnd: newSourceEnd })
    },
    [project.tracks, project.assets, updateClip]
  )

  // Drop asset onto track
  const handleDropOnTrack = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.preventDefault()
      const assetId = e.dataTransfer.getData('application/x-asset-id')
      if (!assetId) return
      const asset = project.assets.find((a) => a.id === assetId)
      if (!asset) return

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
      const dropTime = Math.max(0, x / zoom)
      const dur = asset.duration || 5

      addClip(trackId, {
        id: crypto.randomUUID(),
        assetId,
        timelineStart: dropTime,
        timelineEnd: dropTime + dur,
        sourceStart: 0,
        sourceEnd: dur,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      // Seek playhead to the dropped clip so preview shows immediately
      setCurrentTime(dropTime)
    },
    [project.assets, zoom, addClip, setCurrentTime]
  )

  const handleWheelZoom = (e: React.WheelEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setZoom(zoom * (e.deltaY < 0 ? 1.15 : 0.87))
    }
  }

  const contentWidth = Math.max(totalDuration * zoom + 400, 800)
  const playheadX = currentTime * zoom

  return (
    <div className={styles.timeline} onWheel={handleWheelZoom}>
      {/* Track labels column */}
      <div className={styles.labels}>
        <div className={styles.rulerCorner} />
        {project.tracks.map((track) => (
          <div key={track.id} className={styles.trackLabel}>
            <span className={styles.trackLabelType}>{track.type === 'video' ? '▶' : '♫'}</span>
            <span className={styles.trackLabelName}>{track.name}</span>
          </div>
        ))}
      </div>

      {/* Scrollable track area */}
      <div className={styles.scrollArea} ref={scrollRef}>
        {/* Ruler */}
        <div className={styles.ruler} onClick={handleRulerClick} style={{ cursor: 'pointer' }}>
          <TimeRuler zoom={zoom} totalDuration={totalDuration} />
          {/* Playhead line over ruler */}
          <div className={styles.playheadRuler} style={{ left: playheadX }} />
        </div>

        {/* Tracks */}
        <div className={styles.tracks} style={{ width: contentWidth }}>
          {project.tracks.map((track) => (
            <div
              key={track.id}
              className={styles.track}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDropOnTrack(e, track.id)}
              onClick={() => selectClip(null)}
            >
              {track.clips.map((clip) => {
                const asset = project.assets.find((a) => a.id === clip.assetId)
                return (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    zoom={zoom}
                    asset={asset}
                    isSelected={selectedClipId === clip.id}
                    onSelect={selectClip}
                    onDragMove={handleDragMove}
                    onTrimLeft={handleTrimLeft}
                    onTrimRight={handleTrimRight}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* Playhead */}
        <div
          className={styles.playhead}
          style={{ left: playheadX, height: RULER_HEIGHT + project.tracks.length * TRACK_HEIGHT }}
        />
      </div>
    </div>
  )
}
