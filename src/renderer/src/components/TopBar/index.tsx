import { useRef, useState, useEffect } from 'react'
import { useProjectStore } from '../../store/project'
import type { AspectRatio } from '../../types/project'
import styles from './TopBar.module.css'

// Extract filename from a full path (works on Windows and Unix paths)
function basename(filePath: string): string {
  return filePath.replace(/.*[\\/]/, '')
}

interface Props {
  onExport: () => void
  onAiBRoll: () => void
  onSettings: () => void
  onNew: () => void
  onSave: () => void
  onSaveAs: () => void
  onOpen: () => void
  onOpenRecent: (filePath: string) => void
}

export function TopBar({ onExport, onAiBRoll, onSettings, onNew, onSave, onSaveAs, onOpen, onOpenRecent }: Props) {
  const {
    project, isDirty, recentFiles,
    setProjectName, setAspectRatio,
    isPlaying, setIsPlaying,
    currentTime, setCurrentTime,
    pushUndo,
  } = useProjectStore()

  const [showDrop, setShowDrop] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDrop) return
    const handler = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDrop])

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setProjectName(e.target.value)
  }

  const handleAspectChange = (ratio: AspectRatio): void => {
    setAspectRatio(ratio)
  }

  const formatTime = (s: number): string => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    const ms = Math.floor((s % 1) * 10)
    return `${m}:${String(sec).padStart(2, '0')}.${ms}`
  }

  return (
    <div className={styles.topbar}>
      <div className={styles.left}>
        <div className={styles.logo}>GE</div>
        {isDirty && <span className={styles.dirtyDot} title="Unsaved changes">●</span>}
        <input
          className={styles.projectName}
          value={project.name}
          onChange={handleNameChange}
          onFocus={() => pushUndo()}
          spellCheck={false}
        />
      </div>

      <div className={styles.center}>
        <button
          className={styles.playBtn}
          onClick={() => {
            if (isPlaying) {
              setIsPlaying(false)
            } else {
              setIsPlaying(true)
            }
          }}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className={styles.iconBtn}
          onClick={() => { setCurrentTime(0); setIsPlaying(false) }}
          title="Go to start"
        >
          ⏮
        </button>
        <span className={styles.timeDisplay}>{formatTime(currentTime)}</span>
      </div>

      <div className={styles.right}>
        <button className={styles.iconBtn} onClick={onNew} title="New project (Ctrl+N)">
          New
        </button>

        {/* Open button with recent files dropdown */}
        <div className={styles.openWrapper} ref={dropdownRef}>
          <button
            className={styles.iconBtn}
            onClick={() => setShowDrop((v) => !v)}
            title="Open project"
          >
            Open{recentFiles.length > 0 ? ' ▾' : ''}
          </button>
          {showDrop && (
            <div className={styles.recentsDropdown}>
              <button
                className={styles.recentsOpenBtn}
                onClick={() => { onOpen(); setShowDrop(false) }}
              >
                Open file...
              </button>
              {recentFiles.length > 0 && (
                <div className={styles.recentsHeader}>Recent</div>
              )}
              {recentFiles.map((f) => (
                <button
                  key={f}
                  className={styles.recentItem}
                  title={f}
                  onClick={() => { onOpenRecent(f); setShowDrop(false) }}
                >
                  <span className={styles.recentName}>{basename(f)}</span>
                  <span className={styles.recentPath}>{f}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className={styles.iconBtn} onClick={onSave} title="Save (Ctrl+S)">
          Save
        </button>
        <button className={styles.iconBtn} onClick={onSaveAs} title="Save As (Ctrl+Shift+S)">
          Save As
        </button>

        <div className={styles.aspectGroup}>
          <button
            className={`${styles.aspectBtn} ${project.aspectRatio === '16:9' ? styles.active : ''}`}
            onClick={() => handleAspectChange('16:9')}
          >
            16:9
          </button>
          <button
            className={`${styles.aspectBtn} ${project.aspectRatio === '9:16' ? styles.active : ''}`}
            onClick={() => handleAspectChange('9:16')}
          >
            9:16
          </button>
        </div>

        <button className={styles.aiBRollBtn} onClick={onAiBRoll} title="AI B-Roll Matcher">
          AI B-Roll
        </button>
        <button className={styles.iconBtn} onClick={onSettings} title="Settings">
          ⚙
        </button>
        <button className={styles.exportBtn} onClick={onExport}>
          Export
        </button>
      </div>
    </div>
  )
}
