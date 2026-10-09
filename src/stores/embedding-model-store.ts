import { create } from "zustand"
import { createEmbeddingModel, EMBEDDING_MODEL_ID, hasWebGpu, type FileProgress } from "@/lib/embedding-model"
import { isModelCached } from "@/lib/model-cache"

// "unsupported": this browser has no WebGPU, so the model never loads.
export type ModelStatus = "idle" | "downloading" | "ready" | "error" | "unsupported"

type LoadedEmbeddingModel = Awaited<ReturnType<typeof createEmbeddingModel>>

type EmbeddingModelState = {
  status: ModelStatus
  files: FileProgress[]
  bytesPerSecond: number
  error: string | null
  processor: LoadedEmbeddingModel["processor"] | null
  model: LoadedEmbeddingModel["model"] | null
  // Which backend the loaded model runs on.
  device: LoadedEmbeddingModel["device"] | null
  // Set after a WebGPU failure, so every later load uses wasm.
  forceWasm: boolean
  start: () => void
  // Loads the model straight away when every file is already cached. Never downloads.
  loadIfCached: () => Promise<void>
  // Reloads on wasm after a WebGPU failure. Returns false for any other error.
  handleFailure: (err: unknown) => boolean
}

// How often the displayed speed is recalculated.
const SPEED_UPDATE_INTERVAL_MS = 1000

// WebGPU reports lost devices and out-of-memory in these terms.
const GPU_FAILURE = /WebGPU|GPU|OrtRun|device|out of memory|Instance/i

// Lives outside React, so download progress and the loaded model survive component unmounts.
export const useEmbeddingModelStore = create<EmbeddingModelState>((set, get) => ({
  status: "idle",
  files: [],
  bytesPerSecond: 0,
  error: null,
  processor: null,
  model: null,
  device: null,
  forceWasm: false,
  loadIfCached: async () => {
    if (get().status !== "idle") return
    if (!(await hasWebGpu())) {
      set({ status: "unsupported" })
      return
    }
    if (await isModelCached(EMBEDDING_MODEL_ID)) get().start()
  },
  handleFailure: (err) => {
    const message = err instanceof Error ? err.message : String(err)
    if (get().device !== "webgpu" || !GPU_FAILURE.test(message)) return false
    set({ forceWasm: true, status: "idle", processor: null, model: null, device: null, error: null })
    get().start()
    return true
  },
  start: () => {
    // Only one load runs at a time, and a loaded model is never reloaded.
    const { status, forceWasm } = get()
    if (status === "downloading" || status === "ready" || status === "unsupported") return

    // Speed is measured from how many bytes arrived between progress events.
    let last: { bytes: number; time: number } | null = null
    let speed = 0
    const onProgress = (files: FileProgress[]) => {
      const bytes = files.reduce((sum, f) => sum + f.loaded, 0)
      const now = performance.now()
      if (!last) {
        last = { bytes, time: now }
        set({ files })
        return
      }
      const elapsed = now - last.time
      if (elapsed < SPEED_UPDATE_INTERVAL_MS) {
        set({ files })
        return
      }
      // Real speed over the window since the last update, with no smoothing lag.
      speed = ((bytes - last.bytes) / elapsed) * 1000
      last = { bytes, time: now }
      set({ files, bytesPerSecond: speed })
    }

    set({ status: "downloading", files: [], bytesPerSecond: 0, error: null })
    createEmbeddingModel(onProgress, { forceWasm }).then(
      ({ processor, model, device }) => set({ status: "ready", bytesPerSecond: 0, processor, model, device }),
      (err: unknown) => {
        // "error" lets the next start() retry the load.
        set({ status: "error", bytesPerSecond: 0, error: err instanceof Error ? err.message : String(err) })
      },
    )
  },
}))
