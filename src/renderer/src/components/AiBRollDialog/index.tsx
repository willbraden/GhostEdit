import { useState, useEffect } from 'react'
import { useProjectStore } from '../../store/project'
import type { Asset } from '../../types/project'
import styles from './AiBRollDialog.module.css'

interface ClipMatch {
  filename: string
  timelineStart: number
  timelineEnd: number
  sourceStart: number
  reason: string
}

interface ScriptSegment {
  text: string
  startTime: number
  endTime: number
}

interface Props {
  onClose: () => void
}

const WORDS_PER_SEC = 2.5
const SEG_DURATION = 5

function scriptToSegments(text: string): ScriptSegment[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const wordsPerSeg = Math.round(SEG_DURATION * WORDS_PER_SEC)
  const segments: ScriptSegment[] = []
  let t = 0
  for (let i = 0; i < words.length; i += wordsPerSeg) {
    const chunk = words.slice(i, i + wordsPerSeg).join(' ')
    segments.push({ text: chunk, startTime: t, endTime: t + SEG_DURATION })
    t += SEG_DURATION
  }
  return segments
}

export function AiBRollDialog({ onClose }: Props) {
  const { project, totalDuration, addAsset, addClip } = useProjectStore()

  const [apiKey] = useState(() => localStorage.getItem('anthropic_api_key') ?? '')
  const [clipsFolder, setClipsFolder] = useState('')
  const [script, setScript] = useState('')
  const [useCaptions, setUseCaptions] = useState(true)
  const [running, setRunning] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState('')
  const [matches, setMatches] = useState<ClipMatch[] | null>(null)
  const [applying, setApplying] = useState(false)

  const hasCaptions = project.captions.length > 0

  useEffect(() => {
    const unsub = window.api.onAiMatchProgress((msg) => setProgressMsg(msg))
    return unsub
  }, [])

  function getSegments(): ScriptSegment[] {
    if (useCaptions && hasCaptions) {
      return project.captions.map((c) => ({
        text: c.text,
        startTime: c.startTime,
        endTime: c.endTime,
      }))
    }
    return scriptToSegments(script)
  }

  const handleBrowse = async (): Promise<void> => {
    const folder = await window.api.openFolderDialog()
    if (folder) setClipsFolder(folder)
  }

  const handleMatch = async (): Promise<void> => {
    if (!apiKey.trim()) { setError('No API key set — add one in Settings (⚙)'); return }
    if (!clipsFolder.trim()) { setError('Clips folder is required'); return }
    if (!useCaptions && !script.trim()) { setError('Script text is required'); return }

    const segments = getSegments()
    if (segments.length === 0) { setError('No script segments to process'); return }

    setError('')
    setMatches(null)
    setRunning(true)
    setProgressMsg('Starting...')

    try {
      const result = await window.api.matchClips(apiKey, clipsFolder, segments)
      setMatches(result as ClipMatch[])
      setProgressMsg(`Done — ${result.length} clips matched`)
    } catch (e) {
      setError(String(e))
      setProgressMsg('')
    } finally {
      setRunning(false)
    }
  }

  const handleApply = async (): Promise<void> => {
    if (!matches || matches.length === 0) return
    setApplying(true)
    setError('')

    const videoTrack = project.tracks.find((t) => t.type === 'video')
    if (!videoTrack) {
      setError('No video track found in project')
      setApplying(false)
      return
    }

    // Normalise folder path — strip trailing separator
    const folder = clipsFolder.replace(/[\\/]+$/, '')

    // Build asset map: filename → Asset (create once, reuse for duplicates)
    const assetByFile = new Map<string, Asset>()

    for (const match of matches) {
      if (assetByFile.has(match.filename)) continue

      const fullPath = folder + '\\' + match.filename
      const existing = project.assets.find((a) => a.filePath === fullPath)

      if (existing) {
        assetByFile.set(match.filename, existing)
        continue
      }

      const assetId = crypto.randomUUID()
      try {
        const meta = await window.api.getMediaMetadata(fullPath, assetId)
        const asset: Asset = {
          id: assetId,
          type: 'video',
          filePath: fullPath,
          name: match.filename,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          thumbnailPath: meta.thumbnailPath,
        }
        addAsset(asset)
        assetByFile.set(match.filename, asset)
      } catch (e) {
        setError(`Failed to load "${match.filename}": ${e}`)
        setApplying(false)
        return
      }
    }

    // Place clips on the video track
    for (const match of matches) {
      const asset = assetByFile.get(match.filename)
      if (!asset) continue
      const duration = match.timelineEnd - match.timelineStart
      addClip(videoTrack.id, {
        id: crypto.randomUUID(),
        assetId: asset.id,
        timelineStart: match.timelineStart,
        timelineEnd: match.timelineEnd,
        sourceStart: match.sourceStart,
        sourceEnd: match.sourceStart + duration,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
    }

    setApplying(false)
    onClose()
  }

  const dur = totalDuration()
  const estimatedDuration =
    useCaptions && hasCaptions
      ? dur
      : scriptToSegments(script).slice(-1)[0]?.endTime ?? 0

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>AI B-Roll Matcher</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {/* API Key status */}
          {apiKey ? (
            <div className={styles.apiKeyBadge}>
              <span className={styles.apiKeyDot} />
              API key configured
            </div>
          ) : (
            <div className={styles.apiKeyMissing}>
              No API key set — add one in <strong>Settings (⚙)</strong>
            </div>
          )}

          {/* Clips Folder */}
          <div className={styles.field}>
            <label className={styles.label}>Clips Folder</label>
            <div className={styles.row}>
              <input
                type="text"
                className={`${styles.input} ${styles.flex1}`}
                value={clipsFolder}
                readOnly
                placeholder="Choose a folder of video clips..."
              />
              <button className={styles.browseBtn} onClick={handleBrowse} disabled={running}>
                Browse
              </button>
            </div>
          </div>

          {/* Script / Captions */}
          <div className={styles.field}>
            <label className={styles.label}>Script / Voiceover</label>

            {hasCaptions && (
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={useCaptions}
                  onChange={(e) => setUseCaptions(e.target.checked)}
                  disabled={running}
                />
                Use {project.captions.length} captions from timeline
                {useCaptions && dur > 0 && (
                  <span className={styles.durationBadge}>{dur.toFixed(1)}s</span>
                )}
              </label>
            )}

            {(!hasCaptions || !useCaptions) && (
              <>
                <textarea
                  className={styles.textarea}
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder="Paste your script or voiceover text here..."
                  rows={5}
                  disabled={running}
                />
                {estimatedDuration > 0 && (
                  <span className={styles.hint}>
                    Estimated duration: ~{estimatedDuration.toFixed(0)}s
                  </span>
                )}
              </>
            )}

            {hasCaptions && useCaptions && (
              <div className={styles.captionPreview}>
                {project.captions.slice(0, 4).map((c) => (
                  <div key={c.id} className={styles.captionRow}>
                    <span className={styles.captionTime}>{c.startTime.toFixed(1)}s</span>
                    <span className={styles.captionText}>{c.text}</span>
                  </div>
                ))}
                {project.captions.length > 4 && (
                  <div className={styles.captionMore}>
                    +{project.captions.length - 4} more segments
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Progress */}
          {(running || progressMsg) && !error && (
            <div className={styles.progress}>{progressMsg}</div>
          )}

          {/* Error */}
          {error && <div className={styles.errorMsg}>{error}</div>}

          {/* Results preview */}
          {matches && !running && (
            <div className={styles.results}>
              <div className={styles.resultsHeader}>{matches.length} clips matched</div>
              <div className={styles.matchList}>
                {matches.slice(0, 6).map((m, i) => (
                  <div key={i} className={styles.matchRow}>
                    <span className={styles.matchTime}>
                      {m.timelineStart.toFixed(1)}–{m.timelineEnd.toFixed(1)}s
                    </span>
                    <span className={styles.matchFile}>
                      {m.filename.replace(/_/g, ' ').replace(/\.\w+$/, '')}
                    </span>
                  </div>
                ))}
                {matches.length > 6 && (
                  <div className={styles.matchMore}>+{matches.length - 6} more</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={running || applying}
          >
            Cancel
          </button>
          {!matches ? (
            <button
              className={styles.matchBtn}
              onClick={handleMatch}
              disabled={running}
            >
              {running ? progressMsg || 'Matching...' : 'Match Clips'}
            </button>
          ) : (
            <div className={styles.footerRight}>
              <button
                className={styles.rematchBtn}
                onClick={() => { setMatches(null); setProgressMsg('') }}
                disabled={applying}
              >
                Re-match
              </button>
              <button
                className={styles.applyBtn}
                onClick={handleApply}
                disabled={applying}
              >
                {applying ? 'Applying...' : 'Apply to Timeline'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
