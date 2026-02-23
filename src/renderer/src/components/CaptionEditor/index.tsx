import { useState, useEffect, useRef } from 'react'
import { useProjectStore } from '../../store/project'
import type { Caption } from '../../types/project'
import styles from './CaptionEditor.module.css'

export const GOOGLE_FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Lato',
  'Poppins',
  'Raleway',
  'Oswald',
  'Nunito',
  'Playfair Display',
  'Ubuntu',
  'Bebas Neue',
  'Anton',
  'Dancing Script',
  'Pacifico',
  'Merriweather',
  'Quicksand',
]

const loadedFontLinks = new Set<string>()

function loadGoogleFontCss(familyName: string): void {
  if (loadedFontLinks.has(familyName)) return
  loadedFontLinks.add(familyName)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(familyName)}:wght@400;700&display=swap`
  document.head.appendChild(link)
}

function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${opacity})`
}

function parseBackground(bg: string): { hex: string; opacity: number } {
  if (bg === 'transparent') return { hex: '#000000', opacity: 0 }
  const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (m) {
    const r = parseInt(m[1]).toString(16).padStart(2, '0')
    const g = parseInt(m[2]).toString(16).padStart(2, '0')
    const b = parseInt(m[3]).toString(16).padStart(2, '0')
    return { hex: `#${r}${g}${b}`, opacity: m[4] !== undefined ? parseFloat(m[4]) : 1 }
  }
  return { hex: bg.startsWith('#') ? bg.slice(0, 7) : '#000000', opacity: 1 }
}

const DEFAULT_STYLE: Caption['style'] = {
  fontSize: 52,
  color: '#ffffff',
  background: 'transparent',
  bold: true,
  positionY: 85,
  fontFamily: 'Inter',
  strokeWidth: 5,
  strokeColor: '#000000',
  highlightColor: '#ffe400',
}

export function CaptionEditor() {
  const { project, addCaptions, updateCaption, clearCaptions } = useProjectStore()

  const [transcribing, setTranscribing] = useState(false)
  const [progress, setProgress] = useState('')
  const [globalStyle, setGlobalStyle] = useState<Caption['style']>(DEFAULT_STYLE)

  const parsedBg = parseBackground(globalStyle.background)
  const [bgColor, setBgColor] = useState(parsedBg.hex)
  const [bgOpacity, setBgOpacity] = useState(parsedBg.opacity)

  const bgSyncRef = useRef(false)
  useEffect(() => {
    if (!bgSyncRef.current) { bgSyncRef.current = true; return }
    setGlobalStyle((s) => ({
      ...s,
      background: bgOpacity === 0 ? 'transparent' : hexToRgba(bgColor, bgOpacity),
    }))
  }, [bgColor, bgOpacity])

  useEffect(() => {
    const unsub = window.api.onWhisperProgress((msg) => setProgress(msg))
    return unsub
  }, [])

  useEffect(() => {
    loadGoogleFontCss('Inter')
    window.api.downloadFont('Inter').catch(() => {})
  }, [])

  // Live apply style to all captions
  const applyRef = useRef(false)
  useEffect(() => {
    if (!applyRef.current) { applyRef.current = true; return }
    const { project: proj } = useProjectStore.getState()
    for (const cap of proj.captions) {
      updateCaption(cap.id, { style: { ...globalStyle } })
    }
  }, [globalStyle, updateCaption])

  const handleFontChange = (familyName: string): void => {
    setGlobalStyle((s) => ({ ...s, fontFamily: familyName || undefined }))
    if (familyName) {
      loadGoogleFontCss(familyName)
      window.api.downloadFont(familyName).catch(() => {})
    }
  }

  const handleTranscribe = async (): Promise<void> => {
    const audioTrack = project.tracks.find((t) => t.type === 'audio' && t.clips.length > 0)
    const videoTrack = project.tracks.find((t) => t.type === 'video' && t.clips.length > 0)
    const firstClip = (audioTrack ?? videoTrack)?.clips[0]
    const asset = firstClip ? project.assets.find((a) => a.id === firstClip.assetId) : null

    if (!asset) {
      alert('Add a video or audio clip to the timeline first, then transcribe.')
      return
    }

    if (project.captions.length > 0) {
      const replace = window.confirm('Replace existing captions with the new transcription?')
      if (!replace) return
      clearCaptions()
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
            words: r.words,
            style: { ...globalStyle },
          }))
        )
        setProgress('')
      } else {
        setProgress('No speech detected. Make sure the video has voice audio.')
        setTimeout(() => setProgress(''), 4000)
      }
    } catch (e) {
      setProgress(`Error: ${String(e)}`)
    } finally {
      setTranscribing(false)
    }
  }

  const wordCount = project.captions.reduce((n, c) => n + (c.words?.length ?? c.text.split(' ').length), 0)
  const currentFont = globalStyle.fontFamily || ''

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Captions</span>
        <div className={styles.headerActions}>
          {project.captions.length > 0 && (
            <button className={styles.clearBtn} onClick={() => clearCaptions()} title="Clear all captions">
              Clear
            </button>
          )}
          <button
            className={styles.transcribeBtn}
            onClick={handleTranscribe}
            disabled={transcribing}
          >
            {transcribing ? 'Transcribing...' : '⚡ Auto'}
          </button>
        </div>
      </div>

      {progress && <div className={styles.progress}>{progress}</div>}
      {!transcribing && wordCount > 0 && !progress && (
        <div className={styles.wordCount}>{wordCount} words transcribed</div>
      )}

      <div className={styles.stylePanel}>
        {/* Font family */}
        <div className={styles.styleRow}>
          <label>Font</label>
          <select
            className={styles.fontSelect}
            value={currentFont}
            onChange={(e) => handleFontChange(e.target.value)}
            style={currentFont ? { fontFamily: `"${currentFont}", Arial, sans-serif` } : {}}
          >
            <option value="">Default (Arial)</option>
            {GOOGLE_FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: `"${f}", Arial, sans-serif` }}>
                {f}
              </option>
            ))}
          </select>
        </div>

        {/* Font size */}
        <div className={styles.styleRow}>
          <label>Size</label>
          <input
            type="range"
            min={16}
            max={96}
            value={globalStyle.fontSize}
            onChange={(e) => setGlobalStyle({ ...globalStyle, fontSize: Number(e.target.value) })}
            className={styles.rangeInput}
          />
          <span className={styles.styleValue}>{globalStyle.fontSize}</span>
        </div>

        {/* Text color + bold */}
        <div className={styles.styleRow}>
          <label>Color</label>
          <input
            type="color"
            value={globalStyle.color}
            onChange={(e) => setGlobalStyle({ ...globalStyle, color: e.target.value })}
          />
          <label className={styles.boldLabel}>
            <input
              type="checkbox"
              checked={globalStyle.bold}
              onChange={(e) => setGlobalStyle({ ...globalStyle, bold: e.target.checked })}
            />
            Bold
          </label>
        </div>

        {/* Highlight color (karaoke active word) */}
        <div className={styles.styleRow}>
          <label>Highlight</label>
          <input
            type="color"
            value={globalStyle.highlightColor || '#ffe400'}
            onChange={(e) => setGlobalStyle({ ...globalStyle, highlightColor: e.target.value })}
          />
          <span className={styles.styleValue} style={{ fontSize: 10, opacity: 0.6 }}>active word</span>
        </div>

        {/* Stroke */}
        <div className={styles.styleRow}>
          <label>Stroke</label>
          <input
            type="color"
            value={globalStyle.strokeColor || '#000000'}
            onChange={(e) => setGlobalStyle({ ...globalStyle, strokeColor: e.target.value })}
          />
          <input
            type="range"
            min={0}
            max={8}
            value={globalStyle.strokeWidth || 0}
            onChange={(e) => setGlobalStyle({ ...globalStyle, strokeWidth: Number(e.target.value) })}
            className={styles.rangeInput}
          />
          <span className={styles.styleValue}>{globalStyle.strokeWidth || 0}px</span>
        </div>

        {/* Background */}
        <div className={styles.styleRow}>
          <label>BG</label>
          <input
            type="color"
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(bgOpacity * 100)}
            onChange={(e) => setBgOpacity(Number(e.target.value) / 100)}
            className={styles.rangeInput}
          />
          <span className={styles.styleValue}>{Math.round(bgOpacity * 100)}%</span>
        </div>

        {/* Y position */}
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
      </div>
    </div>
  )
}
