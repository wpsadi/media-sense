import { useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEmbeddingModelStore } from "@/stores/embedding-model-store"
import { useEmbeddingQueueStore } from "@/stores/embedding-queue-store"
import { useGalleryStore } from "@/stores/gallery-store"

// Mounted once in the app. Keeps embeddings in step with the cache: new uploads are
// embedded when the model is ready, and deleted or replaced files lose their vector.
export function EmbeddingSync() {
  const uploads = useGalleryStore((s) => s.uploads)
  const loaded = useGalleryStore((s) => s.loaded)
  const error = useGalleryStore((s) => s.error)
  const modelReady = useEmbeddingModelStore((s) => s.status === "ready")
  const hydrated = useEmbeddingQueueStore((s) => s.hydrated)
  const hydrate = useEmbeddingQueueStore((s) => s.hydrate)
  const enqueue = useEmbeddingQueueStore((s) => s.enqueue)
  const prune = useEmbeddingQueueStore((s) => s.prune)
  const loadIfCached = useEmbeddingModelStore((s) => s.loadIfCached)
  const unsupported = useEmbeddingModelStore((s) => s.status === "unsupported")

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    void loadIfCached()
  }, [loadIfCached])

  useEffect(() => {
    // Before the first refresh the list is empty, and after a failed read it is stale;
    // pruning on either would delete embeddings of files that are still there.
    if (loaded && !error) void prune(new Set(uploads.map((upload) => upload.id)))
  }, [loaded, error, uploads, prune])

  useEffect(() => {
    if (hydrated && modelReady) enqueue(uploads)
  }, [hydrated, modelReady, uploads, enqueue])

  // Without WebGPU the app cannot work, so this stays open: no close button, and Escape or an outside click does nothing.
  return (
    <Dialog open={unsupported}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>WebGPU is not available</DialogTitle>
          <DialogDescription>
            This browser has no WebGPU support, which the embedding model needs. Open the app in a browser with WebGPU
            enabled, such as a recent version of Chrome or Edge on a device with a GPU.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
