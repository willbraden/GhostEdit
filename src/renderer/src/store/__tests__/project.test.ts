import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore, deoverlapArr } from '../project'
import type { Caption } from '../../types/project'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns the current store state. */
function s() {
  return useProjectStore.getState()
}

/** Resets the store to a clean default project before each test. */
function resetStore() {
  s().newProject()
  useProjectStore.setState({
    past: [],
    future: [],
    isDirty: false,
    currentFilePath: null,
    recentFiles: [],
    zoom: 100,
    selectedIds: [],
    selectedCaptionId: null,
    selectedEffectId: null,
    currentTime: 0,
  })
}

/** Minimal caption factory — only the fields we care about per test. */
function makeCaption(
  startTime: number,
  endTime: number,
  overrides: Partial<Omit<Caption, 'id'>> = {}
): Omit<Caption, 'id'> {
  return {
    text: 'test caption',
    startTime,
    endTime,
    style: {
      fontSize: 32,
      color: 'white',
      background: 'transparent',
      bold: false,
      positionY: 85,
    },
    ...overrides,
  }
}

// ── deoverlapArr (pure function) ───────────────────────────────────────────────

describe('deoverlapArr', () => {
  /** Minimal Caption object for pure function tests. */
  function cap(id: string, startTime: number, endTime: number): Caption {
    return {
      id,
      text: 'x',
      startTime,
      endTime,
      style: { fontSize: 32, color: 'white', background: '', bold: false, positionY: 85 },
    }
  }

  it('returns an empty array unchanged', () => {
    expect(deoverlapArr([])).toEqual([])
  })

  it('returns a single caption unchanged', () => {
    const result = deoverlapArr([cap('a', 1, 3)])
    expect(result).toHaveLength(1)
    expect(result[0].startTime).toBe(1)
    expect(result[0].endTime).toBe(3)
  })

  it('does not modify non-overlapping captions', () => {
    const result = deoverlapArr([cap('a', 0, 3), cap('b', 5, 8)])
    expect(result[0].endTime).toBe(3)
    expect(result[1].startTime).toBe(5)
  })

  it('trims the earlier caption when two captions overlap', () => {
    const result = deoverlapArr([cap('a', 0, 5), cap('b', 3, 8)])
    expect(result[0].endTime).toBe(3) // trimmed to b's start
    expect(result[1].startTime).toBe(3)
    expect(result[1].endTime).toBe(8) // b is unmodified
  })

  it('resolves a chain of overlapping captions', () => {
    // [0,10], [5,15], [8,20] — each overlaps the next
    const result = deoverlapArr([cap('a', 0, 10), cap('b', 5, 15), cap('c', 8, 20)])
    expect(result[0].endTime).toBe(5)
    expect(result[1].endTime).toBe(8)
    expect(result[2].endTime).toBe(20)
  })

  it('sorts unsorted input by startTime before resolving overlaps', () => {
    // Provide in reverse order
    const result = deoverlapArr([cap('b', 5, 8), cap('a', 0, 3)])
    expect(result[0].id).toBe('a')
    expect(result[1].id).toBe('b')
    expect(result[0].endTime).toBe(3) // no overlap, unchanged
  })

  it('does not mutate the original array', () => {
    const original = [cap('a', 0, 5), cap('b', 3, 8)]
    deoverlapArr(original)
    expect(original[0].endTime).toBe(5)
  })
})

// ── Zustand store ──────────────────────────────────────────────────────────────

describe('useProjectStore', () => {
  beforeEach(() => {
    resetStore()
  })

  // ── Undo / Redo ──────────────────────────────────────────────────────────────

  describe('undo/redo', () => {
    it('undo on empty history is a no-op', () => {
      const nameBefore = s().project.name
      s().undo()
      expect(s().project.name).toBe(nameBefore)
    })

    it('redo on empty future is a no-op', () => {
      const nameBefore = s().project.name
      s().redo()
      expect(s().project.name).toBe(nameBefore)
    })

    it('undo restores the previous project state', () => {
      s().setAspectRatio('9:16') // records history
      expect(s().project.aspectRatio).toBe('9:16')
      s().undo()
      expect(s().project.aspectRatio).toBe('16:9')
    })

    it('redo re-applies the undone change', () => {
      s().setAspectRatio('9:16')
      s().undo()
      s().redo()
      expect(s().project.aspectRatio).toBe('9:16')
    })

    it('a new mutation clears the redo stack', () => {
      s().setAspectRatio('9:16')
      s().undo()
      expect(s().future).toHaveLength(1)
      s().setFps(60) // new mutation
      expect(s().future).toHaveLength(0)
    })

    it('history is capped at 50 entries', () => {
      // Make 51 mutations — only the last 50 should be in history
      for (let i = 0; i < 51; i++) {
        s().setFps(i % 2 === 0 ? 30 : 60)
      }
      expect(s().past.length).toBe(50)
    })
  })

  // ── setZoom ──────────────────────────────────────────────────────────────────

  describe('setZoom', () => {
    it('accepts values within range', () => {
      s().setZoom(150)
      expect(s().zoom).toBe(150)
    })

    it('clamps values below minimum (20) to 20', () => {
      s().setZoom(0)
      expect(s().zoom).toBe(20)
      s().setZoom(-100)
      expect(s().zoom).toBe(20)
    })

    it('clamps values above maximum (500) to 500', () => {
      s().setZoom(1000)
      expect(s().zoom).toBe(500)
    })

    it('accepts the exact boundary values', () => {
      s().setZoom(20)
      expect(s().zoom).toBe(20)
      s().setZoom(500)
      expect(s().zoom).toBe(500)
    })
  })

  // ── totalDuration ─────────────────────────────────────────────────────────────

  describe('totalDuration', () => {
    it('returns 60 for an empty project (fallback)', () => {
      expect(s().totalDuration()).toBe(60)
    })

    it('returns the max clip timelineEnd', () => {
      const trackId = s().project.tracks[0].id
      s().addClip(trackId, {
        assetId: 'a1',
        timelineStart: 0,
        timelineEnd: 30,
        sourceStart: 0,
        sourceEnd: 30,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      expect(s().totalDuration()).toBe(30)
    })

    it('considers caption endTime when it exceeds all clip ends', () => {
      const trackId = s().project.tracks[0].id
      s().addClip(trackId, {
        assetId: 'a1',
        timelineStart: 0,
        timelineEnd: 20,
        sourceStart: 0,
        sourceEnd: 20,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      s().addCaptions([makeCaption(0, 45)])
      expect(s().totalDuration()).toBe(45)
    })

    it('returns max across multiple clips on multiple tracks', () => {
      const videoTrackId = s().project.tracks[0].id
      s().addTrack('audio')
      const audioTrackId = s().project.tracks.find((t) => t.type === 'audio')!.id
      s().addClip(videoTrackId, {
        assetId: 'v1',
        timelineStart: 0,
        timelineEnd: 10,
        sourceStart: 0,
        sourceEnd: 10,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      s().addClip(audioTrackId, {
        assetId: 'a1',
        timelineStart: 5,
        timelineEnd: 25,
        sourceStart: 0,
        sourceEnd: 20,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      expect(s().totalDuration()).toBe(25)
    })
  })

  // ── removeAsset cascade ───────────────────────────────────────────────────────

  describe('removeAsset', () => {
    it('removes the asset from the assets list', () => {
      s().addAsset({
        id: 'asset-1',
        type: 'video',
        filePath: '/tmp/video.mp4',
        name: 'video.mp4',
        duration: 10,
      })
      expect(s().project.assets).toHaveLength(1)
      s().removeAsset('asset-1')
      expect(s().project.assets).toHaveLength(0)
    })

    it('removes all clips that reference the deleted asset', () => {
      s().addAsset({
        id: 'asset-1',
        type: 'video',
        filePath: '/tmp/video.mp4',
        name: 'video.mp4',
        duration: 10,
      })
      const trackId = s().project.tracks[0].id
      s().addClip(trackId, {
        assetId: 'asset-1',
        timelineStart: 0,
        timelineEnd: 10,
        sourceStart: 0,
        sourceEnd: 10,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      expect(s().project.tracks[0].clips).toHaveLength(1)
      s().removeAsset('asset-1')
      expect(s().project.tracks[0].clips).toHaveLength(0)
    })

    it('leaves clips from other assets intact', () => {
      s().addAsset({ id: 'asset-1', type: 'video', filePath: '/a.mp4', name: 'a.mp4', duration: 5 })
      s().addAsset({ id: 'asset-2', type: 'video', filePath: '/b.mp4', name: 'b.mp4', duration: 5 })
      const trackId = s().project.tracks[0].id
      s().addClip(trackId, {
        assetId: 'asset-1',
        timelineStart: 0,
        timelineEnd: 5,
        sourceStart: 0,
        sourceEnd: 5,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      s().addClip(trackId, {
        assetId: 'asset-2',
        timelineStart: 5,
        timelineEnd: 10,
        sourceStart: 0,
        sourceEnd: 5,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      s().removeAsset('asset-1')
      const remaining = s().project.tracks[0].clips
      expect(remaining).toHaveLength(1)
      expect(remaining[0].assetId).toBe('asset-2')
    })
  })

  // ── markSaved / recentFiles ───────────────────────────────────────────────────

  describe('markSaved', () => {
    it('clears isDirty and records the file path', () => {
      s().setAspectRatio('9:16') // makes it dirty
      expect(s().isDirty).toBe(true)
      s().markSaved('/projects/my-video.vep')
      expect(s().isDirty).toBe(false)
      expect(s().currentFilePath).toBe('/projects/my-video.vep')
    })

    it('prepends the saved file to recent files', () => {
      s().markSaved('/projects/a.vep')
      expect(s().recentFiles[0]).toBe('/projects/a.vep')
    })

    it('deduplicates: re-saving the same file moves it to the front', () => {
      s().markSaved('/projects/a.vep')
      s().markSaved('/projects/b.vep')
      s().markSaved('/projects/a.vep') // a already in list — should move to front
      expect(s().recentFiles[0]).toBe('/projects/a.vep')
      expect(s().recentFiles.filter((p) => p === '/projects/a.vep')).toHaveLength(1)
    })

    it('caps recent files at 10 entries', () => {
      for (let i = 0; i < 12; i++) {
        s().markSaved(`/projects/video-${i}.vep`)
      }
      expect(s().recentFiles).toHaveLength(10)
    })
  })

  // ── setSelectedIds / caption sync ─────────────────────────────────────────────

  describe('setSelectedIds', () => {
    it('sets selectedCaptionId when a caption ID is in the selection', () => {
      s().addCaptions([makeCaption(0, 5)])
      const captionId = s().project.captions[0].id
      s().setSelectedIds([captionId])
      expect(s().selectedCaptionId).toBe(captionId)
    })

    it('clears selectedCaptionId when no caption ID is selected', () => {
      s().addCaptions([makeCaption(0, 5)])
      const captionId = s().project.captions[0].id
      s().setSelectedIds([captionId])
      s().setSelectedIds(['some-clip-id'])
      expect(s().selectedCaptionId).toBeNull()
    })

    it('sets selectedIds correctly', () => {
      s().setSelectedIds(['id-1', 'id-2'])
      expect(s().selectedIds).toEqual(['id-1', 'id-2'])
    })

    it('handles empty selection', () => {
      s().addCaptions([makeCaption(0, 5)])
      const captionId = s().project.captions[0].id
      s().setSelectedIds([captionId])
      s().setSelectedIds([])
      expect(s().selectedIds).toHaveLength(0)
      expect(s().selectedCaptionId).toBeNull()
    })
  })

  // ── moveClipToTrack ───────────────────────────────────────────────────────────

  describe('moveClipToTrack', () => {
    it('moves a clip from one track to another', () => {
      const srcTrackId = s().project.tracks[0].id
      s().addTrack('video')
      const dstTrackId = s().project.tracks.find((t, i) => t.type === 'video' && i > 0)!.id

      s().addClip(srcTrackId, {
        assetId: 'a1',
        timelineStart: 0,
        timelineEnd: 5,
        sourceStart: 0,
        sourceEnd: 5,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      })
      const clipId = s().project.tracks[0].clips[0].id

      s().moveClipToTrack(clipId, dstTrackId)

      const src = s().project.tracks.find((t) => t.id === srcTrackId)!
      const dst = s().project.tracks.find((t) => t.id === dstTrackId)!
      expect(src.clips).toHaveLength(0)
      expect(dst.clips).toHaveLength(1)
      expect(dst.clips[0].trackId).toBe(dstTrackId)
    })

    it('is a no-op for an unknown clip ID', () => {
      const before = JSON.stringify(s().project.tracks)
      s().moveClipToTrack('nonexistent-id', s().project.tracks[0].id)
      expect(JSON.stringify(s().project.tracks)).toBe(before)
    })
  })
})
