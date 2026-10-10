import { embeddingsGeneration, getAllEmbeddings, type EmbeddingRecord, type EmbeddingSegment } from "@/lib/embedding-db"
import { EMBEDDING_MODEL_ID } from "@/lib/embedding-model"

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

// One saved file inside the index. Its rows are contiguous: the whole-file vector, then one row per stretch.
type IndexedFile = {
  uploadId: string
  row: number
  segments: Pick<EmbeddingSegment, "start" | "end" | "source">[]
}

export type SearchIndex = {
  dimensions: number
  rows: number
  // Every vector as a unit vector, one row each, packed into one buffer. A dot product is then a cosine.
  matrix: Float32Array
  files: IndexedFile[]
}

// Writes the unit-length copy of a vector into out, starting at offset at.
// A zero vector stays zero, so it scores 0 against everything.
function unitInto(vector: Float32Array, out: Float32Array, offset: number) {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  const scale = 1 / (Math.sqrt(sum) || 1)
  for (let i = 0; i < vector.length; i++) out[offset + i] = vector[i] * scale
}

// Keeps the best moments of one file, best first, without sorting every stretch.
function keepBest(best: MatchedMoment[], moment: MatchedMoment) {
  if (best.length === MOMENTS_PER_FILE && moment.score <= best[MOMENTS_PER_FILE - 1].score) return
  let at = best.length
  while (at > 0 && best[at - 1].score < moment.score) at--
  best.splice(at, 0, moment)
  if (best.length > MOMENTS_PER_FILE) best.pop()
}

// Records saved for another model are not comparable with this one, so they are left out.
export function buildSearchIndex(records: EmbeddingRecord[]): SearchIndex {
  const usable = records.filter((record) => record.model === EMBEDDING_MODEL_ID)
  const dimensions = usable[0]?.vector.length ?? 0
  const sized = usable
    .filter((record) => record.vector.length === dimensions)
    .map((record) => ({ record, segments: (record.segments ?? []).filter((s) => s.vector.length === dimensions) }))

  const rows = sized.reduce((sum, { segments }) => sum + 1 + segments.length, 0)
  const matrix = new Float32Array(rows * dimensions)
  const files: IndexedFile[] = []
  let row = 0
  for (const { record, segments } of sized) {
    unitInto(record.vector, matrix, row * dimensions)
    files.push({
      uploadId: record.uploadId,
      row,
      segments: segments.map(({ start, end, source }) => ({ start, end, source })),
    })
    row++
    for (const segment of segments) {
      unitInto(segment.vector, matrix, row * dimensions)
      row++
    }
  }
  return { dimensions, rows, matrix, files }
}

// Scores every row with one dot product each, then reduces the rows to one result per file.
// A file scores as its best match, so one matching moment in a long video is enough to find it.
export function searchIndex(index: SearchIndex, query: Float32Array, limit: number): SemanticMatch[] {
  const { dimensions, rows, matrix, files } = index
  if (query.length !== dimensions || files.length === 0) return []

  const unitQuery = new Float32Array(dimensions)
  unitInto(query, unitQuery, 0)

  // Four accumulators let the CPU run the multiply-adds in parallel, which is about a third faster than one.
  const whole = dimensions - (dimensions % 4)
  const scores = new Float32Array(rows)
  for (let r = 0; r < rows; r++) {
    const base = r * dimensions
    let s0 = 0
    let s1 = 0
    let s2 = 0
    let s3 = 0
    for (let d = 0; d < whole; d += 4) {
      s0 += unitQuery[d] * matrix[base + d]
      s1 += unitQuery[d + 1] * matrix[base + d + 1]
      s2 += unitQuery[d + 2] * matrix[base + d + 2]
      s3 += unitQuery[d + 3] * matrix[base + d + 3]
    }
    let sum = s0 + s1 + s2 + s3
    for (let d = whole; d < dimensions; d++) sum += unitQuery[d] * matrix[base + d]
    scores[r] = sum
  }

  const ranked = files.map((file): SemanticMatch => {
    const moments: MatchedMoment[] = []
    file.segments.forEach(({ start, end, source }, i) => {
      keepBest(moments, { start, end, source, score: scores[file.row + 1 + i] })
    })
    const score = Math.max(scores[file.row], moments[0]?.score ?? -1)
    return { uploadId: file.uploadId, score, moments }
  })

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit)
}

type CachedIndex = { generation: number; index: SearchIndex }

let cached: CachedIndex | null = null
let building: { generation: number; promise: Promise<SearchIndex> } | null = null

// The index is rebuilt only when the saved embeddings change, not on every search.
// A build that is already running for the current generation is shared by every caller.
export function getSearchIndex(): Promise<SearchIndex> {
  const generation = embeddingsGeneration()
  if (cached?.generation === generation) return Promise.resolve(cached.index)
  if (building?.generation === generation) return building.promise

  const promise = getAllEmbeddings().then((records) => {
    const index = buildSearchIndex(records)
    cached = { generation, index }
    return index
  })
  building = { generation, promise }
  const done = () => {
    if (building?.promise === promise) building = null
  }
  promise.then(done, done)
  return promise
}
