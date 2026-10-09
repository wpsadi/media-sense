import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useGalleryStore } from "@/stores/gallery-store"
import { useGalleryUiStore } from "@/stores/gallery-ui-store"

// Mounted once in the app, so a delete asked for from any page gets the same confirmation.
export function DeleteUploadDialog() {
  const pending = useGalleryUiStore((s) => s.pendingDelete)
  const requestDelete = useGalleryUiStore((s) => s.requestDelete)
  const activeId = useGalleryUiStore((s) => s.activeId)
  const setActiveId = useGalleryUiStore((s) => s.setActiveId)
  const remove = useGalleryStore((s) => s.remove)

  async function confirmDelete() {
    if (!pending) return
    requestDelete(null)
    if (activeId === pending.id) setActiveId(null)
    await remove(pending.id)
  }

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && requestDelete(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this file?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground break-all">{pending?.name}</span> will be removed from this
            browser. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => requestDelete(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
