import { useEmbeddingModelStore, type ModelStatus } from "@/stores/embedding-model-store"

export type { ModelStatus }

const BYTES_PER_MB = 1024 * 1024

export function useModelDownload() {
  const status = useEmbeddingModelStore((s) => s.status)
  const files = useEmbeddingModelStore((s) => s.files)
  const bytesPerSecond = useEmbeddingModelStore((s) => s.bytesPerSecond)
  const error = useEmbeddingModelStore((s) => s.error)
  const start = useEmbeddingModelStore((s) => s.start)

  const loaded = files.reduce((sum, f) => sum + f.loaded, 0)
  const total = files.reduce((sum, f) => sum + f.total, 0)
  const progress = total > 0 ? Math.min(100, (loaded / total) * 100) : 0
  // Downloading, but no file has reported its size yet.
  const preparing = status === "downloading" && total === 0

  return {
    status,
    progress,
    preparing,
    error,
    downloadedMb: loaded / BYTES_PER_MB,
    totalMb: total / BYTES_PER_MB,
    bytesPerSecond,
    start,
  }
}
