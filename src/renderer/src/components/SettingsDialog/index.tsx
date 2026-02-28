import { useState } from 'react'
import styles from './SettingsDialog.module.css'

const API_KEY_STORAGE_KEY = 'anthropic_api_key'

interface Props {
  onClose: () => void
}

export function SettingsDialog({ onClose }: Props) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE_KEY) ?? '')
  const [saved, setSaved] = useState(false)

  const handleSave = (): void => {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleClear = (): void => {
    localStorage.removeItem(API_KEY_STORAGE_KEY)
    setApiKey('')
    setSaved(false)
  }

  const maskedKey = apiKey.length > 8
    ? apiKey.slice(0, 8) + '•'.repeat(Math.min(apiKey.length - 8, 20))
    : apiKey

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Settings</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>AI</div>

            <div className={styles.field}>
              <label className={styles.label}>Anthropic API Key</label>
              <input
                type="password"
                className={styles.input}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setSaved(false) }}
                placeholder="sk-ant-..."
                spellCheck={false}
              />
              {apiKey && (
                <span className={styles.hint}>{maskedKey}</span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          {apiKey && (
            <button className={styles.clearBtn} onClick={handleClear}>
              Clear Key
            </button>
          )}
          <div className={styles.footerRight}>
            <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button className={styles.saveBtn} onClick={handleSave} disabled={saved}>
              {saved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
