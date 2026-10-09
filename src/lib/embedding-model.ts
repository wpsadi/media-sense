import { AutoModel, AutoProcessor } from "@huggingface/transformers"

export const EMBEDDING_MODEL_ID = "onnx-community/embeddinggemma-2-ONNX"

export type FileProgress = {
  file: string
  loaded: number
  total: number
}

// The embedding model only runs with WebGPU. A browser without a GPU adapter cannot use it.
export async function hasWebGpu(): Promise<boolean> {
  if (!navigator.gpu) return false
  try {
    return (await navigator.gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

// Caching and retries live in the store (src/stores/embedding-model-store.ts).
export async function createEmbeddingModel(
  onProgress?: (files: FileProgress[]) => void,
  { forceWasm = false }: { forceWasm?: boolean } = {},
) {
  // Byte counts per downloaded file, keyed by file name, so overall progress
  // is summed across every file the model pulls rather than one file's percent.
  // "initiate" fires before the size is known (the size lookup), so a file's
  // total stays 0 until its first "progress" event.
  const files = new Map<string, FileProgress>()
  const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (!info.file) return
    const previous = files.get(info.file) ?? { file: info.file, loaded: 0, total: 0 }
    if (info.status === "initiate") {
      files.set(info.file, previous)
    } else if (info.status === "progress") {
      files.set(info.file, { file: info.file, loaded: info.loaded ?? 0, total: info.total ?? previous.total })
    } else if (info.status === "done") {
      files.set(info.file, { ...previous, loaded: previous.total })
    } else {
      return
    }
    onProgress?.([...files.values()])
  }

  const dtype = "q4"
  const load = async (device: "webgpu" | "wasm") => {
    const processor = await AutoProcessor.from_pretrained(EMBEDDING_MODEL_ID, { progress_callback })
    const model = await AutoModel.from_pretrained(EMBEDDING_MODEL_ID, { device, dtype, progress_callback })
    return { processor, model, device }
  }

  // Set after a WebGPU failure while running, because a lost GPU device cannot be reused.
  if (forceWasm) return load("wasm")
  try {
    return await load("webgpu")
  } catch {
    // WebGPU is missing or failed to initialise; fall back to wasm.
    return await load("wasm")
  }
}

export type EmbeddingModelParts = Pick<Awaited<ReturnType<typeof createEmbeddingModel>>, "processor" | "model">
