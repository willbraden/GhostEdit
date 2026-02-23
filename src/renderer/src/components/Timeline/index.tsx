import React, { useRef, useCallback, useEffect, useState } from 'react'
import { useProjectStore } from '../../store/project'
import type { Clip, Asset, Caption, Effect, PixelateParams, DuotoneParams } from '../../types/project'
import styles from './Timeline.module.css'

const TRACK_HEIGHT = 56
const RULER_HEIGHT = 24
const MIN_ZOOM = 20
const MAX_ZOOM = 500

// Log scale: zoom=20 → slider=0, zoom=100 → slider=50, zoom=500 → slider=100
function zoomToSlider(z: number): number {
  return Math.round(100 * Math.log(z / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM))
}
function sliderToZoom(v: number): number {
  return Math.round(MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, v / 100))
}

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
        <line x1={x} y1={isMain ? 8 : 14} x2={x} y2={RULER_HEIGHT} stroke={isMain ? '#666' : '#444'} strokeWidth="1" />
        {isMain && <text x={x + 3} y={RULER_HEIGHT - 4} fill="#888" fontSize="10">{label}</text>}
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
  onDragStart: (clipId: string) => void
  onSelect: (id: string) => void
  onDragMove: (clipId: string, newTimelineStart: number, clientY: number) => void
  onDragEnd: (clipId: string, clientY: number) => void
  onTrimLeft: (clipId: string, newTimelineStart: number, newSourceStart: number) => void
  onTrimRight: (clipId: string, newTimelineEnd: number, newSourceEnd: number) => void
  onContextMenu: (clipId: string, x: number, y: number) => void
}

function ClipBlock({
  clip, zoom, asset, isSelected, onDragStart, onSelect, onDragMove, onDragEnd, onTrimLeft, onTrimRight, onContextMenu,
}: ClipBlockProps) {
  const left = clip.timelineStart * zoom
  const width = Math.max((clip.timelineEnd - clip.timelineStart) * zoom, 20)

  const handleMouseDownMove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!isSelected) onSelect(clip.id)
    onDragStart(clip.id)
    const startX = e.clientX
    const capTimelineStart = clip.timelineStart

    const onMove = (me: MouseEvent): void => {
      const delta = (me.clientX - startX) / zoom
      onDragMove(clip.id, Math.max(0, capTimelineStart + delta), me.clientY)
    }
    const onUp = (me: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onDragEnd(clip.id, me.clientY)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const makeTrimHandler = (side: 'left' | 'right') => (e: React.MouseEvent): void => {
    e.stopPropagation()
    const startX = e.clientX
    const capTimelineStart = clip.timelineStart
    const capTimelineEnd = clip.timelineEnd
    const capSourceStart = clip.sourceStart
    const capSourceEnd = clip.sourceEnd

    const onMove = (me: MouseEvent): void => {
      const delta = (me.clientX - startX) / zoom
      if (side === 'left') {
        const newTimelineStart = Math.max(0, capTimelineStart + delta)
        const newSourceStart = Math.max(0, capSourceStart + delta)
        if (newTimelineStart < capTimelineEnd - 0.1 && newSourceStart < capSourceEnd - 0.1) {
          onTrimLeft(clip.id, newTimelineStart, newSourceStart)
        }
      } else {
        const newTimelineEnd = capTimelineEnd + delta
        const newSourceEnd = capSourceEnd + delta
        if (newTimelineEnd > capTimelineStart + 0.1) {
          onTrimRight(clip.id, newTimelineEnd, newSourceEnd)
        }
      }
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(clip.id, e.clientX, e.clientY)
  }

  const thumbStyle = asset?.thumbnailPath
    ? { backgroundImage: `url(file://${asset.thumbnailPath})`, backgroundSize: 'cover' }
    : {}

  return (
    <div
      className={`${styles.clip} ${isSelected ? styles.clipSelected : ''}`}
      style={{ left, width, ...thumbStyle }}
      onMouseDown={handleMouseDownMove}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={handleContextMenu}
    >
      <div className={styles.clipTrimHandle} onMouseDown={makeTrimHandler('left')} />
      <div className={styles.clipLabel}>{asset?.name ?? 'Clip'}</div>
      <div className={`${styles.clipTrimHandle} ${styles.clipTrimRight}`} onMouseDown={makeTrimHandler('right')} />
    </div>
  )
}

interface CaptionBlockProps {
  caption: Caption
  zoom: number
  isSelected: boolean
  onDragStart: (captionId: string) => void
  onSelect: (id: string) => void
  onDragMove: (captionId: string, newStart: number, newEnd: number) => void
  onTrimLeft: (captionId: string, newStart: number) => void
  onTrimRight: (captionId: string, newEnd: number) => void
  onDragEnd: () => void
}

function CaptionBlock({
  caption, zoom, isSelected, onDragStart, onSelect, onDragMove, onTrimLeft, onTrimRight, onDragEnd,
}: CaptionBlockProps) {
  const left = caption.startTime * zoom
  const width = Math.max((caption.endTime - caption.startTime) * zoom, 20)
  const dragRef = useRef<{ startX: number; startTime: number; endTime: number } | null>(null)

  const handleMouseDownMove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!isSelected) onSelect(caption.id)
    onDragStart(caption.id)
    dragRef.current = { startX: e.clientX, startTime: caption.startTime, endTime: caption.endTime }

    const onMove = (me: MouseEvent): void => {
      if (!dragRef.current) return
      const delta = (me.clientX - dragRef.current.startX) / zoom
      const dur = dragRef.current.endTime - dragRef.current.startTime
      const newStart = Math.max(0, dragRef.current.startTime + delta)
      onDragMove(caption.id, newStart, newStart + dur)
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onDragEnd()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const makeTrimHandler = (side: 'left' | 'right') => (e: React.MouseEvent): void => {
    e.stopPropagation()
    const startX = e.clientX
    const captureStart = caption.startTime
    const captureEnd = caption.endTime

    const onMove = (me: MouseEvent): void => {
      const delta = (me.clientX - startX) / zoom
      if (side === 'left') {
        const newStart = Math.max(0, captureStart + delta)
        if (newStart < captureEnd - 0.1) onTrimLeft(caption.id, newStart)
      } else {
        const newEnd = Math.max(captureStart + 0.1, captureEnd + delta)
        onTrimRight(caption.id, newEnd)
      }
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onDragEnd()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`${styles.captionBlock} ${isSelected ? styles.captionBlockSelected : ''}`}
      style={{ left, width }}
      onMouseDown={handleMouseDownMove}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.clipTrimHandle} onMouseDown={makeTrimHandler('left')} />
      <div className={styles.captionBlockLabel}>{caption.text}</div>
      <div className={`${styles.clipTrimHandle} ${styles.clipTrimRight}`} onMouseDown={makeTrimHandler('right')} />
    </div>
  )
}

interface EffectBlockProps {
  effect: Effect
  zoom: number
  isSelected: boolean
  onSelect: (id: string) => void
  onDragMove: (effectId: string, newStart: number, newEnd: number) => void
  onTrimLeft: (effectId: string, newStart: number) => void
  onTrimRight: (effectId: string, newEnd: number) => void
  onDragEnd: () => void
}

function EffectBlock({ effect, zoom, isSelected, onSelect, onDragMove, onTrimLeft, onTrimRight, onDragEnd }: EffectBlockProps) {
  const left = effect.timelineStart * zoom
  const width = Math.max((effect.timelineEnd - effect.timelineStart) * zoom, 20)
  const dragRef = useRef<{ startX: number; startTime: number; endTime: number } | null>(null)

  const handleMouseDownMove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!isSelected) onSelect(effect.id)
    dragRef.current = { startX: e.clientX, startTime: effect.timelineStart, endTime: effect.timelineEnd }

    const onMove = (me: MouseEvent): void => {
      if (!dragRef.current) return
      const delta = (me.clientX - dragRef.current.startX) / zoom
      const dur = dragRef.current.endTime - dragRef.current.startTime
      const newStart = Math.max(0, dragRef.current.startTime + delta)
      onDragMove(effect.id, newStart, newStart + dur)
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onDragEnd()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const makeTrimHandler = (side: 'left' | 'right') => (e: React.MouseEvent): void => {
    e.stopPropagation()
    const startX = e.clientX
    const captureStart = effect.timelineStart
    const captureEnd = effect.timelineEnd

    const onMove = (me: MouseEvent): void => {
      const delta = (me.clientX - startX) / zoom
      if (side === 'left') {
        const newStart = Math.max(0, captureStart + delta)
        if (newStart < captureEnd - 0.1) onTrimLeft(effect.id, newStart)
      } else {
        const newEnd = Math.max(captureStart + 0.1, captureEnd + delta)
        onTrimRight(effect.id, newEnd)
      }
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onDragEnd()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const isDuotone = effect.type === 'duotone'

  return (
    <div
      className={[
        styles.effectBlock,
        isDuotone ? styles.effectBlockDuotone : '',
        isSelected ? (isDuotone ? styles.effectBlockDuotoneSelected : styles.effectBlockSelected) : '',
      ].join(' ')}
      style={{ left, width }}
      onMouseDown={handleMouseDownMove}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.clipTrimHandle} onMouseDown={makeTrimHandler('left')} />
      <div className={styles.effectBlockLabel}>{isDuotone ? 'Duotone' : 'Pixelate'}</div>
      <div className={`${styles.clipTrimHandle} ${styles.clipTrimRight}`} onMouseDown={makeTrimHandler('right')} />
    </div>
  )
}

export function Timeline() {
  const {
    project,
    zoom,
    setZoom,
    currentTime,
    setCurrentTime,
    isPlaying,
    setPlaybackAnchor,
    addClip,
    addCaptions,
    updateClip,
    removeClip,
    moveClipToTrack,
    selectClip,
    selectedIds,
    setSelectedIds,
    updateCaption,
    removeCaption,
    selectCaption,
    selectedCaptionId,
    deoverlapCaptions,
    addEffect,
    removeEffect,
    updateEffect,
    selectEffect,
    selectedEffectId,
  } = useProjectStore()

  const [captionMenu, setCaptionMenu] = useState<{ x: number; y: number; time: number } | null>(null)
  const [clipMenu, setClipMenu] = useState<{ x: number; y: number; clipId: string } | null>(null)
  const [effectsMenu, setEffectsMenu] = useState<{ x: number; y: number; time: number } | null>(null)
  const [selectBox, setSelectBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [hoverTrackIdx, setHoverTrackIdx] = useState<number | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const playheadAnimRef = useRef<number | null>(null)
  const zoomRef = useRef(zoom)

  // Origins captured at drag-start for multi-move
  const clipOriginsRef = useRef<Map<string, { timelineStart: number; timelineEnd: number }>>(new Map())
  const captionOriginsRef = useRef<Map<string, { startTime: number; endTime: number }>>(new Map())

  const totalDuration = useProjectStore((s) => s.totalDuration())

  // Close context menus on any outside click
  useEffect(() => {
    if (!captionMenu && !clipMenu && !effectsMenu) return
    const close = (): void => { setCaptionMenu(null); setClipMenu(null); setEffectsMenu(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [captionMenu, clipMenu, effectsMenu])

  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Animate playhead when playing
  useEffect(() => {
    if (isPlaying) {
      setPlaybackAnchor({ wallTime: performance.now(), projectTime: currentTime })
      const tick = (): void => {
        const anchor = useProjectStore.getState().playbackAnchor
        if (!anchor) return
        const elapsed = (performance.now() - anchor.wallTime) / 1000
        const newTime = anchor.projectTime + elapsed
        if (newTime >= totalDuration) {
          useProjectStore.getState().setIsPlaying(false)
          useProjectStore.getState().setCurrentTime(totalDuration)
          useProjectStore.getState().setPlaybackAnchor(null)
          return
        }
        useProjectStore.getState().setCurrentTime(newTime)
        playheadAnimRef.current = requestAnimationFrame(tick)
      }
      playheadAnimRef.current = requestAnimationFrame(tick)
    } else {
      if (playheadAnimRef.current) cancelAnimationFrame(playheadAnimRef.current)
      setPlaybackAnchor(null)
    }
    return () => { if (playheadAnimRef.current) cancelAnimationFrame(playheadAnimRef.current) }
  }, [isPlaying])

  // Space bar + Delete key handlers
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        const s = useProjectStore.getState()
        s.setIsPlaying(!s.isPlaying)
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        const s = useProjectStore.getState()
        if (s.selectedEffectId) {
          s.removeEffect(s.selectedEffectId)
          s.selectEffect(null)
        }
        const captionIdSet = new Set(s.project.captions.map((c) => c.id))
        for (const id of s.selectedIds) {
          if (captionIdSet.has(id)) s.removeCaption(id)
          else s.removeClip(id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeClip, removeCaption])

  const handleRulerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      setCurrentTime(Math.max(0, (e.clientX - rect.left) / zoom))
    },
    [zoom, setCurrentTime]
  )

  // Capture origins of all currently selected items at drag-start
  const captureOrigins = useCallback((primaryClipId?: string, primaryCaptionId?: string): void => {
    const { project: proj, selectedIds: ids } = useProjectStore.getState()
    const idSet = new Set(ids)
    clipOriginsRef.current.clear()
    captionOriginsRef.current.clear()

    for (const track of proj.tracks) {
      for (const clip of track.clips) {
        if (idSet.has(clip.id)) {
          clipOriginsRef.current.set(clip.id, { timelineStart: clip.timelineStart, timelineEnd: clip.timelineEnd })
        }
      }
    }
    for (const cap of proj.captions) {
      if (idSet.has(cap.id)) {
        captionOriginsRef.current.set(cap.id, { startTime: cap.startTime, endTime: cap.endTime })
      }
    }

    // Ensure the dragged item is in origins even if not in selectedIds
    if (primaryClipId && !clipOriginsRef.current.has(primaryClipId)) {
      const clip = proj.tracks.flatMap((t) => t.clips).find((c) => c.id === primaryClipId)
      if (clip) clipOriginsRef.current.set(primaryClipId, { timelineStart: clip.timelineStart, timelineEnd: clip.timelineEnd })
    }
    if (primaryCaptionId && !captionOriginsRef.current.has(primaryCaptionId)) {
      const cap = proj.captions.find((c) => c.id === primaryCaptionId)
      if (cap) captionOriginsRef.current.set(primaryCaptionId, { startTime: cap.startTime, endTime: cap.endTime })
    }
  }, [])

  const handleClipDragStart = useCallback((clipId: string) => captureOrigins(clipId, undefined), [captureOrigins])
  const handleCaptionDragStart = useCallback((captionId: string) => captureOrigins(undefined, captionId), [captureOrigins])

  // Compute which track index a clientY maps to (-1 = out of range)
  const getTrackIdxFromClientY = useCallback((clientY: number): number => {
    const tracksEl = tracksRef.current
    if (!tracksEl) return -1
    const rect = tracksEl.getBoundingClientRect()
    const y = clientY - rect.top
    const idx = Math.floor(y / TRACK_HEIGHT)
    return Math.max(0, Math.min(project.tracks.length - 1, idx))
  }, [project.tracks.length])

  // Move all selected clips + captions by the same delta; update hover track highlight
  const handleDragMove = useCallback(
    (clipId: string, newTimelineStart: number, clientY: number) => {
      setHoverTrackIdx(getTrackIdxFromClientY(clientY))

      const origin = clipOriginsRef.current.get(clipId)
      if (!origin) {
        const clip = useProjectStore.getState().project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
        if (!clip) return
        const dur = clip.timelineEnd - clip.timelineStart
        updateClip(clipId, { timelineStart: newTimelineStart, timelineEnd: newTimelineStart + dur })
        return
      }
      const delta = newTimelineStart - origin.timelineStart
      for (const [id, orig] of clipOriginsRef.current) {
        const dur = orig.timelineEnd - orig.timelineStart
        const start = Math.max(0, orig.timelineStart + delta)
        updateClip(id, { timelineStart: start, timelineEnd: start + dur })
      }
      for (const [id, orig] of captionOriginsRef.current) {
        const dur = orig.endTime - orig.startTime
        const start = Math.max(0, orig.startTime + delta)
        updateCaption(id, { startTime: start, endTime: start + dur })
      }
    },
    [updateClip, updateCaption, getTrackIdxFromClientY]
  )

  // On drag end, move clip to target track if it changed (and type allows it)
  const handleClipDragEnd = useCallback(
    (clipId: string, clientY: number) => {
      setHoverTrackIdx(null)
      const targetIdx = getTrackIdxFromClientY(clientY)
      const { project: proj } = useProjectStore.getState()
      const targetTrack = proj.tracks[targetIdx]
      if (!targetTrack) return
      const currentTrack = proj.tracks.find((t) => t.clips.some((c) => c.id === clipId))
      if (!currentTrack || currentTrack.id === targetTrack.id) return

      // Enforce type compatibility
      const clip = currentTrack.clips.find((c) => c.id === clipId)
      const asset = proj.assets.find((a) => a.id === clip?.assetId)
      if (!asset) return
      if (targetTrack.type === 'audio' && asset.type !== 'audio') return
      if (targetTrack.type === 'video' && asset.type === 'audio') return

      moveClipToTrack(clipId, targetTrack.id)
    },
    [getTrackIdxFromClientY, moveClipToTrack]
  )

  const handleTrimLeft = useCallback(
    (clipId: string, newTimelineStart: number, newSourceStart: number) => {
      const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
      if (!clip) return
      const asset = project.assets.find((a) => a.id === clip.assetId)
      const maxDur = asset?.duration ?? Infinity
      updateClip(clipId, { timelineStart: newTimelineStart, sourceStart: Math.min(maxDur, newSourceStart) })
    },
    [project.tracks, project.assets, updateClip]
  )

  const handleTrimRight = useCallback(
    (clipId: string, newTimelineEnd: number, newSourceEnd: number) => {
      const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
      if (!clip) return
      const asset = project.assets.find((a) => a.id === clip.assetId)
      const maxDur = asset?.duration ?? Infinity
      updateClip(clipId, { timelineEnd: newTimelineEnd, sourceEnd: Math.min(maxDur, newSourceEnd) })
    },
    [project.tracks, project.assets, updateClip]
  )

  const handleResetClip = useCallback(
    (clipId: string) => {
      const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
      if (!clip) return
      const asset = project.assets.find((a) => a.id === clip.assetId)
      if (!asset) return
      const dur = asset.duration || 5
      updateClip(clipId, { timelineEnd: clip.timelineStart + dur, sourceStart: 0, sourceEnd: dur })
      setClipMenu(null)
    },
    [project.tracks, project.assets, updateClip]
  )

  const handleClipContextMenu = useCallback(
    (clipId: string, x: number, y: number) => setClipMenu({ x, y, clipId }),
    []
  )

  // Move all selected captions + clips by the same delta
  const handleCaptionDragMove = useCallback(
    (captionId: string, newStart: number, newEnd: number) => {
      const origin = captionOriginsRef.current.get(captionId)
      if (!origin) {
        updateCaption(captionId, { startTime: newStart, endTime: newEnd })
        return
      }
      const delta = newStart - origin.startTime
      for (const [id, orig] of captionOriginsRef.current) {
        const dur = orig.endTime - orig.startTime
        const start = Math.max(0, orig.startTime + delta)
        updateCaption(id, { startTime: start, endTime: start + dur })
      }
      for (const [id, orig] of clipOriginsRef.current) {
        const dur = orig.timelineEnd - orig.timelineStart
        const start = Math.max(0, orig.timelineStart + delta)
        updateClip(id, { timelineStart: start, timelineEnd: start + dur })
      }
    },
    [updateCaption, updateClip]
  )

  const handleCaptionTrimLeft = useCallback(
    (captionId: string, newStart: number) => updateCaption(captionId, { startTime: newStart }),
    [updateCaption]
  )
  const handleCaptionTrimRight = useCallback(
    (captionId: string, newEnd: number) => updateCaption(captionId, { endTime: newEnd }),
    [updateCaption]
  )

  const handleCaptionTrackContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    setCaptionMenu({ x: e.clientX, y: e.clientY, time: Math.max(0, x / zoom) })
  }

  const insertBlankCaption = (): void => {
    if (!captionMenu) return
    addCaptions([{
      text: '',
      startTime: captionMenu.time,
      endTime: captionMenu.time + 2,
      style: { fontSize: 32, color: '#ffffff', background: 'rgba(0,0,0,0.5)', bold: false, positionY: 85 },
    }])
    setCaptionMenu(null)
  }

  const handleEffectsTrackContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    setEffectsMenu({ x: e.clientX, y: e.clientY, time: Math.max(0, x / zoom) })
  }

  const insertPixelateEffect = (): void => {
    if (!effectsMenu) return
    addEffect({
      type: 'pixelate',
      timelineStart: effectsMenu.time,
      timelineEnd: effectsMenu.time + 3,
      params: { startBlockSize: 4, endBlockSize: 48 },
    })
    setEffectsMenu(null)
  }

  const insertDuotoneEffect = (): void => {
    if (!effectsMenu) return
    addEffect({
      type: 'duotone',
      timelineStart: effectsMenu.time,
      timelineEnd: effectsMenu.time + 5,
      params: { shadowColor: '#c0143c', highlightColor: '#1ed760' },
    })
    setEffectsMenu(null)
  }

  const handleEffectDragMove = useCallback(
    (effectId: string, newStart: number, newEnd: number) => {
      updateEffect(effectId, { timelineStart: newStart, timelineEnd: newEnd })
    },
    [updateEffect]
  )

  const handleEffectTrimLeft = useCallback(
    (effectId: string, newStart: number) => updateEffect(effectId, { timelineStart: newStart }),
    [updateEffect]
  )

  const handleEffectTrimRight = useCallback(
    (effectId: string, newEnd: number) => updateEffect(effectId, { timelineEnd: newEnd }),
    [updateEffect]
  )

  const handleDropOnTrack = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.preventDefault()
      const assetId = e.dataTransfer.getData('application/x-asset-id')
      if (!assetId) return
      const asset = project.assets.find((a) => a.id === assetId)
      if (!asset) return
      const track = project.tracks.find((t) => t.id === trackId)
      if (!track) return
      if (track.type === 'audio' && asset.type !== 'audio') return
      if (track.type === 'video' && asset.type === 'audio') return
      const rect = e.currentTarget.getBoundingClientRect()
      const dropTime = Math.max(0, (e.clientX - rect.left) / zoom)
      const dur = asset.duration || 5
      addClip(trackId, {
        id: crypto.randomUUID(),
        assetId,
        timelineStart: dropTime,
        timelineEnd: dropTime + dur,
        sourceStart: 0,
        sourceEnd: dur,
        x: 0, y: 0, scale: 1, opacity: 1,
      })
      setCurrentTime(dropTime)
    },
    [project.assets, project.tracks, zoom, addClip, setCurrentTime]
  )

  // Non-passive wheel: Ctrl+wheel → zoom, plain wheel → horizontal scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        useProjectStore.getState().setZoom(zoomRef.current * (e.deltaY < 0 ? 1.15 : 0.87))
      } else {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Sync labels column vertical scroll with the scroll area
  useEffect(() => {
    const scrollEl = scrollRef.current
    const labelsEl = labelsRef.current
    if (!scrollEl || !labelsEl) return
    const onScroll = (): void => { labelsEl.scrollTop = scrollEl.scrollTop }
    scrollEl.addEventListener('scroll', onScroll)
    return () => scrollEl.removeEventListener('scroll', onScroll)
  }, [])

  // Drag-select box: fires on mousedown on empty track area (clips stop propagation)
  const handleTracksMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return
      const tracksEl = tracksRef.current
      if (!tracksEl) return
      const rect = tracksEl.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      setSelectedIds([])
      const box = { x1: x, y1: y, x2: x, y2: y }
      setSelectBox({ ...box })

      const onMove = (me: MouseEvent): void => {
        box.x2 = me.clientX - rect.left
        box.y2 = me.clientY - rect.top
        setSelectBox({ ...box })
      }

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setSelectBox(null)

        const minX = Math.min(box.x1, box.x2)
        const maxX = Math.max(box.x1, box.x2)
        const minY = Math.min(box.y1, box.y2)
        const maxY = Math.max(box.y1, box.y2)
        if (maxX - minX < 3 && maxY - minY < 3) return  // click, not drag

        const minTime = minX / zoomRef.current
        const maxTime = maxX / zoomRef.current
        const { project: proj } = useProjectStore.getState()
        const newSelected: string[] = []

        proj.tracks.forEach((track, idx) => {
          const trackTop = idx * TRACK_HEIGHT
          const trackBottom = trackTop + TRACK_HEIGHT
          if (maxY >= trackTop && minY < trackBottom) {
            for (const clip of track.clips) {
              if (clip.timelineStart < maxTime && clip.timelineEnd > minTime) {
                newSelected.push(clip.id)
              }
            }
          }
        })

        const captionTop = proj.tracks.length * TRACK_HEIGHT
        const captionBottom = captionTop + TRACK_HEIGHT
        if (maxY >= captionTop && minY < captionBottom) {
          for (const cap of proj.captions) {
            if (cap.startTime < maxTime && cap.endTime > minTime) {
              newSelected.push(cap.id)
            }
          }
        }

        if (newSelected.length > 0) setSelectedIds(newSelected)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setSelectedIds]
  )

  const contentWidth = Math.max(totalDuration * zoom + 400, 800)
  const playheadX = currentTime * zoom

  // suppress unused warning — selectedCaptionId is consumed by CaptionEditor panel via store
  void selectedCaptionId

  return (
    <div className={styles.timeline}>
      <div className={styles.timelineBody}>
        {/* Track labels column */}
        <div className={styles.labels} ref={labelsRef}>
          <div className={styles.rulerCorner} />
          {project.tracks.map((track) => (
            <div key={track.id} className={styles.trackLabel}>
              <span className={styles.trackLabelType}>{track.type === 'video' ? '▶' : '♫'}</span>
              <span className={styles.trackLabelName}>{track.name}</span>
            </div>
          ))}
          <div className={`${styles.trackLabel} ${styles.captionTrackLabel}`}>
            <span className={styles.trackLabelType}>T</span>
            <span className={styles.trackLabelName}>Captions</span>
          </div>
          <div className={`${styles.trackLabel} ${styles.effectTrackLabel}`}>
            <span className={styles.trackLabelType}>★</span>
            <span className={styles.trackLabelName}>Effects</span>
          </div>
        </div>

        {/* Scrollable track area */}
        <div className={styles.scrollArea} ref={scrollRef}>
          {/* Ruler */}
          <div className={styles.ruler} onClick={handleRulerClick} style={{ cursor: 'pointer' }}>
            <TimeRuler zoom={zoom} totalDuration={totalDuration} />
            <div className={styles.playheadRuler} style={{ left: playheadX }} />
          </div>

          {/* Tracks */}
          <div
            className={styles.tracks}
            style={{ width: contentWidth }}
            ref={tracksRef}
            onMouseDown={handleTracksMouseDown}
          >
            {project.tracks.map((track, trackIdx) => (
              <div
                key={track.id}
                className={`${styles.track} ${hoverTrackIdx === trackIdx ? styles.trackDropTarget : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDropOnTrack(e, track.id)}
              >
                {track.clips.map((clip) => {
                  const asset = project.assets.find((a) => a.id === clip.assetId)
                  return (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      zoom={zoom}
                      asset={asset}
                      isSelected={selectedIds.includes(clip.id)}
                      onDragStart={handleClipDragStart}
                      onSelect={selectClip}
                      onDragMove={handleDragMove}
                      onDragEnd={handleClipDragEnd}
                      onTrimLeft={handleTrimLeft}
                      onTrimRight={handleTrimRight}
                      onContextMenu={handleClipContextMenu}
                    />
                  )
                })}
              </div>
            ))}

            {/* Captions track */}
            <div
              className={`${styles.track} ${styles.captionTrack}`}
              onContextMenu={handleCaptionTrackContextMenu}
            >
              {project.captions.map((caption) => (
                <CaptionBlock
                  key={caption.id}
                  caption={caption}
                  zoom={zoom}
                  isSelected={selectedIds.includes(caption.id)}
                  onDragStart={handleCaptionDragStart}
                  onSelect={selectCaption}
                  onDragMove={handleCaptionDragMove}
                  onTrimLeft={handleCaptionTrimLeft}
                  onTrimRight={handleCaptionTrimRight}
                  onDragEnd={deoverlapCaptions}
                />
              ))}
            </div>

            {/* Effects track */}
            <div
              className={`${styles.track} ${styles.effectsTrack}`}
              onContextMenu={handleEffectsTrackContextMenu}
              onMouseDown={() => selectEffect(null)}
            >
              {(project.effects ?? []).map((effect) => (
                <EffectBlock
                  key={effect.id}
                  effect={effect}
                  zoom={zoom}
                  isSelected={selectedEffectId === effect.id}
                  onSelect={selectEffect}
                  onDragMove={handleEffectDragMove}
                  onTrimLeft={handleEffectTrimLeft}
                  onTrimRight={handleEffectTrimRight}
                  onDragEnd={() => {}}
                />
              ))}
            </div>

            {/* Drag-select box */}
            {selectBox && (
              <div
                className={styles.selectionBox}
                style={{
                  left: Math.min(selectBox.x1, selectBox.x2),
                  top: Math.min(selectBox.y1, selectBox.y2),
                  width: Math.abs(selectBox.x2 - selectBox.x1),
                  height: Math.abs(selectBox.y2 - selectBox.y1),
                }}
              />
            )}
          </div>

          {/* Playhead */}
          <div
            className={styles.playhead}
            style={{ left: playheadX, height: RULER_HEIGHT + (project.tracks.length + 2) * TRACK_HEIGHT }}
          />
        </div>
      </div>

      {/* Zoom bar */}
      <div className={styles.zoomBar}>
        <button className={styles.zoomBtn} onClick={() => setZoom(Math.max(MIN_ZOOM, zoom / 1.3))}>−</button>
        <input
          type="range" min={0} max={100}
          value={zoomToSlider(zoom)}
          onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
          className={styles.zoomSlider}
        />
        <button className={styles.zoomBtn} onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.3))}>+</button>
        <span className={styles.zoomLabel}>{zoom}px/s</span>
      </div>

      {/* Effect params panel */}
      {selectedEffectId && (() => {
        const eff = (project.effects ?? []).find((e) => e.id === selectedEffectId)
        if (!eff) return null
        if (eff.type === 'pixelate') {
          const p = eff.params as PixelateParams
          return (
            <div className={styles.effectParamsPanel}>
              <span>Pixelate</span>
              <label>
                Start
                <input
                  type="range" min={2} max={64}
                  value={p.startBlockSize}
                  onChange={(e) => updateEffect(eff.id, { params: { ...p, startBlockSize: +e.target.value } })}
                />
                {p.startBlockSize}px
              </label>
              <label>
                End
                <input
                  type="range" min={2} max={64}
                  value={p.endBlockSize}
                  onChange={(e) => updateEffect(eff.id, { params: { ...p, endBlockSize: +e.target.value } })}
                />
                {p.endBlockSize}px
              </label>
            </div>
          )
        }
        if (eff.type === 'duotone') {
          const p = eff.params as DuotoneParams
          return (
            <div className={`${styles.effectParamsPanel} ${styles.effectParamsPanelDuotone}`}>
              <span>Duotone</span>
              <label>
                Shadow
                <input
                  type="color"
                  value={p.shadowColor}
                  onChange={(e) => updateEffect(eff.id, { params: { ...p, shadowColor: e.target.value } })}
                />
              </label>
              <label>
                Highlight
                <input
                  type="color"
                  value={p.highlightColor}
                  onChange={(e) => updateEffect(eff.id, { params: { ...p, highlightColor: e.target.value } })}
                />
              </label>
            </div>
          )
        }
        return null
      })()}

      {/* Clip right-click context menu */}
      {clipMenu && (
        <div
          style={{ position: 'fixed', top: clipMenu.y, left: clipMenu.x, zIndex: 1000, background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={{ display: 'block', width: '100%', padding: '6px 14px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' }}
            onClick={() => handleResetClip(clipMenu.clipId)}
          >
            Reset clip
          </button>
        </div>
      )}

      {/* Caption insert context menu */}
      {captionMenu && (
        <div
          style={{ position: 'fixed', top: captionMenu.y, left: captionMenu.x, zIndex: 1000, background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={{ display: 'block', width: '100%', padding: '6px 14px', background: 'none', border: 'none', color: '#eee', cursor: 'pointer', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' }}
            onClick={insertBlankCaption}
          >
            Insert caption
          </button>
        </div>
      )}

      {/* Effects insert context menu */}
      {effectsMenu && (
        <div
          style={{ position: 'fixed', top: effectsMenu.y, left: effectsMenu.x, zIndex: 1000, background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={{ display: 'block', width: '100%', padding: '6px 14px', background: 'none', border: 'none', color: '#ffd17a', cursor: 'pointer', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' }}
            onClick={insertPixelateEffect}
          >
            Insert Pixelate
          </button>
          <button
            style={{ display: 'block', width: '100%', padding: '6px 14px', background: 'none', border: 'none', color: '#e8a0ff', cursor: 'pointer', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' }}
            onClick={insertDuotoneEffect}
          >
            Insert Duotone
          </button>
        </div>
      )}
    </div>
  )
}
