import { create } from "zustand"
import { deleteEmbedding, EMBEDDING_FORMAT, getAllEmbeddings, putEmbedding } from "@/lib/embedding-db"
import { EMBEDDING_MODEL_ID } from "@/lib/embedding-model"
import { embedMedia } from "@/lib/media-embedding"
import { getUploadBlob, type UploadRecord } from "@/lib/upload-cache"
import { useEmbeddingModelStore } from "@/stores/embedding-model-store"

// What the UI needs about a saved embedding. The vector itself stays in IndexedDB.
export type EmbeddingMeta = {
  model: string
  dimensions: number
  embeddedAt: number
}

type EmbeddingQueueState = {
  // Set once the saved embeddings have been read from IndexedDB.
  hydrated: boolean
  embeddings: Record<string, EmbeddingMeta>
  // Uploads waiting for their turn, in order.
  queue: UploadRecord[]
  // The upload being embedded right now.
  current: string | null
  // Why an upload could not be embedded. Cleared by retry.
  errors: Record<string, string>
  hydrate: () => Promise<void>
  enqueue: (uploads: UploadRecord[]) => void
  retry: (upload: UploadRecord) => void
  // Drops embeddings and queue entries for uploads that no longer exist.
  prune: (validIds: Set<string>) => Promise<void>
}

// Only one file is embedded at a time; the model is busy while it runs.
let running = false

export const useEmbeddingQueueStore = create<EmbeddingQueueState>((set, get) => {
  async function pump() {
    if (running) return
    running = true
    try {
      while (get().queue.length > 0) {
        // Nothing runs until the model is loaded; enqueue starts it again once ready.
        if (useEmbeddingModelStore.getState().status !== "ready") break

        const [next, ...rest] = get().queue
        set({ queue: rest, current: next.id })
        try {
          const blob = await getUploadBlob(next.id)
          if (!blob) throw new Error("The file is no longer in the cache.")
          const { vector, segments } = await embedMedia(next, blob)
          const embeddedAt = Date.now()
          await putEmbedding({
            uploadId: next.id,
            model: EMBEDDING_MODEL_ID,
            vector,
            segments,
            format: EMBEDDING_FORMAT,
            embeddedAt,
          })
          set((state) => ({
            embeddings: {
              ...state.embeddings,
              [next.id]: { model: EMBEDDING_MODEL_ID, dimensions: vector.length, embeddedAt },
            },
          }))
        } catch (err) {
          if (useEmbeddingModelStore.getState().handleFailure(err)) {
            // The GPU failed, so the model reloads on wasm. This file goes back to the front and runs then.
            set((state) => ({ queue: [next, ...state.queue] }))
            break
          }
          const message = err instanceof Error ? err.message : String(err)
          set((state) => ({ errors: { ...state.errors, [next.id]: message } }))
        } finally {
          set({ current: null })
        }
      }
    } finally {
      running = false
    }
  }

  return {
    hydrated: false,
    embeddings: {},
    queue: [],
    current: null,
    errors: {},

    hydrate: async () => {
      const records = await getAllEmbeddings()
      // Vectors from another model are not comparable with this one, so they are ignored.
      const embeddings: Record<string, EmbeddingMeta> = {}
      for (const record of records) {
        // Records in an older format (one vector per file, no time segments) are embedded again.
        if (record.model !== EMBEDDING_MODEL_ID || record.format !== EMBEDDING_FORMAT) continue
        embeddings[record.uploadId] = {
          model: record.model,
          dimensions: record.vector.length,
          embeddedAt: record.embeddedAt,
        }
      }
      set({ embeddings, hydrated: true })
    },

    enqueue: (uploads) => {
      const { hydrated, embeddings, errors, queue, current } = get()
      if (!hydrated) return
      const waiting = new Set(queue.map((upload) => upload.id))
      const additions = uploads.filter(
        (upload) =>
          !embeddings[upload.id] && !errors[upload.id] && !waiting.has(upload.id) && upload.id !== current,
      )
      if (additions.length === 0) return
      set({ queue: [...queue, ...additions] })
      void pump()
    },

    retry: (upload) => {
      set((state) => {
        const { [upload.id]: _cleared, ...errors } = state.errors
        return { errors }
      })
      get().enqueue([upload])
    },

    prune: async (validIds) => {
      const records = await getAllEmbeddings()
      const stale = records.filter((record) => !validIds.has(record.uploadId))
      await Promise.all(stale.map((record) => deleteEmbedding(record.uploadId)))
      set((state) => ({
        embeddings: Object.fromEntries(Object.entries(state.embeddings).filter(([id]) => validIds.has(id))),
        errors: Object.fromEntries(Object.entries(state.errors).filter(([id]) => validIds.has(id))),
        queue: state.queue.filter((upload) => validIds.has(upload.id)),
      }))
    },
  }
})
