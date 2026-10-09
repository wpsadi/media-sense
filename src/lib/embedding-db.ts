// Embedding vectors live in IndexedDB, one record per upload, keyed by the upload id.
const DB_NAME = "video-sence-embeddings"
const DB_VERSION = 1
const STORE = "embeddings"

// Bumped when the way files are embedded changes. Records in an older format are embedded again.
export const EMBEDDING_FORMAT = 2

// One stretch of a video or audio file, in seconds. "frames" is what is seen, "audio" what is heard.
export type EmbeddingSegment = {
  start: number
  end: number
  source: "frames" | "audio"
  vector: Float32Array
}

export type EmbeddingRecord = {
  uploadId: string
  model: string
  // The whole file. For video and audio, the mean of its segments.
  vector: Float32Array
  // Empty for images. Missing on records saved before segments existed.
  segments?: EmbeddingSegment[]
  format?: number
  embeddedAt: number
}

let connection: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "uploadId" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      connection = null
      reject(request.error)
    }
  })
  return connection
}

// Runs one request in its own transaction and resolves with the request's result.
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = work(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function getAllEmbeddings(): Promise<EmbeddingRecord[]> {
  return run("readonly", (store) => store.getAll())
}

export function putEmbedding(record: EmbeddingRecord): Promise<IDBValidKey> {
  return run("readwrite", (store) => store.put(record))
}

export function deleteEmbedding(uploadId: string): Promise<undefined> {
  return run("readwrite", (store) => store.delete(uploadId))
}
