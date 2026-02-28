import { useState, useEffect, useRef, useCallback } from 'react'
import { TopBar } from './components/TopBar'
import { AssetManager } from './components/AssetManager'
import { Preview } from './components/Preview'
import { CaptionEditor } from './components/CaptionEditor'
import { Timeline } from './components/Timeline'
import { ExportDialog } from './components/ExportDialog'
import { AiBRollDialog } from './components/AiBRollDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { useProjectStore } from './store/project'
import type { Project } from './types/project'
import styles from './App.module.css'

// ── Unsaved Changes Modal ──────────────────────────────────────────────────

interface UnsavedChangesModalProps {
  name: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

function UnsavedChangesModal({ name, onSave, onDiscard, onCancel }: UnsavedChangesModalProps) {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox}>
        <h3>Unsaved Changes</h3>
        <p>Save changes to &ldquo;{name}&rdquo; before continuing?</p>
        <div className={styles.modalActions}>
          <button className={styles.btnSave} onClick={onSave}>Save</button>
          <button className={styles.btnDiscard} onClick={onDiscard}>Don&apos;t Save</button>
          <button className={styles.btnCancel} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── File operations hook ───────────────────────────────────────────────────

function useFileOperations() {
  const store = useProjectStore()
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)
  const pendingRef = useRef<(() => void) | null>(null)

  const guardUnsaved = useCallback((action: () => void) => {
    if (store.isDirty) {
      pendingRef.current = action
      setShowUnsavedModal(true)
    } else {
      action()
    }
  }, [store.isDirty])

  const handleSave = useCallback(async () => {
    if (store.currentFilePath) {
      await window.api.saveProject(store.project, store.currentFilePath)
      store.markSaved(store.currentFilePath)
    } else {
      const fp = await window.api.saveProjectAs(store.project, store.project.name)
      if (fp) store.markSaved(fp)
    }
  }, [store])

  const handleSaveAs = useCallback(async () => {
    const fp = await window.api.saveProjectAs(store.project, store.project.name)
    if (fp) store.markSaved(fp)
  }, [store])

  const handleOpen = useCallback(() => {
    guardUnsaved(async () => {
      const result = await window.api.openProject()
      if (result) store.loadProject(result.project as Project, result.filePath)
    })
  }, [guardUnsaved, store])

  const handleOpenRecent = useCallback((filePath: string) => {
    guardUnsaved(async () => {
      const result = await window.api.openProjectPath(filePath)
      if (result) store.loadProject(result.project as Project, result.filePath)
    })
  }, [guardUnsaved, store])

  const handleNew = useCallback(() => {
    guardUnsaved(() => store.newProject())
  }, [guardUnsaved, store])

  const onModalSave = useCallback(async () => {
    setShowUnsavedModal(false)
    await handleSave()
    pendingRef.current?.()
    pendingRef.current = null
  }, [handleSave])

  const onModalDiscard = useCallback(() => {
    setShowUnsavedModal(false)
    pendingRef.current?.()
    pendingRef.current = null
  }, [])

  const onModalCancel = useCallback(() => {
    setShowUnsavedModal(false)
    pendingRef.current = null
  }, [])

  return {
    showUnsavedModal,
    handleSave,
    handleSaveAs,
    handleOpen,
    handleOpenRecent,
    handleNew,
    onModalSave,
    onModalDiscard,
    onModalCancel,
  }
}

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  const [showExport, setShowExport] = useState(false)
  const [showAiBRoll, setShowAiBRoll] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const { undo, redo, setRecentFiles, project } = useProjectStore()
  const fileOps = useFileOperations()

  // Load recent files list from main process on startup
  useEffect(() => {
    window.api.getRecentFiles().then(setRecentFiles)
  }, [setRecentFiles])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.key === 'y' && !e.shiftKey) || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      } else if (e.key === 's' && !e.shiftKey) {
        e.preventDefault()
        fileOps.handleSave()
      } else if (e.key === 's' && e.shiftKey) {
        e.preventDefault()
        fileOps.handleSaveAs()
      } else if (e.key === 'n') {
        e.preventDefault()
        fileOps.handleNew()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, fileOps.handleSave, fileOps.handleSaveAs, fileOps.handleNew])

  return (
    <div className={styles.app}>
      <TopBar
        onExport={() => setShowExport(true)}
        onAiBRoll={() => setShowAiBRoll(true)}
        onSettings={() => setShowSettings(true)}
        onNew={fileOps.handleNew}
        onSave={fileOps.handleSave}
        onSaveAs={fileOps.handleSaveAs}
        onOpen={fileOps.handleOpen}
        onOpenRecent={fileOps.handleOpenRecent}
      />

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
      {showAiBRoll && <AiBRollDialog onClose={() => setShowAiBRoll(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

      {fileOps.showUnsavedModal && (
        <UnsavedChangesModal
          name={project.name}
          onSave={fileOps.onModalSave}
          onDiscard={fileOps.onModalDiscard}
          onCancel={fileOps.onModalCancel}
        />
      )}
    </div>
  )
}

export default App
