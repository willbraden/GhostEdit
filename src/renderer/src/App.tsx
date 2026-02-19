import { useState } from 'react'
import { TopBar } from './components/TopBar'
import { AssetManager } from './components/AssetManager'
import { Preview } from './components/Preview'
import { CaptionEditor } from './components/CaptionEditor'
import { Timeline } from './components/Timeline'
import { ExportDialog } from './components/ExportDialog'
import styles from './App.module.css'

function App() {
  const [showExport, setShowExport] = useState(false)

  return (
    <div className={styles.app}>
      <TopBar onExport={() => setShowExport(true)} />

      <div className={styles.main}>
        <AssetManager />

        <div className={styles.centerCol}>
          <Preview />
          <div className={styles.timelineArea}>
            <Timeline />
          </div>
        </div>

        <CaptionEditor />
      </div>

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  )
}

export default App
