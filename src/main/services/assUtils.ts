/**
 * Pure utility functions for ASS subtitle generation.
 * No Node.js or external dependencies — safe to import in tests.
 */

/** Converts seconds to ASS timestamp format: H:MM:SS.cs */
export function toASSTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/**
 * Converts a color string to ASS &HAABBGGRR format (alpha 0=opaque, FF=transparent).
 * Accepts: #rrggbb hex, rgb(...), rgba(...), 'white', 'black', 'black@<alpha>', 'transparent'.
 */
export function toASSColor(color: string, forceAlpha?: number): string {
  let r = 255,
    g = 255,
    b = 255,
    a = 1.0
  const rgbaM = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgbaM) {
    r = parseInt(rgbaM[1])
    g = parseInt(rgbaM[2])
    b = parseInt(rgbaM[3])
    a = rgbaM[4] !== undefined ? parseFloat(rgbaM[4]) : 1
  } else if (/^#[0-9a-fA-F]{6}/.test(color)) {
    r = parseInt(color.slice(1, 3), 16)
    g = parseInt(color.slice(3, 5), 16)
    b = parseInt(color.slice(5, 7), 16)
  } else if (color === 'white') {
    r = g = b = 255
  } else if (color === 'black') {
    r = g = b = 0
  } else if (color.startsWith('black@')) {
    r = g = b = 0
    a = parseFloat(color.slice(6))
  } else if (color === 'transparent') {
    a = 0
  }
  if (forceAlpha !== undefined) a = forceAlpha
  const aa = Math.round((1 - Math.max(0, Math.min(1, a))) * 255)
  const hex2 = (n: number): string => Math.round(n).toString(16).padStart(2, '0').toUpperCase()
  return `&H${hex2(aa)}${hex2(b)}${hex2(g)}${hex2(r)}`
}

/** Escapes ASS special characters in caption text. */
export function escapeASSText(text: string): string {
  return text.replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N')
}

/** Parses a #rrggbb hex string to an [r, g, b] tuple (values 0–255). */
export function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}
