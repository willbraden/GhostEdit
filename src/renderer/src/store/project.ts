import { create } from 'zustand'
import type { Project, Asset, Track, Clip, Caption, Effect, AspectRatio, Fps } from '../types/project'

function uuid(): string {
  return crypto.randomUUID()
}

function defaultProject(): Project {
  return {
    id: uuid(),
    name: 'Untitled Project',
    aspectRatio: '16:9',
    fps: 30,
    tracks: [
      { id: uuid(), type: 'video', name: 'Video 1', clips: [] },
      { id: uuid(), type: 'audio', name: 'Audio 1', clips: [] },
    ],
    assets: [],
    captions: [],
    effects: [],
  }
}

interface ProjectStore {
  project: Project
  selectedIds: string[]        // multi-select: clip IDs + caption IDs combined
  selectedCaptionId: string | null  // kept for CaptionEditor panel
  currentTime: number
  isPlaying: boolean
  zoom: number

  // Undo/redo
  past: Project[]
  future: Project[]

  // File state
  isDirty: boolean
  currentFilePath: string | null
  recentFiles: string[]

  // Project
  setProjectName: (name: string) => void
  setAspectRatio: (ratio: AspectRatio) => void
  setFps: (fps: Fps) => void
  loadProject: (project: Project, filePath?: string) => void
  newProject: () => void

  // Assets
  addAsset: (asset: Asset) => void
  removeAsset: (assetId: string) => void

  // Tracks
  addTrack: (type: 'video' | 'audio') => void
  removeTrack: (trackId: string) => void

  // Clips
  addClip: (trackId: string, clip: Omit<Clip, 'trackId'>) => void
  updateClip: (clipId: string, updates: Partial<Clip>) => void
  removeClip: (clipId: string) => void
  moveClipToTrack: (clipId: string, newTrackId: string) => void
  selectClip: (clipId: string | null) => void

  // Captions
  addCaptions: (captions: Omit<Caption, 'id'>[]) => void
  updateCaption: (captionId: string, updates: Partial<Caption>) => void
  removeCaption: (captionId: string) => void
  clearCaptions: () => void
  selectCaption: (captionId: string | null) => void
  deoverlapCaptions: () => void

  // Effects
  selectedEffectId: string | null
  addEffect: (effect: Omit<Effect, 'id'>) => void
  removeEffect: (effectId: string) => void
  updateEffect: (effectId: string, updates: Partial<Omit<Effect, 'id'>>) => void
  selectEffect: (effectId: string | null) => void

  // Multi-select
  setSelectedIds: (ids: string[]) => void

  // Playback
  playbackAnchor: { wallTime: number; projectTime: number } | null
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  setPlaybackAnchor: (anchor: { wallTime: number; projectTime: number } | null) => void

  // Timeline
  setZoom: (zoom: number) => void

  // Undo/redo actions
  pushUndo: () => void
  undo: () => void
  redo: () => void

  // File state actions
  markSaved: (filePath: string) => void
  setRecentFiles: (files: string[]) => void

  // Computed
  totalDuration: () => number
}

function deoverlapArr(captions: Caption[]): Caption[] {
  const sorted = [...captions].sort((a, b) => a.startTime - b.startTime)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTime < sorted[i - 1].endTime) {
      sorted[i - 1] = { ...sorted[i - 1], endTime: sorted[i].startTime }
    }
  }
  return sorted
}

// Helper: wraps a project update with history recording and dirty flag.
// Used by all "atomic" mutations that should be individually undoable.
function withHistory(s: ProjectStore, newProject: Project): Partial<ProjectStore> {
  return {
    past: [...s.past.slice(-49), s.project],
    future: [],
    isDirty: true,
    project: newProject,
  }
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: defaultProject(),
  selectedIds: [],
  selectedCaptionId: null,
  selectedEffectId: null,
  currentTime: 0,
  isPlaying: false,
  playbackAnchor: null,
  zoom: 100,

  past: [],
  future: [],
  isDirty: false,
  currentFilePath: null,
  recentFiles: [],

  // ── Undo / redo ────────────────────────────────────────────────────────────

  pushUndo: () =>
    set((s) => ({ past: [...s.past.slice(-49), s.project], future: [], isDirty: true })),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {}
      const previous = s.past[s.past.length - 1]
      return {
        project: previous,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future.slice(0, 49)],
        isDirty: true,
      }
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {}
      const next = s.future[0]
      return {
        project: next,
        future: s.future.slice(1),
        past: [...s.past.slice(-49), s.project],
        isDirty: true,
      }
    }),

  // ── File state ─────────────────────────────────────────────────────────────

  markSaved: (filePath) =>
    set((s) => ({
      isDirty: false,
      currentFilePath: filePath,
      recentFiles: [filePath, ...s.recentFiles.filter((p) => p !== filePath)].slice(0, 10),
    })),

  setRecentFiles: (files) => set({ recentFiles: files }),

  // ── Project ────────────────────────────────────────────────────────────────

  // setProjectName does NOT auto-push history — caller calls pushUndo() on input focus
  setProjectName: (name) =>
    set((s) => ({ project: { ...s.project, name }, isDirty: true })),

  setAspectRatio: (aspectRatio) =>
    set((s) => withHistory(s, { ...s.project, aspectRatio })),

  setFps: (fps) =>
    set((s) => withHistory(s, { ...s.project, fps })),

  loadProject: (project, filePath?) =>
    set({
      project: { effects: [], ...project },
      past: [],
      future: [],
      isDirty: false,
      currentFilePath: filePath ?? null,
      selectedIds: [],
      selectedCaptionId: null,
      selectedEffectId: null,
      currentTime: 0,
    }),

  newProject: () =>
    set({
      project: defaultProject(),
      past: [],
      future: [],
      isDirty: false,
      currentFilePath: null,
      selectedIds: [],
      selectedCaptionId: null,
      selectedEffectId: null,
      currentTime: 0,
    }),

  // ── Assets ─────────────────────────────────────────────────────────────────

  addAsset: (asset) =>
    set((s) => withHistory(s, { ...s.project, assets: [...s.project.assets, asset] })),

  removeAsset: (assetId) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        assets: s.project.assets.filter((a) => a.id !== assetId),
        tracks: s.project.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => c.assetId !== assetId),
        })),
      })
    ),

  // ── Tracks ─────────────────────────────────────────────────────────────────

  addTrack: (type) =>
    set((s) => {
      const count = s.project.tracks.filter((t) => t.type === type).length + 1
      const newTrack: Track = {
        id: uuid(),
        type,
        name: `${type === 'video' ? 'Video' : 'Audio'} ${count}`,
        clips: [],
      }
      return withHistory(s, { ...s.project, tracks: [...s.project.tracks, newTrack] })
    }),

  removeTrack: (trackId) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        tracks: s.project.tracks.filter((t) => t.id !== trackId),
      })
    ),

  // ── Clips ──────────────────────────────────────────────────────────────────

  addClip: (trackId, clip) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        tracks: s.project.tracks.map((t) =>
          t.id === trackId
            ? { ...t, clips: [...t.clips, { ...clip, id: uuid(), trackId }] }
            : t
        ),
      })
    ),

  // updateClip does NOT auto-push — caller calls pushUndo() before dragging
  updateClip: (clipId, updates) =>
    set((s) => ({
      isDirty: true,
      project: {
        ...s.project,
        tracks: s.project.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)),
        })),
      },
    })),

  removeClip: (clipId) =>
    set((s) => ({
      selectedIds: s.selectedIds.filter((id) => id !== clipId),
      ...withHistory(s, {
        ...s.project,
        tracks: s.project.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => c.id !== clipId),
        })),
      }),
    })),

  moveClipToTrack: (clipId, newTrackId) =>
    set((s) => {
      let moved: Clip | undefined
      const stripped = s.project.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId)
        if (clip) moved = { ...clip, trackId: newTrackId }
        return { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
      })
      if (!moved) return {}
      return withHistory(s, {
        ...s.project,
        tracks: stripped.map((t) =>
          t.id === newTrackId ? { ...t, clips: [...t.clips, moved!] } : t
        ),
      })
    }),

  selectClip: (clipId) =>
    set({ selectedIds: clipId ? [clipId] : [], selectedCaptionId: null }),

  // ── Captions ───────────────────────────────────────────────────────────────

  addCaptions: (captions) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        captions: deoverlapArr([
          ...s.project.captions,
          ...captions.map((c) => ({ ...c, id: uuid() })),
        ]),
      })
    ),

  // updateCaption does NOT auto-push — caller calls pushUndo() before editing
  updateCaption: (captionId, updates) =>
    set((s) => ({
      isDirty: true,
      project: {
        ...s.project,
        captions: s.project.captions.map((c) =>
          c.id === captionId ? { ...c, ...updates } : c
        ),
      },
    })),

  removeCaption: (captionId) =>
    set((s) => ({
      selectedIds: s.selectedIds.filter((id) => id !== captionId),
      selectedCaptionId: s.selectedCaptionId === captionId ? null : s.selectedCaptionId,
      ...withHistory(s, {
        ...s.project,
        captions: s.project.captions.filter((c) => c.id !== captionId),
      }),
    })),

  clearCaptions: () =>
    set((s) => ({
      selectedIds: s.selectedIds.filter((id) => !s.project.captions.some((c) => c.id === id)),
      selectedCaptionId: null,
      ...withHistory(s, { ...s.project, captions: [] }),
    })),

  selectCaption: (captionId) =>
    set({ selectedIds: captionId ? [captionId] : [], selectedCaptionId: captionId }),

  deoverlapCaptions: () =>
    set((s) =>
      withHistory(s, { ...s.project, captions: deoverlapArr(s.project.captions) })
    ),

  // ── Effects ────────────────────────────────────────────────────────────────

  addEffect: (effect) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        effects: [...(s.project.effects ?? []), { ...effect, id: uuid() }],
      })
    ),

  removeEffect: (effectId) =>
    set((s) => ({
      selectedEffectId: s.selectedEffectId === effectId ? null : s.selectedEffectId,
      ...withHistory(s, {
        ...s.project,
        effects: (s.project.effects ?? []).filter((e) => e.id !== effectId),
      }),
    })),

  // updateEffect does NOT auto-push — caller calls pushUndo() before editing
  updateEffect: (effectId, updates) =>
    set((s) => ({
      isDirty: true,
      project: {
        ...s.project,
        effects: (s.project.effects ?? []).map((e) =>
          e.id === effectId ? { ...e, ...updates } : e
        ),
      },
    })),

  selectEffect: (effectId) => set({ selectedEffectId: effectId }),

  // ── Multi-select ───────────────────────────────────────────────────────────

  setSelectedIds: (ids) => {
    const { project } = get()
    const captionIdSet = new Set(project.captions.map((c) => c.id))
    const selectedCaption = ids.find((id) => captionIdSet.has(id)) ?? null
    set({ selectedIds: ids, selectedCaptionId: selectedCaption })
  },

  // ── Playback ───────────────────────────────────────────────────────────────

  setCurrentTime: (currentTime) => set({ currentTime }),

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setPlaybackAnchor: (playbackAnchor) => set({ playbackAnchor }),

  // ── Timeline ───────────────────────────────────────────────────────────────

  setZoom: (zoom) => set({ zoom: Math.max(20, Math.min(500, zoom)) }),

  // ── Computed ───────────────────────────────────────────────────────────────

  totalDuration: () => {
    const { project } = get()
    let max = 0
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (clip.timelineEnd > max) max = clip.timelineEnd
      }
    }
    for (const caption of project.captions) {
      if (caption.endTime > max) max = caption.endTime
    }
    return max || 60
  },
}))
