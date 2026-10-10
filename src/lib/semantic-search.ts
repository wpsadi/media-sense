import { embedText } from "@/lib/embedding-client"
import { getSearchIndex, searchIndex, type SemanticMatch } from "@/lib/semantic-index"

export type { MatchedMoment, SemanticMatch } from "@/lib/semantic-index"

// The model card's prefix for a search query, so text is matched against media in the same space.
const SEARCH_PREFIX = "task: search result | query: "

// People search for the same words again, so the last few query vectors are kept.
const QUERY_CACHE_SIZE = 32
const queryVectors = new Map<string, Promise<Float32Array>>()

export function embedQuery(text: string): Promise<Float32Array> {
  const cached = queryVectors.get(text)
  if (cached) {
    // Re-inserted so this query counts as the most recently used.
    queryVectors.delete(text)
    queryVectors.set(text, cached)
    return cached
  }

  const vector = embedText(SEARCH_PREFIX + text)
  queryVectors.set(text, vector)
  if (queryVectors.size > QUERY_CACHE_SIZE) queryVectors.delete(queryVectors.keys().next().value!)
  // A failed embedding is not kept, so the next search tries again.
  vector.catch(() => {
    if (queryVectors.get(text) === vector) queryVectors.delete(text)
  })
  return vector
}

// The best saved files for a text query, best first. The query embedding and the index load in parallel.
export async function searchMedia(text: string, limit: number): Promise<SemanticMatch[]> {
  const [vector, index] = await Promise.all([embedQuery(text), getSearchIndex()])
  return searchIndex(index, vector, limit)
}
