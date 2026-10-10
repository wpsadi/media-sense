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

// The model itself lives in the embedding worker (src/lib/embedding-worker.ts). Caching and retries
// live in the store (src/stores/embedding-model-store.ts).
