import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { ViteDevServer } from 'vite'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'

const execFileAsync = promisify(execFile)

// SHA1 cache for compiled results
const compileCache = new Map<string, string[]>()
// Serialized queue so tectonic runs never overlap. It must survive a rejected
// compile, so we always chain with both fulfillment and rejection handlers and
// swallow the queue's own rejection (otherwise the first failure would poison
// every subsequent compile).
let compileQueue: Promise<unknown> = Promise.resolve()

interface CompileRequest {
  latex: string
}

async function runCompile(latex: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'sectionkit-'))
  const texPath = join(dir, 'main.tex')
  const pdfPath = join(dir, 'main.pdf')

  try {
    // Write .tex file
    await writeFile(texPath, latex, 'utf8')

    // Run tectonic
    await execFileAsync('tectonic', ['-X', 'compile', 'main.tex'], {
      cwd: dir,
      timeout: 120_000,
      env: { ...process.env, TECTONIC_CACHE_DIR: join(tmpdir(), 'tectonic-cache') },
    })

    // Get page count from pdfinfo
    const { stdout: pdfinfoOut } = await execFileAsync('pdfinfo', [pdfPath], { timeout: 10_000 })
    const pageMatch = pdfinfoOut.match(/Pages:\s+(\d+)/)
    const pageCount = pageMatch ? parseInt(pageMatch[1], 10) : 0

    // Convert each page to SVG
    const pages: string[] = []
    for (let i = 1; i <= pageCount; i++) {
      const svgPath = join(dir, `page-${i}.svg`)
      await execFileAsync('pdftocairo', ['-svg', '-f', String(i), '-l', String(i), pdfPath, svgPath], {
        timeout: 30_000,
      })
      pages.push(await fs.readFile(svgPath, 'utf8'))
    }
    return pages
  } finally {
    // Cleanup temp directory
    await rm(dir, { recursive: true, force: true })
  }
}

async function compileLatexToSvg(latex: string): Promise<string[]> {
  const hash = createHash('sha1').update(latex).digest('hex')

  // Check cache
  if (compileCache.has(hash)) {
    return compileCache.get(hash)!
  }

  // An empty document (blank body between \begin{document} and \end{document})
  // has nothing to render; return no pages instead of invoking tectonic (which
  // fails with "No pages of output" for such input).
  const bodyMatch = latex.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/)
  if (!bodyMatch || !bodyMatch[1].trim()) {
    compileCache.set(hash, [])
    return []
  }

  // Serialize compiles; run the task regardless of whether the previous one
  // succeeded or failed.
  const task = compileQueue.then(
    () => runCompile(latex),
    () => runCompile(latex),
  )
  compileQueue = task.then(
    () => undefined,
    () => undefined,
  )

  const pages = await task
  compileCache.set(hash, pages)
  return pages
}

function sectionkitPlugin() {
  return {
    name: 'sectionkit-compile',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/sectionkit/compile', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }

        let body = ''
        for await (const chunk of req) {
          body += chunk
        }

        let latex: string
        try {
          const parsed = JSON.parse(body) as CompileRequest
          latex = parsed.latex
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
          return
        }

        if (!latex || typeof latex !== 'string') {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Missing latex field' }))
          return
        }

        try {
          const pages = await compileLatexToSvg(latex)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ pages }))
        } catch (e) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Compilation failed' }))
        }
      })
    },
    configurePreviewServer(server: ViteDevServer) {
      server.middlewares.use('/api/sectionkit/compile', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }

        let body = ''
        for await (const chunk of req) {
          body += chunk
        }

        let latex: string
        try {
          const parsed = JSON.parse(body) as CompileRequest
          latex = parsed.latex
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
          return
        }

        if (!latex || typeof latex !== 'string') {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Missing latex field' }))
          return
        }

        try {
          const pages = await compileLatexToSvg(latex)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ pages }))
        } catch (e) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Compilation failed' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), sectionkitPlugin()],
})