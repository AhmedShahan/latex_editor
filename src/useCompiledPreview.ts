import { useCallback, useEffect, useRef, useState } from 'react'

interface CompiledPreviewResult {
  pages: string[]
  loading: boolean
  error: string | null
}

/**
 * Hook for compiling LaTeX to SVG via the SectionKit API.
 * - Debounces requests by 500ms
 * - Uses AbortController to cancel stale requests
 * - Keeps last good preview while compiling
 * - Caches by SHA1 on the server side
 */
export function useCompiledPreview(latex: string, enabled = true): CompiledPreviewResult {
  const [pages, setPages] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLatexRef = useRef<string>('')

  const compile = useCallback(async (latexToCompile: string) => {
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

  useEffect(() => {
    if (!enabled) return

    pendingLatexRef.current = latex

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      compile(pendingLatexRef.current)
    }, 500)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [latex, enabled, compile])

  return { pages, loading, error }
}