export type AspectRatio = '16:9' | '9:16'
export type Fps = 30 | 60
export type TrackType = 'video' | 'audio'
export type AssetType = 'video' | 'audio' | 'image'

export interface CaptionWord {
  word: string
  start: number // seconds
  end: number   // seconds
}

export interface CaptionStyle {
  fontSize: number
  color: string
  background: string
  bold: boolean
  positionY: number   // 0-100 percent from top
  fontFamily?: string  // Google Font family name; undefined = system Arial
  strokeWidth?: number // text outline width in px (0 = none)
  strokeColor?: string // text outline color hex
  highlightColor?: string // karaoke: color of the currently spoken word
}

export interface Caption {
  id: string
  text: string
  startTime: number // seconds
  endTime: number // seconds
  style: CaptionStyle
  words?: CaptionWord[] // word-level timestamps for karaoke highlighting
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

export type EffectType = 'pixelate' | 'duotone'

export interface PixelateParams {
  startBlockSize: number  // 2–64
  endBlockSize: number    // 2–64
}

export interface DuotoneParams {
  shadowColor: string    // '#rrggbb' — mapped to dark tones
  highlightColor: string // '#rrggbb' — mapped to bright tones
}

export type EffectParams = PixelateParams | DuotoneParams

export interface Effect {
  id: string
  type: EffectType
  timelineStart: number
  timelineEnd: number
  params: EffectParams
}

export type ExportEffect =
  | { type: 'pixelate'; timelineStart: number; timelineEnd: number; startBlockSize: number; endBlockSize: number }
  | { type: 'duotone';  timelineStart: number; timelineEnd: number; shadowColor: string; highlightColor: string }

export interface Project {
  id: string
  name: string
  aspectRatio: AspectRatio
  fps: Fps
  tracks: Track[]   // ordered by z-index, last = topmost
  assets: Asset[]
  captions: Caption[]
  effects: Effect[]
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

  // Fonts
  FONTS_DOWNLOAD: 'fonts:download',
} as const
