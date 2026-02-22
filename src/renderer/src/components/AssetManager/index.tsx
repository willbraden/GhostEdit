import { useCallback } from 'react'
import { useProjectStore } from '../../store/project'
import type { Asset } from '../../types/project'
import styles from './AssetManager.module.css'

function formatDuration(s: number): string {
  if (s === 0) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p
}

export function AssetManager() {
  const { project, addAsset, removeAsset } = useProjectStore()

  const importFiles = useCallback(async () => {
    const paths = await window.api.openFileDialog()
    for (const filePath of paths) {
      const id = crypto.randomUUID()
      const meta = await window.api.getMediaMetadata(filePath, id)
      const asset: Asset = {
        id,
        filePath,
        name: basename(filePath),
        type: meta.type,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        thumbnailPath: meta.thumbnailPath,
      }
      addAsset(asset)
    }
  }, [addAsset])

  const handleDragStart = (e: React.DragEvent, asset: Asset): void => {
    e.dataTransfer.setData('application/x-asset-id', asset.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDropZone = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files) as (File & { path: string })[]
      for (const file of files) {
        const id = crypto.randomUUID()
        const meta = await window.api.getMediaMetadata(file.path, id)
        const asset: Asset = {
          id,
          filePath: file.path,
          name: file.name,
          type: meta.type,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          thumbnailPath: meta.thumbnailPath,
        }
        addAsset(asset)
      }
    },
    [addAsset]
  )

  return (
    <div
      className={styles.panel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropZone}
    >
      <div className={styles.header}>
        <span className={styles.title}>Assets</span>
        <button className={styles.importBtn} onClick={importFiles}>
          + Import
        </button>
      </div>

      <div className={styles.grid}>
        {project.assets.length === 0 && (
          <div className={styles.empty}>
            <p>Drop files here</p>
            <p className={styles.hint}>or click Import</p>
          </div>
        )}
        {project.assets.map((asset) => (
          <div
            key={asset.id}
            className={styles.card}
            draggable
            onDragStart={(e) => handleDragStart(e, asset)}
            title={asset.filePath}
          >
            <div
              className={styles.thumb}
              style={{ aspectRatio: asset.width && asset.height ? `${asset.width} / ${asset.height}` : asset.type === 'audio' ? '3 / 1' : '16 / 9' }}
            >
              {asset.thumbnailPath ? (
                <img src={`file://${asset.thumbnailPath}`} alt={asset.name} />
              ) : (
                <div className={styles.thumbPlaceholder}>
                  {asset.type === 'audio' ? '♫' : asset.type === 'image' ? '🖼' : '▶'}
                </div>
              )}
              {asset.duration > 0 && (
                <span className={styles.duration}>{formatDuration(asset.duration)}</span>
              )}
            </div>
            <div className={styles.cardName}>{asset.name}</div>
            <button
              className={styles.removeBtn}
              onClick={() => removeAsset(asset.id)}
              title="Remove asset"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
