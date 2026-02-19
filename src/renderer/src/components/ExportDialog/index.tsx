import { useState, useEffect } from 'react'
import { useProjectStore } from '../../store/project'
import type { AspectRatio } from '../../types/project'
import styles from './ExportDialog.module.css'

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

      const captions = project.captions.map((c) => ({
        text: c.text,
        startTime: c.startTime,
        endTime: c.endTime,
        fontSize: c.style.fontSize,
        color: c.style.color,
        background: c.style.background,
        bold: c.style.bold,
        positionY: c.style.positionY,
      }))

      await window.api.exportVideo({
        clips,
        captions,
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
