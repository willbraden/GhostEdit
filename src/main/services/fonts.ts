import { app } from 'electron'
import * as https from 'https'
import * as path from 'path'
import * as fs from 'fs'

function getFontsDir(): string {
  const dir = path.join(app.getPath('userData'), 'fonts')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Direct GitHub raw URLs for each font — reliable TTF delivery, no API tricks needed.
// For variable fonts (bold: null), GitHub only has the variable file which FFmpeg renders at
// the default weight axis — so bold=true skips GitHub and uses the CSS API instead, which
// serves weight-specific static TTF instances (e.g. weight-700 Inter).
// Fonts with separate static bold files use bold: string pointing to the *-Bold.ttf.
const GH = 'https://raw.githubusercontent.com/google/fonts/main'
const FONT_TTF_URLS: Record<string, { regular: string; bold: string | null }> = {
  'Inter':            { regular: `${GH}/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf`,                          bold: null },
  'Roboto':           { regular: `${GH}/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf`,                        bold: null },
  'Open Sans':        { regular: `${GH}/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf`,                    bold: null },
  'Montserrat':       { regular: `${GH}/ofl/montserrat/Montserrat%5Bwght%5D.ttf`,                       bold: null },
  'Lato':             { regular: `${GH}/ofl/lato/Lato-Regular.ttf`,                                     bold: `${GH}/ofl/lato/Lato-Bold.ttf` },
  'Poppins':          { regular: `${GH}/ofl/poppins/Poppins-Regular.ttf`,                               bold: `${GH}/ofl/poppins/Poppins-Bold.ttf` },
  'Raleway':          { regular: `${GH}/ofl/raleway/Raleway%5Bwght%5D.ttf`,                             bold: null },
  'Oswald':           { regular: `${GH}/ofl/oswald/Oswald%5Bwght%5D.ttf`,                               bold: null },
  'Nunito':           { regular: `${GH}/ofl/nunito/Nunito%5Bwght%5D.ttf`,                               bold: null },
  'Playfair Display': { regular: `${GH}/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf`,             bold: null },
  'Ubuntu':           { regular: `${GH}/ufl/ubuntu/Ubuntu-Regular.ttf`,                                 bold: `${GH}/ufl/ubuntu/Ubuntu-Bold.ttf` },
  'Bebas Neue':       { regular: `${GH}/ofl/bebasneue/BebasNeue-Regular.ttf`,                           bold: `${GH}/ofl/bebasneue/BebasNeue-Regular.ttf` },
  'Anton':            { regular: `${GH}/ofl/anton/Anton-Regular.ttf`,                                   bold: `${GH}/ofl/anton/Anton-Regular.ttf` },
  'Dancing Script':   { regular: `${GH}/ofl/dancingscript/DancingScript%5Bwght%5D.ttf`,                 bold: null },
  'Pacifico':         { regular: `${GH}/ofl/pacifico/Pacifico-Regular.ttf`,                             bold: `${GH}/ofl/pacifico/Pacifico-Regular.ttf` },
  'Merriweather':     { regular: `${GH}/ofl/merriweather/Merriweather%5Bopsz%2Cwdth%2Cwght%5D.ttf`,    bold: null },
  'Quicksand':        { regular: `${GH}/ofl/quicksand/Quicksand%5Bwght%5D.ttf`,                        bold: null },
}

const TIMEOUT_MS = 20000

function fetchText(url: string, userAgent: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, { headers: { 'User-Agent': userAgent, 'Accept-Encoding': 'identity' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          fetchText(res.headers.location!, userAgent).then(resolve).catch(reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        res.setEncoding('utf8')
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve(data))
        res.on('error', reject)
      })
      .on('error', reject)
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout fetching ${url}`))
    })
  })
}

function downloadBinaryFile(url: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath)
    const req = https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          fs.unlink(filePath, () => {})
          downloadBinaryFile(res.headers.location!, filePath).then(resolve).catch(reject)
          return
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.unlink(filePath, () => {})
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', (err) => {
          file.close()
          fs.unlink(filePath, () => {})
          reject(err)
        })
      })
      .on('error', (err) => {
        file.close()
        fs.unlink(filePath, () => {})
        reject(err)
      })
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout downloading ${url}`))
    })
  })
}

/**
 * Downloads a Google Font TTF and caches it in userData/fonts/.
 * Tries GitHub raw URLs first (reliable TTF), then falls back to the CSS API.
 * Returns the local file path.
 */
export async function downloadGoogleFont(familyName: string, bold = false): Promise<string> {
  const fontsDir = getFontsDir()
  const weight = bold ? 700 : 400
  const safeName = familyName.replace(/\s+/g, '_').toLowerCase()
  const fontPath = path.join(fontsDir, `${safeName}_${weight}.ttf`)

  // Check cache — but validate size so we don't use a cached HTML error page
  if (fs.existsSync(fontPath)) {
    const size = fs.statSync(fontPath).size
    if (size > 10000) {
      console.log(`[fonts] Cache hit: ${fontPath} (${size} bytes)`)
      return fontPath
    }
    console.warn(`[fonts] Cached file too small (${size} bytes), re-downloading: ${fontPath}`)
    fs.unlinkSync(fontPath)
  }

  // 1. Try GitHub raw URL first.
  // Variable fonts (bold: null) only have a single file covering all weights — FFmpeg renders at
  // the default axis weight regardless of which file you load, so there's no point using GitHub
  // for bold; fall straight through to the CSS API which serves static weight-specific TTFs.
  const ghEntry = FONT_TTF_URLS[familyName]
  const ghUrl = ghEntry ? (bold ? ghEntry.bold : ghEntry.regular) : null
  if (ghUrl) {
    try {
      console.log(`[fonts] Downloading ${familyName} ${weight} from GitHub: ${ghUrl}`)
      await downloadBinaryFile(ghUrl, fontPath)
      const size = fs.statSync(fontPath).size
      if (size > 10000) {
        console.log(`[fonts] Saved to: ${fontPath} (${size} bytes)`)
        return fontPath
      }
      console.warn(`[fonts] GitHub download too small (${size} bytes), trying CSS API fallback`)
      fs.unlinkSync(fontPath)
    } catch (e) {
      console.warn(`[fonts] GitHub download failed for "${familyName}":`, e)
    }
  } else {
    console.log(`[fonts] No static GitHub URL for "${familyName}" bold=${bold}, using CSS API`)
  }

  // 2. Fall back to Google Fonts CSS API.
  // Must use an old Android/BlackBerry user-agent — these get format('truetype') .ttf URLs.
  // IE user-agents (MSIE 5/6) return format('embedded-opentype') EOT which FreeType cannot read.
  // Modern user-agents return WOFF2 which requires brotli decompression not available in drawtext.
  const userAgents = [
    'Mozilla/5.0 (Linux; U; Android 2.2; en-us; Nexus One Build/FRF91) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1',
    'BlackBerry9700/5.0.0.862 Profile/MIDP-2.1 Configuration/CLDC-1.1 VendorID/167',
  ]
  const cssApis = [
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(familyName)}:wght@${weight}&display=swap`,
    `https://fonts.googleapis.com/css?family=${encodeURIComponent(familyName)}:${weight}`,
  ]

  for (const UA of userAgents) {
    for (const cssUrl of cssApis) {
      try {
        const css = await fetchText(cssUrl, UA)
        const m = css.match(/url\(["']?(https?:[^"')]+\.(?:ttf|otf))["']?\)/i)
        if (m) {
          const fileUrl = m[1].trim()
          console.log(`[fonts] CSS API: Downloading ${familyName} ${weight} from: ${fileUrl}`)
          await downloadBinaryFile(fileUrl, fontPath)
          const size = fs.statSync(fontPath).size
          if (size > 10000) {
            console.log(`[fonts] Saved to: ${fontPath} (${size} bytes)`)
            return fontPath
          }
          console.warn(`[fonts] CSS API download too small (${size} bytes)`)
          fs.unlinkSync(fontPath)
        } else {
          console.warn(`[fonts] No TTF/OTF in CSS response for "${familyName}" w${weight} UA="${UA}" url=${cssUrl}`)
        }
      } catch (e) {
        console.warn(`[fonts] CSS API fetch failed (${cssUrl}):`, e)
      }
    }
  }

  throw new Error(`Could not download TTF for "${familyName}" weight ${weight}`)
}

/** Fallback system font paths on Windows */
export function getSystemFontPath(bold: boolean): string {
  return bold ? 'C:/Windows/Fonts/arialbd.ttf' : 'C:/Windows/Fonts/arial.ttf'
}

/**
 * Returns the local TTF path for a font family, downloading if needed.
 * Falls back to system Arial on any error.
 */
export async function resolveFontPath(familyName: string | undefined, bold: boolean): Promise<string> {
  if (!familyName) return getSystemFontPath(bold)
  try {
    return await downloadGoogleFont(familyName, bold)
  } catch (e) {
    console.error(`[fonts] Failed to get "${familyName}" bold=${bold}:`, e)
    // Bold variant might not exist — try regular
    try {
      if (bold) return await downloadGoogleFont(familyName, false)
    } catch { /* fall through */ }
    console.warn(`[fonts] Falling back to system Arial for "${familyName}"`)
    return getSystemFontPath(bold)
  }
}
