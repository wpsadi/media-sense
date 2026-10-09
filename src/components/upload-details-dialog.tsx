import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useModelDownload } from "@/hooks/use-model-download"
import { EMBEDDING_MODEL_ID } from "@/lib/embedding-model"
import { formatSize } from "@/lib/format-size"
import { fileDate, type UploadRecord } from "@/lib/upload-cache"
import { useEmbeddingQueueStore } from "@/stores/embedding-queue-store"
import { useGalleryUiStore } from "@/stores/gallery-ui-store"

function formatDate(time: number) {
  return new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

// What the embedding status says and what the user can do about it.
function EmbeddingStatus({ upload }: { upload: UploadRecord }) {
  const meta = useEmbeddingQueueStore((s) => s.embeddings[upload.id])
  const error = useEmbeddingQueueStore((s) => s.errors[upload.id])
  const processing = useEmbeddingQueueStore((s) => s.current === upload.id || s.queue.some((item) => item.id === upload.id))
  const retry = useEmbeddingQueueStore((s) => s.retry)
  const model = useModelDownload()

  if (meta) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium text-green-600 dark:text-green-400">Embedded</p>
        <p className="text-muted-foreground">
          {meta.dimensions} dimensions, embedded {formatDate(meta.embeddedAt)}. Stored in this browser.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="font-medium text-destructive">Embedding failed</p>
        <p className="text-muted-foreground break-words">{error}</p>
        <Button size="sm" variant="outline" onClick={() => retry(upload)} disabled={model.status !== "ready"}>
          Retry
        </Button>
      </div>
    )
  }

  if (model.status !== "ready") {
    const message =
      model.status === "downloading"
        ? `The embedding model is still downloading (${Math.round(model.progress)}%). This file will be embedded once it is ready.`
        : model.status === "error"
          ? "The embedding model failed to load. Retry it from the sidebar, and this file will be embedded afterwards."
          : "The embedding model is not ready yet. Load it from the sidebar, and this file will be embedded automatically."
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">Model not ready</p>
        <p className="text-muted-foreground">{message}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium">{processing ? "Creating embedding..." : "Waiting to be embedded"}</p>
      <p className="text-muted-foreground">The model is ready. Embeddings are created one file at a time.</p>
    </div>
  )
}

// Mounted once in the app, so the details can be opened from any page.
export function UploadDetailsDialog() {
  const upload = useGalleryUiStore((s) => s.detailsUpload)
  const setDetailsUpload = useGalleryUiStore((s) => s.setDetailsUpload)

  return (
    <Dialog open={upload !== null} onOpenChange={(open) => !open && setDetailsUpload(null)}>
      <DialogContent className="sm:max-w-md">
        {upload && (
          <>
            <DialogHeader>
              <DialogTitle className="break-all">{upload.name}</DialogTitle>
              <DialogDescription>Details and embedding status for this file.</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Kind</dt>
              <dd className="capitalize">{upload.kind}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{upload.type || "Unknown"}</dd>
              <dt className="text-muted-foreground">Size</dt>
              <dd>{formatSize(upload.size)}</dd>
              {upload.path !== upload.name && (
                <>
                  <dt className="text-muted-foreground">Path</dt>
                  <dd className="break-all">{upload.path}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Modified</dt>
              <dd>{formatDate(fileDate(upload))}</dd>
              <dt className="text-muted-foreground">Uploaded</dt>
              <dd>{formatDate(upload.uploadedAt)}</dd>
            </dl>

            <div className="rounded-lg border p-3">
              <p className="mb-2 text-xs text-muted-foreground">Embedding model: {EMBEDDING_MODEL_ID}</p>
              <EmbeddingStatus upload={upload} />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailsUpload(null)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
