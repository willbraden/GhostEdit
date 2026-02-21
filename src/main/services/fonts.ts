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
const GH = 'https://raw.githubusercontent.com/google/fonts/main'
const FONT_TTF_URLS: Record<string, { regular: string; bold: string }> = {
  'Inter':            { regular: `${GH}/ofl/inter/static/Inter-Regular.ttf`,                        bold: `${GH}/ofl/inter/static/Inter-Bold.ttf` },
  'Roboto':           { regular: `${GH}/ofl/roboto/Roboto-Regular.ttf`,                             bold: `${GH}/ofl/roboto/Roboto-Bold.ttf` },
  'Open Sans':        { regular: `${GH}/ofl/opensans/static/OpenSans-Regular.ttf`,                  bold: `${GH}/ofl/opensans/static/OpenSans-Bold.ttf` },
  'Montserrat':       { regular: `${GH}/ofl/montserrat/static/Montserrat-Regular.ttf`,              bold: `${GH}/ofl/montserrat/static/Montserrat-Bold.ttf` },
  'Lato':             { regular: `${GH}/ofl/lato/Lato-Regular.ttf`,                                bold: `${GH}/ofl/lato/Lato-Bold.ttf` },
  'Poppins':          { regular: `${GH}/ofl/poppins/Poppins-Regular.ttf`,                          bold: `${GH}/ofl/poppins/Poppins-Bold.ttf` },
  'Raleway':          { regular: `${GH}/ofl/raleway/static/Raleway-Regular.ttf`,                    bold: `${GH}/ofl/raleway/static/Raleway-Bold.ttf` },
  'Oswald':           { regular: `${GH}/ofl/oswald/static/Oswald-Regular.ttf`,                     bold: `${GH}/ofl/oswald/static/Oswald-Bold.ttf` },
  'Nunito':           { regular: `${GH}/ofl/nunito/static/Nunito-Regular.ttf`,                     bold: `${GH}/ofl/nunito/static/Nunito-Bold.ttf` },
  'Playfair Display': { regular: `${GH}/ofl/playfairdisplay/static/PlayfairDisplay-Regular.ttf`,   bold: `${GH}/ofl/playfairdisplay/static/PlayfairDisplay-Bold.ttf` },
  'Ubuntu':           { regular: `${GH}/ufl/ubuntu/Ubuntu-R.ttf`,                                  bold: `${GH}/ufl/ubuntu/Ubuntu-B.ttf` },
  'Bebas Neue':       { regular: `${GH}/ofl/bebasneuei/BebasNeuei-Regular.ttf`,                    bold: `${GH}/ofl/bebasneuei/BebasNeuei-Regular.ttf` },
  'Anton':            { regular: `${GH}/ofl/anton/Anton-Regular.ttf`,                               bold: `${GH}/ofl/anton/Anton-Regular.ttf` },
  'Dancing Script':   { regular: `${GH}/ofl/dancingscript/static/DancingScript-Regular.ttf`,       bold: `${GH}/ofl/dancingscript/static/DancingScript-Bold.ttf` },
  'Pacifico':         { regular: `${GH}/ofl/pacifico/Pacifico-Regular.ttf`,                        bold: `${GH}/ofl/pacifico/Pacifico-Regular.ttf` },
  'Merriweather':     { regular: `${GH}/ofl/merriweather/Merriweather-Regular.ttf`,                 bold: `${GH}/ofl/merriweather/Merriweather-Bold.ttf` },
  'Quicksand':        { regular: `${GH}/ofl/quicksand/static/Quicksand-Regular.ttf`,               bold: `${GH}/ofl/quicksand/static/Quicksand-Bold.ttf` },
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

  // 1. Try GitHub raw URL first
  const ghEntry = FONT_TTF_URLS[familyName]
  if (ghEntry) {
    const ghUrl = bold ? ghEntry.bold : ghEntry.regular
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
    console.warn(`[fonts] No GitHub URL mapped for "${familyName}", trying CSS API`)
  }

  // 2. Fall back to Google Fonts CSS API with old user-agent
  const userAgents = [
    'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)',
    'Mozilla/5.0 (compatible; MSIE 5.0; Windows 98)',
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
