import { useCallback, useEffect, useRef, useState } from 'react'

interface CompiledPreviewResult {
  pages: string[]
  loading: boolean
  error: string | null
  /** True when the source has changed since the last successful compile. */
  dirty: boolean
  /** Compile the latest source. Stable identity; nothing compiles until called. */
  compile: () => void
}

/**
 * Hook for compiling LaTeX to SVG via the SectionKit API.
 * - Never compiles on its own; the caller invokes `compile()` (e.g. Ctrl/Cmd+S)
 * - Always compiles the latest source via a ref (never a stale value)
 * - Uses AbortController to cancel stale requests
 * - Keeps the last good preview while compiling
 * - Caches by SHA1 on the server side
 */
export function useCompiledPreview(latex: string): CompiledPreviewResult {
  const [pages, setPages] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compiledLatex, setCompiledLatex] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const latexRef = useRef(latex)

  // Latest-value mirror so `compile` stays stable and never compiles a stale
  // value. This effect only writes a ref — it never fetches.
  useEffect(() => {
    latexRef.current = latex
  }, [latex])

  const compile = useCallback(async () => {
    const latexToCompile = latexRef.current

    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/sectionkit/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex: latexToCompile }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error ?? `HTTP ${response.status}`)
      }

      const data = await response.json()

      if (controller.signal.aborted) return

      if (data.error) {
        throw new Error(data.error)
      }

      if (data.pages && Array.isArray(data.pages)) {
        setPages(data.pages)
        setCompiledLatex(latexToCompile)
      }
    } catch (e) {
      if (controller.signal.aborted) return
      setError(e instanceof Error ? e.message : 'Compilation failed')
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [])

  // Abort any in-flight compile on unmount (replaces the old debounce cleanup).
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [])

  return {
    pages,
    loading,
    error,
    dirty: compiledLatex !== null && compiledLatex !== latex,
    compile,
  }
}