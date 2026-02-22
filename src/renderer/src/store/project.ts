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

  // Project
  setProjectName: (name: string) => void
  setAspectRatio: (ratio: AspectRatio) => void
  setFps: (fps: Fps) => void
  loadProject: (project: Project) => void

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

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: defaultProject(),
  selectedIds: [],
  selectedCaptionId: null,
  selectedEffectId: null,
  currentTime: 0,
  isPlaying: false,
  playbackAnchor: null,
  zoom: 100,

  setProjectName: (name) =>
    set((s) => ({ project: { ...s.project, name } })),

  setAspectRatio: (aspectRatio) =>
    set((s) => ({ project: { ...s.project, aspectRatio } })),

  setFps: (fps) =>
    set((s) => ({ project: { ...s.project, fps } })),

  loadProject: (project) =>
    set({ project: { effects: [], ...project }, selectedIds: [], selectedCaptionId: null, selectedEffectId: null, currentTime: 0 }),

  addAsset: (asset) =>
    set((s) => ({ project: { ...s.project, assets: [...s.project.assets, asset] } })),

  removeAsset: (assetId) =>
    set((s) => ({
      project: {
        ...s.project,
        assets: s.project.assets.filter((a) => a.id !== assetId),
        tracks: s.project.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => c.assetId !== assetId),
        })),
      },
    })),

  addTrack: (type) =>
    set((s) => {
      const count = s.project.tracks.filter((t) => t.type === type).length + 1
      const newTrack: Track = {
        id: uuid(),
        type,
        name: `${type === 'video' ? 'Video' : 'Audio'} ${count}`,
        clips: [],
      }
      return { project: { ...s.project, tracks: [...s.project.tracks, newTrack] } }
    }),

  removeTrack: (trackId) =>
    set((s) => ({
      project: {
        ...s.project,
        tracks: s.project.tracks.filter((t) => t.id !== trackId),
      },
    })),

  addClip: (trackId, clip) =>
    set((s) => ({
      project: {
        ...s.project,
        tracks: s.project.tracks.map((t) =>
          t.id === trackId
            ? { ...t, clips: [...t.clips, { ...clip, id: uuid(), trackId }] }
            : t
        ),
      },
    })),

  updateClip: (clipId, updates) =>
    set((s) => ({
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
      project: {
        ...s.project,
        tracks: s.project.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => c.id !== clipId),
        })),
      },
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
      return {
        project: {
          ...s.project,
          tracks: stripped.map((t) =>
            t.id === newTrackId ? { ...t, clips: [...t.clips, moved!] } : t
          ),
        },
      }
    }),

  selectClip: (clipId) =>
    set({ selectedIds: clipId ? [clipId] : [], selectedCaptionId: null }),

  addCaptions: (captions) =>
    set((s) => ({
      project: {
        ...s.project,
        captions: deoverlapArr([
          ...s.project.captions,
          ...captions.map((c) => ({ ...c, id: uuid() })),
        ]),
      },
    })),

  updateCaption: (captionId, updates) =>
    set((s) => ({
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
      project: {
        ...s.project,
        captions: s.project.captions.filter((c) => c.id !== captionId),
      },
    })),

  clearCaptions: () =>
    set((s) => ({
      selectedIds: s.selectedIds.filter((id) => !s.project.captions.some((c) => c.id === id)),
      selectedCaptionId: null,
      project: { ...s.project, captions: [] },
    })),

  selectCaption: (captionId) =>
    set({ selectedIds: captionId ? [captionId] : [], selectedCaptionId: captionId }),

  deoverlapCaptions: () =>
    set((s) => ({
      project: { ...s.project, captions: deoverlapArr(s.project.captions) },
    })),

  addEffect: (effect) =>
    set((s) => ({
      project: { ...s.project, effects: [...(s.project.effects ?? []), { ...effect, id: uuid() }] },
    })),

  removeEffect: (effectId) =>
    set((s) => ({
      selectedEffectId: s.selectedEffectId === effectId ? null : s.selectedEffectId,
      project: { ...s.project, effects: (s.project.effects ?? []).filter((e) => e.id !== effectId) },
    })),

  updateEffect: (effectId, updates) =>
    set((s) => ({
      project: {
        ...s.project,
        effects: (s.project.effects ?? []).map((e) => (e.id === effectId ? { ...e, ...updates } : e)),
      },
    })),

  selectEffect: (effectId) => set({ selectedEffectId: effectId }),

  setSelectedIds: (ids) => {
    const { project } = get()
    const captionIdSet = new Set(project.captions.map((c) => c.id))
    const selectedCaption = ids.find((id) => captionIdSet.has(id)) ?? null
    set({ selectedIds: ids, selectedCaptionId: selectedCaption })
  },

  setCurrentTime: (currentTime) => set({ currentTime }),

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setPlaybackAnchor: (playbackAnchor) => set({ playbackAnchor }),

  setZoom: (zoom) => set({ zoom: Math.max(20, Math.min(500, zoom)) }),

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
