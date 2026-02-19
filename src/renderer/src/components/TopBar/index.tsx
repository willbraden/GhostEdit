import { useProjectStore } from '../../store/project'
import type { AspectRatio } from '../../types/project'
import styles from './TopBar.module.css'

interface Props {
  onExport: () => void
}

export function TopBar({ onExport }: Props) {
  const { project, setProjectName, setAspectRatio, isPlaying, setIsPlaying, currentTime, setCurrentTime } =
    useProjectStore()

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setProjectName(e.target.value)
  }

  const handleAspectChange = (ratio: AspectRatio): void => {
    setAspectRatio(ratio)
  }

  const handleSave = async (): Promise<void> => {
    await window.api.saveProject(project)
  }

  const handleOpen = async (): Promise<void> => {
    const loaded = await window.api.openProject()
    if (loaded) {
      useProjectStore.getState().loadProject(loaded as never)
    }
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
        <div className={styles.logo}>VE</div>
        <input
          className={styles.projectName}
          value={project.name}
          onChange={handleNameChange}
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
        <button className={styles.iconBtn} onClick={handleOpen} title="Open project">
          Open
        </button>
        <button className={styles.iconBtn} onClick={handleSave} title="Save project">
          Save
        </button>
        <button className={styles.exportBtn} onClick={onExport}>
          Export
        </button>
      </div>
    </div>
  )
}
