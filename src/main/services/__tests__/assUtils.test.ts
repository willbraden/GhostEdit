import { describe, it, expect } from 'vitest'
import { toASSTime, toASSColor, escapeASSText, hexToRgb } from '../assUtils'

// ── toASSTime ──────────────────────────────────────────────────────────────────

describe('toASSTime', () => {
  it('converts zero', () => {
    expect(toASSTime(0)).toBe('0:00:00.00')
  })

  it('converts whole seconds', () => {
    expect(toASSTime(1)).toBe('0:00:01.00')
    expect(toASSTime(59)).toBe('0:00:59.00')
  })

  it('converts fractional seconds to centiseconds', () => {
    expect(toASSTime(0.5)).toBe('0:00:00.50')
    expect(toASSTime(0.1)).toBe('0:00:00.10')
    // Floor, not round: 0.999 → 99 cs, not 100
    expect(toASSTime(0.999)).toBe('0:00:00.99')
  })

  it('converts minutes', () => {
    expect(toASSTime(60)).toBe('0:01:00.00')
    expect(toASSTime(90)).toBe('0:01:30.00')
  })

  it('converts hours', () => {
    expect(toASSTime(3600)).toBe('1:00:00.00')
    expect(toASSTime(3661)).toBe('1:01:01.00')
  })

  it('pads single-digit minutes and seconds with leading zeros', () => {
    // 65.5 s = 1m 05s 50cs — tests zero-padding on all three fields.
    // Using 0.5 (exactly representable in IEEE 754) to avoid floating-point artifacts.
    expect(toASSTime(65.5)).toBe('0:01:05.50')
    expect(toASSTime(3609)).toBe('1:00:09.00')
  })
})

// ── toASSColor ─────────────────────────────────────────────────────────────────
//
// ASS stores colors as &HAABBGGRR (note: BGR byte order, not RGB).
// Alpha 0x00 = fully opaque, 0xFF = fully transparent.

describe('toASSColor', () => {
  describe('hex input', () => {
    it('converts red (#ff0000) to BGR', () => {
      // R=FF G=00 B=00 → &H 00 00 00 FF
      expect(toASSColor('#ff0000')).toBe('&H000000FF')
    })

    it('converts blue (#0000ff) to BGR', () => {
      // R=00 G=00 B=FF → &H 00 FF 00 00
      expect(toASSColor('#0000ff')).toBe('&H00FF0000')
    })

    it('converts green (#00ff00) to BGR', () => {
      // R=00 G=FF B=00 → &H 00 00 FF 00
      expect(toASSColor('#00ff00')).toBe('&H0000FF00')
    })

    it('converts white (#ffffff)', () => {
      expect(toASSColor('#ffffff')).toBe('&H00FFFFFF')
    })

    it('converts black (#000000)', () => {
      expect(toASSColor('#000000')).toBe('&H00000000')
    })

    it('accepts uppercase hex', () => {
      expect(toASSColor('#FF0000')).toBe('&H000000FF')
    })
  })

  describe('named colors', () => {
    it('handles "white"', () => {
      expect(toASSColor('white')).toBe('&H00FFFFFF')
    })

    it('handles "black"', () => {
      expect(toASSColor('black')).toBe('&H00000000')
    })

    it('handles "transparent" (fully transparent white)', () => {
      // a=0 → aa = round((1-0)*255) = 255 = 0xFF
      expect(toASSColor('transparent')).toBe('&HFFFFFFFF')
    })

    it('handles "black@<alpha>" shorthand', () => {
      // black@0 → r=g=b=0, a=0 → aa=255=0xFF
      expect(toASSColor('black@0')).toBe('&HFF000000')
      // black@0.5 → a=0.5 → aa=128=0x80
      expect(toASSColor('black@0.5')).toBe('&H80000000')
      // black@1 → a=1 → aa=0
      expect(toASSColor('black@1')).toBe('&H00000000')
    })
  })

  describe('rgb/rgba input', () => {
    it('handles rgb()', () => {
      expect(toASSColor('rgb(255, 0, 0)')).toBe('&H000000FF')
    })

    it('handles rgba() without explicit alpha (defaults to opaque)', () => {
      expect(toASSColor('rgba(0, 255, 0)')).toBe('&H0000FF00')
    })

    it('handles rgba() with alpha', () => {
      // rgba(0,0,255,0.5) → a=0.5 → aa=128=0x80
      expect(toASSColor('rgba(0, 0, 255, 0.5)')).toBe('&H80FF0000')
    })

    it('handles fully transparent rgba()', () => {
      expect(toASSColor('rgba(255, 0, 0, 0)')).toBe('&HFF0000FF')
    })
  })

  describe('forceAlpha override', () => {
    it('overrides the parsed alpha', () => {
      // Parsed alpha=0 from rgba, but forced to 1.0 → opaque
      expect(toASSColor('rgba(255, 0, 0, 0)', 1.0)).toBe('&H000000FF')
    })

    it('clamps forceAlpha above 1 to fully opaque', () => {
      expect(toASSColor('white', 2.0)).toBe('&H00FFFFFF')
    })

    it('clamps forceAlpha below 0 to fully transparent', () => {
      expect(toASSColor('white', -1)).toBe('&HFFFFFFFF')
    })
  })
})

// ── escapeASSText ──────────────────────────────────────────────────────────────

describe('escapeASSText', () => {
  it('passes plain text through unchanged', () => {
    expect(escapeASSText('Hello world')).toBe('Hello world')
  })

  it('escapes opening braces', () => {
    expect(escapeASSText('{style}')).toBe('\\{style\\}')
  })

  it('escapes closing braces independently', () => {
    // Only { and } are escaped — test each in isolation
    expect(escapeASSText('a{b')).toBe('a\\{b')
    expect(escapeASSText('a}b')).toBe('a\\}b')
  })

  it('converts newlines to ASS \\N tags', () => {
    expect(escapeASSText('line1\nline2')).toBe('line1\\Nline2')
  })

  it('handles multiple escape types in one string', () => {
    expect(escapeASSText('{bold}\ntext')).toBe('\\{bold\\}\\Ntext')
  })

  it('handles empty string', () => {
    expect(escapeASSText('')).toBe('')
  })
})

// ── hexToRgb ───────────────────────────────────────────────────────────────────

describe('hexToRgb', () => {
  it('parses black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
  })

  it('parses white', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })

  it('parses red', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0])
  })

  it('parses green', () => {
    expect(hexToRgb('#00ff00')).toEqual([0, 255, 0])
  })

  it('parses blue', () => {
    expect(hexToRgb('#0000ff')).toEqual([0, 0, 255])
  })

  it('parses an arbitrary mixed color', () => {
    expect(hexToRgb('#1a2b3c')).toEqual([26, 43, 60])
  })

  it('returns values in RGB order (not BGR)', () => {
    const [r, g, b] = hexToRgb('#ff8000')
    expect(r).toBe(255)
    expect(g).toBe(128)
    expect(b).toBe(0)
  })
})
