import { useEffect, useState } from "react"
import { getAllEmbeddings } from "@/lib/embedding-db"
import { rankByQuery, embedQuery, type SemanticMatch } from "@/lib/semantic-search"
import { useEmbeddingModelStore } from "@/stores/embedding-model-store"

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300
const LIMIT = 8

type MatchResult = {
  // The trimmed query these matches belong to. Stale results are ignored by comparing it.
  query: string
  matches: SemanticMatch[]
  error: string | null
}

// Best-matching media for a typed description. Empty until the model is ready.
export function useSemanticMatches(query: string): MatchResult | null {
  const trimmed = query.trim()
  const modelStatus = useEmbeddingModelStore((s) => s.status)
  const processor = useEmbeddingModelStore((s) => s.processor)
  const model = useEmbeddingModelStore((s) => s.model)
  const [result, setResult] = useState<MatchResult | null>(null)

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH || modelStatus !== "ready" || !processor || !model) return
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [vector, records] = await Promise.all([
            embedQuery(trimmed, { processor, model }),
            getAllEmbeddings(),
          ])
          if (!cancelled) setResult({ query: trimmed, matches: rankByQuery(vector, records, LIMIT), error: null })
        } catch (err) {
          // A GPU failure reloads the model on wasm; the effect runs again once it is ready.
          if (useEmbeddingModelStore.getState().handleFailure(err)) return
          if (!cancelled) {
            setResult({ query: trimmed, matches: [], error: err instanceof Error ? err.message : String(err) })
          }
        }
      })()
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, modelStatus, processor, model])

  return result?.query === trimmed ? result : null
}
