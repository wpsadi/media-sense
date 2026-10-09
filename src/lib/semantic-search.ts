import type { EmbeddingModelParts } from "@/lib/embedding-model"
import type { EmbeddingRecord } from "@/lib/embedding-db"

// The model card's prefix for a search query, so text is matched against media in the same space.
const SEARCH_PREFIX = "task: search result | query: "

// A stretch of a video or audio file that matched, in seconds.
export type MatchedMoment = {
  start: number
  end: number
  source: "frames" | "audio"
  score: number
}

export type SemanticMatch = {
  uploadId: string
  // The best of the whole file and its stretches.
  score: number
  // Best first. Empty for images.
  moments: MatchedMoment[]
}

const MOMENTS_PER_FILE = 3

export async function embedQuery(text: string, { processor, model }: EmbeddingModelParts): Promise<Float32Array> {
  const inputs = await processor([SEARCH_PREFIX + text])
  const output = await model(inputs)
  return Float32Array.from(output.sentence_embedding.data as ArrayLike<number>)
}

function dot(a: Float32Array, b: Float32Array) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

function norm(v: Float32Array) {
  return Math.sqrt(dot(v, v))
}

// Cosine similarity of the query against every saved file and its stretches, best file first.
// A file scores as its best match, so one matching moment in a long video is enough to find it.
export function rankByQuery(query: Float32Array, records: EmbeddingRecord[], limit: number): SemanticMatch[] {
  const queryNorm = norm(query) || 1
  const similarity = (vector: Float32Array) => dot(query, vector) / (queryNorm * (norm(vector) || 1))

  return records
    .filter((record) => record.vector.length === query.length)
    .map((record) => {
      const moments = (record.segments ?? [])
        .filter((segment) => segment.vector.length === query.length)
        .map(({ start, end, source, vector }) => ({ start, end, source, score: similarity(vector) }))
        .sort((a, b) => b.score - a.score)
      const score = Math.max(similarity(record.vector), moments[0]?.score ?? -1)
      return { uploadId: record.uploadId, score, moments: moments.slice(0, MOMENTS_PER_FILE) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
