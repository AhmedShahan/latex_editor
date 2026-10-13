#!/usr/bin/env node
/**
 * Generate static SVG previews for SectionKit designs.
 * Auto-measures ink extents to crop/zoom to the heading region.
 * Uses the design's own rich sample body (not the bare SAMPLE_BODY).
 *
 * Output: src/assets/sectionkit/{bar,tab,ribbon}.svg
 * Prints the shared crop dimensions and aspect-ratio for CSS sync.
 */

import { promises as fs } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DESIGNS_DIR = join(ROOT, 'src/designs')
const ASSETS_DIR = join(ROOT, 'src/assets/sectionkit')

// Configuration - can be overridden via env
const TECTONIC_BIN = process.env.TECTONIC_BIN ?? 'tectonic'
const TECTONIC_CACHE_DIR = process.env.TECTONIC_CACHE_DIR ?? join(tmpdir(), 'tectonic-cache')
const PAD_X = 8   // pt padding left/right
const PAD_Y = 8   // pt padding top/bottom
const MIN_CROP_HEIGHT = 240 // pt - minimum crop height to ensure all designs have same height
const DPI = 72    // pdftoppm -r 72 gives 1px = 1pt

// Design IDs to process
const DESIGN_IDS = ['bar', 'tab', 'ribbon']

/**
 * Read a design .tex file and extract its preamble and body.
 * Strips \documentclass and \usepackage{geometry} from preamble (mirroring extractPreamble).
 */
function parseDesign(raw) {
  const beginDoc = raw.indexOf('\\begin{document}')
  const endDoc = raw.indexOf('\\end{document}')
  if (beginDoc === -1 || endDoc === -1) {
    throw new Error('Design must contain \\begin{document} and \\end{document}')
  }
  let preamble = raw.slice(0, beginDoc)
  const body = raw.slice(beginDoc + '\\begin{document}'.length, endDoc).trim()

  // Mirror extractPreamble: drop \documentclass, \usepackage[...]{geometry}, and font packages
  const lines = preamble.split('\n')
  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('\\documentclass')) return false
    if (trimmed.match(/^\\usepackage\s*\[.*\]\s*\{geometry\}/)) return false
    if (trimmed.match(/^\\usepackage\s*\{geometry\}/)) return false
    if (trimmed.match(/^\\usepackage/) && /lmodern|newpxtext|newpxmath/i.test(trimmed)) return false
    return true
  })
  preamble = filtered.join('\n').trim()
  return { preamble, body }
}

/**
 * Build a preview LaTeX source using the design's own preamble + body,
 * but cut the body after the first \subsubsection (to keep it compact).
 * Adds \pagestyle{empty} to suppress page numbers.
 */
function buildPreviewLatex(preamble, body) {
  // Find the end of the first subsubsection block
  // We want to keep: \section{...} ... \subsection{...} ... \subsubsection{...} ...
  // Cut after the first \subsubsection content (before the next \section or \subsection)
  const lines = body.split('\n')
  let cutIndex = lines.length
  let foundSubSub = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('\\subsubsection{')) {
      foundSubSub = true
    } else if (foundSubSub && (line.startsWith('\\section{') || line.startsWith('\\subsection{'))) {
      cutIndex = i
      break
    }
  }
  const trimmedBody = lines.slice(0, cutIndex).join('\n').trim()

  // Use standard article class with 12pt, a4paper, 1in margins
  const parts = []
  parts.push('\\documentclass[12pt, a4paper]{article}')
  parts.push('\\usepackage[margin=1in]{geometry}')
  if (preamble.trim()) parts.push(preamble.trim())
  parts.push('\\pagestyle{empty}')
  parts.push('\\begin{document}')
  parts.push(trimmedBody)
  parts.push('\\end{document}')
  return parts.join('\n\n')
}

/**
 * Compile LaTeX to PDF using tectonic.
 */
async function compileToPdf(latex, workDir) {
  const texPath = join(workDir, 'preview.tex')
  const pdfPath = join(workDir, 'preview.pdf')
  await writeFile(texPath, latex, 'utf8')
  await execFileAsync(TECTONIC_BIN, ['-X', 'compile', 'preview.tex'], {
    cwd: workDir,
    timeout: 120_000,
    env: { ...process.env, TECTONIC_CACHE_DIR },
  })
  return pdfPath
}

/**
 * Convert first page of PDF to SVG using pdftocairo.
 */
async function pdfToSvg(pdfPath, workDir) {
  const svgPath = join(workDir, 'preview.svg')
  await execFileAsync('pdftocairo', ['-svg', '-f', '1', '-l', '1', pdfPath, svgPath], {
    timeout: 30_000,
  })
  return await fs.readFile(svgPath, 'utf8')
}

/**
 * Use pdftoppm -gray to get a grayscale bitmap and find ink extents.
 * Returns {minX, minY, maxX, maxY} in points (1px = 1pt at 72 DPI).
 * Coordinates: origin at top-left, y increases downward (image coordinates).
 */
async function getInkBox(pdfPath, workDir) {
  const ppmPrefix = join(workDir, 'preview-gray')
  await execFileAsync('pdftoppm', ['-gray', '-r', String(DPI), '-f', '1', '-l', '1', pdfPath, ppmPrefix], {
    timeout: 30_000,
  })
  // pdftoppm -gray outputs preview-gray-1.pgm (Portable Gray Map)
  const pgmPath = join(workDir, 'preview-gray-1.pgm')
  const pgmData = await fs.readFile(pgmPath)
  // Parse PGM (P5 binary grayscale) - same format as PPM
  // Header format: P5\nWIDTH HEIGHT\nMAXVAL\n
  // There might be comments starting with #, handle them
  let headerEnd = 0
  let lineCount = 0
  const headerParts = []
  for (let i = 0; i < pgmData.length; i++) {
    if (pgmData[i] === 0x0a) { // newline
      const line = pgmData.subarray(headerEnd, i).toString()
      headerEnd = i + 1
      if (line.startsWith('#')) continue
      headerParts.push(line)
      lineCount++
      if (lineCount >= 3) break
    }
  }
  if (lineCount < 3) throw new Error('Invalid PGM header: not enough non-comment lines')
  if (headerParts[0].trim() !== 'P5') throw new Error('Not a P5 PGM')
  const [widthStr, heightStr] = headerParts[1].trim().split(/\s+/)
  const maxValStr = headerParts[2].trim()
  const width = parseInt(widthStr, 10)
  const height = parseInt(heightStr, 10)
  const maxVal = parseInt(maxValStr, 10)
  // headerEnd now points to the first byte of pixel data
  const pixelData = pgmData.subarray(headerEnd)
  if (pixelData.length !== width * height) {
    throw new Error(`PGM size mismatch: expected ${width * height}, got ${pixelData.length}`)
  }

  // Threshold for "ink" (non-white). White = maxVal.
  const THRESHOLD = maxVal - 16 // allow slight anti-aliasing
  let minX = width, minY = height, maxX = 0, maxY = 0
  let foundInk = false
  for (let y = 0; y < height; y++) {
    const rowStart = y * width
    for (let x = 0; x < width; x++) {
      if (pixelData[rowStart + x] < THRESHOLD) {
        foundInk = true
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (!foundInk) throw new Error('No ink found in rendered page')
  // Convert pixel coords (top-left origin) to pt (same at 72 DPI)
  // Note: pdftoppm renders with origin at top-left, y down.
  return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 } // +1 for inclusive
}

/**
 * Rewrite SVG root attributes to crop to the given viewBox.
 * Also injects a white background rect and prunes unused glyph <symbol>s.
 */
function cropSvg(svg, viewBox) {
  const [vx, vy, vw, vh] = viewBox
  // Replace root <svg> attributes. Strip any existing width/height/viewBox first:
  // appending would create duplicate (invalid) attributes and break XML parsing.
  let out = svg.replace(/<svg\b([^>]*)>/, (_m, attrs) => {
    const cleaned = attrs
      .replace(/\swidth="[^"]*"/g, '')
      .replace(/\sheight="[^"]*"/g, '')
      .replace(/\sviewBox="[^"]*"/g, '')
    return `<svg${cleaned} width="${vw}pt" height="${vh}pt" viewBox="${vx} ${vy} ${vw} ${vh}">`
  })
  // Inject white background rect as first child of <svg>
  out = out.replace(
    /(<svg[^>]*>)/,
    `$1<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="white"/>`
  )
  // Prune unused <symbol> elements (glyphs not referenced)
  // Keep only symbols that are referenced via <use href="#...">
  const usedIds = new Set()
  const useRegex = /<use[^>]*href="#([^"]*)"/g
  let match
  while ((match = useRegex.exec(out)) !== null) {
    usedIds.add(match[1])
  }
  if (usedIds.size > 0) {
    // Remove <symbol id="...">...</symbol> where id not in usedIds
    out = out.replace(/<symbol id="([^"]*)"[^>]*>[\s\S]*?<\/symbol>/g, (m, id) => {
      return usedIds.has(id) ? m : ''
    })
  }
  return out
}

async function main() {
  await mkdir(ASSETS_DIR, { recursive: true })

  const allInkBoxes = []
  const pageHeights = []
  const svgs = new Map()

  // First pass: compile each design, get ink box
  for (const id of DESIGN_IDS) {
    console.log(`\n=== Processing ${id} ===`)
    const designPath = join(DESIGNS_DIR, `${id}.tex`)
    const raw = await fs.readFile(designPath, 'utf8')
    const { preamble, body } = parseDesign(raw)
    const latex = buildPreviewLatex(preamble, body)

    const workDir = await mkdtemp(join(tmpdir(), `sectionkit-${id}-`))
    try {
      const pdfPath = await compileToPdf(latex, workDir)
      const svg = await pdfToSvg(pdfPath, workDir)
      svgs.set(id, svg)

      // Get page height from PDF (in points)
      const { stdout: pdfinfoOut } = await execFileAsync('pdfinfo', [pdfPath], { timeout: 10_000 })
      const pageMatch = pdfinfoOut.match(/Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/)
      const pageHeightPt = pageMatch ? parseFloat(pageMatch[2]) : 842 // A4 default
      pageHeights.push(pageHeightPt)

      const inkBox = await getInkBox(pdfPath, workDir)
      console.log(`  Ink box (pt, top-left): x=${inkBox.minX}-${inkBox.maxX}, y=${inkBox.minY}-${inkBox.maxY}`)
      allInkBoxes.push(inkBox)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }

  // Compute shared crop box from ink boxes only
  // X: from min(minX) - PAD_X to max(maxX) + PAD_X
  // Y: from min(minY) - PAD_Y to max(maxY) + PAD_Y, but at least MIN_CROP_HEIGHT
  const minX = Math.min(...allInkBoxes.map(b => b.minX)) - PAD_X
  let maxX = Math.max(...allInkBoxes.map(b => b.maxX)) + PAD_X
  // CRITICAL: Ensure crop covers full-width colored bars (measured up to x≈557)
  const MIN_MAX_X = 560
  if (maxX < MIN_MAX_X) maxX = MIN_MAX_X
  const minY = Math.min(...allInkBoxes.map(b => b.minY)) - PAD_Y
  const maxY = Math.max(...allInkBoxes.map(b => b.maxY)) + PAD_Y
  let cropHeight = maxY - minY
  if (cropHeight < MIN_CROP_HEIGHT) {
    cropHeight = MIN_CROP_HEIGHT
  }
  const cropWidth = maxX - minX

  console.log('\n=== Shared Crop ===')
  console.log(`  viewBox: ${minX} ${minY} ${cropWidth} ${cropHeight}`)
  console.log(`  Crop width: ${cropWidth}pt (covers up to x=${maxX})`)
  console.log(`  Crop height: ${cropHeight}pt`)

  // Generate final cropped SVGs
  const viewBox = [minX, minY, cropWidth, cropHeight]
  for (const id of DESIGN_IDS) {
    const cropped = cropSvg(svgs.get(id), viewBox)
    const outPath = join(ASSETS_DIR, `${id}.svg`)
    await fs.writeFile(outPath, cropped, 'utf8')
    console.log(`  Written: ${outPath}`)
  }

  // Compute aspect ratio for CSS (width/height)
  const aspectRatio = cropWidth / cropHeight
  console.log(`\n=== CSS aspect-ratio ===`)
  console.log(`  aspect-ratio: ${cropWidth} / ${cropHeight}  (≈ ${aspectRatio.toFixed(4)})`)
  console.log(`  Use in CSS: aspect-ratio: ${cropWidth} / ${cropHeight};`)

  // Also output natural image size at 96 DPI (for verification)
  const naturalWidth = Math.round(cropWidth * 96 / 72)
  const naturalHeight = Math.round(cropHeight * 96 / 72)
  console.log(`  Natural size at 96 DPI: ${naturalWidth}×${naturalHeight} px`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})