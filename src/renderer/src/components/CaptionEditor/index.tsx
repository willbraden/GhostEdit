import { useState, useEffect } from 'react'
import { useProjectStore } from '../../store/project'
import type { Caption } from '../../types/project'
import styles from './CaptionEditor.module.css'

const DEFAULT_STYLE: Caption['style'] = {
  fontSize: 32,
  color: '#ffffff',
  background: 'rgba(0,0,0,0.5)',
  bold: false,
  positionY: 85,
}

interface CaptionRowProps {
  caption: Caption
  isSelected: boolean
  onSelect: () => void
  onChange: (updates: Partial<Caption>) => void
  onRemove: () => void
}

function CaptionRow({ caption, isSelected, onSelect, onChange, onRemove }: CaptionRowProps) {
  const fmt = (s: number): string => {
    const m = Math.floor(s / 60)
    const sec = (s % 60).toFixed(1)
    return `${m}:${String(sec).padStart(4, '0')}`
  }

  return (
    <div
      className={`${styles.captionRow} ${isSelected ? styles.captionRowSelected : ''}`}
      onClick={onSelect}
    >
      <div className={styles.captionTimes}>
        <span>{fmt(caption.startTime)}</span>
        <span className={styles.captionArrow}>→</span>
        <span>{fmt(caption.endTime)}</span>
      </div>
      <textarea
        className={styles.captionText}
        value={caption.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={2}
        onClick={(e) => e.stopPropagation()}
      />
      <button className={styles.removeCapBtn} onClick={(e) => { e.stopPropagation(); onRemove() }}>×</button>
    </div>
  )
}

export function CaptionEditor() {
  const { project, addCaptions, updateCaption, removeCaption, selectCaption, selectedCaptionId } =
    useProjectStore()

  const [transcribing, setTranscribing] = useState(false)
  const [progress, setProgress] = useState('')
  const [globalStyle, setGlobalStyle] = useState<Caption['style']>(DEFAULT_STYLE)

  // Subscribe to whisper progress
  useEffect(() => {
    const unsub = window.api.onWhisperProgress((msg) => setProgress(msg))
    return unsub
  }, [])

  const handleTranscribe = async (): Promise<void> => {
    // Get the first video clip's file path to transcribe
    const firstVideoTrack = project.tracks.find((t) => t.type === 'video')
    const firstClip = firstVideoTrack?.clips[0]
    const asset = firstClip ? project.assets.find((a) => a.id === firstClip.assetId) : null

    if (!asset) {
      alert('Add a video clip to the timeline first, then transcribe.')
      return
    }

    setTranscribing(true)
    setProgress('Starting...')
    try {
      const results = await window.api.transcribe(asset.filePath)
      if (results && results.length > 0) {
        addCaptions(
          results.map((r) => ({
            text: r.text,
            startTime: r.startTime,
            endTime: r.endTime,
            style: { ...globalStyle },
          }))
        )
      }
      setProgress('')
    } catch (e) {
      setProgress(`Error: ${String(e)}`)
    } finally {
      setTranscribing(false)
    }
  }

  const applyStyleToAll = (): void => {
    for (const cap of project.captions) {
      updateCaption(cap.id, { style: { ...globalStyle } })
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Captions</span>
        <button
          className={styles.transcribeBtn}
          onClick={handleTranscribe}
          disabled={transcribing}
        >
          {transcribing ? 'Transcribing...' : '⚡ Auto'}
        </button>
      </div>

      {progress && <div className={styles.progress}>{progress}</div>}

      {/* Global style controls */}
      <div className={styles.stylePanel}>
        <div className={styles.styleRow}>
          <label>Size</label>
          <input
            type="range"
            min={16}
            max={72}
            value={globalStyle.fontSize}
            onChange={(e) => setGlobalStyle({ ...globalStyle, fontSize: Number(e.target.value) })}
            className={styles.rangeInput}
          />
          <span className={styles.styleValue}>{globalStyle.fontSize}</span>
        </div>
        <div className={styles.styleRow}>
          <label>Color</label>
          <input
            type="color"
            value={globalStyle.color}
            onChange={(e) => setGlobalStyle({ ...globalStyle, color: e.target.value })}
          />
        </div>
        <div className={styles.styleRow}>
          <label>Y Pos</label>
          <input
            type="range"
            min={0}
            max={100}
            value={globalStyle.positionY}
            onChange={(e) => setGlobalStyle({ ...globalStyle, positionY: Number(e.target.value) })}
            className={styles.rangeInput}
          />
          <span className={styles.styleValue}>{globalStyle.positionY}%</span>
        </div>
        <div className={styles.styleRow}>
          <label>Bold</label>
          <input
            type="checkbox"
            checked={globalStyle.bold}
            onChange={(e) => setGlobalStyle({ ...globalStyle, bold: e.target.checked })}
          />
        </div>
        <button className={styles.applyBtn} onClick={applyStyleToAll}>
          Apply to all
        </button>
      </div>

      <div className={styles.captionList}>
        {project.captions.length === 0 && (
          <div className={styles.empty}>
            <p>No captions yet.</p>
            <p>Click ⚡ Auto to transcribe voiceover.</p>
          </div>
        )}
        {project.captions
          .slice()
          .sort((a, b) => a.startTime - b.startTime)
          .map((cap) => (
            <CaptionRow
              key={cap.id}
              caption={cap}
              isSelected={selectedCaptionId === cap.id}
              onSelect={() => selectCaption(cap.id)}
              onChange={(updates) => updateCaption(cap.id, updates)}
              onRemove={() => removeCaption(cap.id)}
            />
          ))}
      </div>
    </div>
  )
}
