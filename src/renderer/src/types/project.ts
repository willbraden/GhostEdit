export type AspectRatio = '16:9' | '9:16'
export type Fps = 30 | 60
export type TrackType = 'video' | 'audio'
export type AssetType = 'video' | 'audio' | 'image'

export interface CaptionStyle {
  fontSize: number
  color: string
  background: string
  bold: boolean
  positionY: number // 0-100 percent from top
}

export interface Caption {
  id: string
  text: string
  startTime: number // seconds
  endTime: number // seconds
  style: CaptionStyle
}

export interface Clip {
  id: string
  assetId: string
  trackId: string
  timelineStart: number // seconds — where clip sits on the timeline
  timelineEnd: number   // seconds
  sourceStart: number   // seconds — trim in-point in source file
  sourceEnd: number     // seconds — trim out-point in source file
  x: number             // horizontal offset (0 = center)
  y: number             // vertical offset (0 = center)
  scale: number         // 1.0 = original size
  opacity: number       // 0-1
}

export interface Track {
  id: string
  type: TrackType
  name: string
  clips: Clip[]
}

export interface Asset {
  id: string
  type: AssetType
  filePath: string
  name: string
  duration: number  // seconds (0 for images)
  width?: number
  height?: number
  thumbnailPath?: string // path to cached thumbnail image
}

export interface Project {
  id: string
  name: string
  aspectRatio: AspectRatio
  fps: Fps
  tracks: Track[]   // ordered by z-index, last = topmost
  assets: Asset[]
  captions: Caption[]
}

export interface WhisperWord {
  word: string
  start: number // seconds
  end: number   // seconds
}

export interface ExportOptions {
  outputPath: string
  aspectRatio: AspectRatio
  width: number
  height: number
  fps: Fps
  crf: number // 18-28, lower = better quality
}

// IPC channel names (shared between main and renderer)
export const IPC = {
  // File operations
  FILE_OPEN_DIALOG: 'file:openDialog',
  FILE_GET_METADATA: 'file:getMetadata',
  FILE_SAVE_PROJECT: 'file:saveProject',
  FILE_OPEN_PROJECT: 'file:openProject',
  FILE_SAVE_DIALOG: 'file:saveDialog',

  // FFmpeg
  FFMPEG_THUMBNAIL: 'ffmpeg:thumbnail',
  FFMPEG_EXPORT: 'ffmpeg:export',
  FFMPEG_EXPORT_PROGRESS: 'ffmpeg:exportProgress',

  // Whisper
  WHISPER_TRANSCRIBE: 'whisper:transcribe',
  WHISPER_PROGRESS: 'whisper:progress',
} as const
