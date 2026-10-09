import { useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { UploadConflictDialog, type ConflictAction } from "@/components/upload-conflict-dialog"
import { planUploads, type UploadPlan, type UploadWrite } from "@/lib/upload-cache"
import { useGalleryStore } from "@/stores/gallery-store"
import { FilesIcon, FolderUpIcon } from "lucide-react"

// Non-standard attribute that makes the file input pick a folder and report webkitRelativePath.
const DIRECTORY_INPUT = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>

// Collisions are answered one by one, in order. `choices` lines up with `plan.conflicts`.
type Review = {
  plan: UploadPlan
  index: number
  choices: (ConflictAction | undefined)[]
}

export function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const addFiles = useGalleryStore((s) => s.addFiles)

  async function guarded(task: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      await task()
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof Error ? err.message : "Upload failed.")
    } finally {
      setBusy(false)
    }
  }

  async function save(writes: UploadWrite[], skipped: number, discarded: number) {
    const saved = await addFiles(writes)
    if (saved.length > 0) {
      // Saved items show up in the gallery, so the dialog has nothing left to do.
      setMessage(null)
      onOpenChange(false)
      return
    }
    const notes = [
      discarded > 0 ? `${discarded} discarded.` : "",
      skipped > 0 ? `${skipped} skipped (not an image, video or audio).` : "",
    ]
    setMessage(["Nothing was saved.", ...notes].filter(Boolean).join(" "))
  }

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Clearing the value lets the same selection be picked again later.
    event.target.value = ""
    if (files.length === 0) return

    await guarded(async () => {
      const plan = await planUploads(files)
      if (plan.conflicts.length > 0) {
        setReview({ plan, index: 0, choices: [] })
        return
      }
      await save(
        plan.fresh.map((file) => ({ file })),
        plan.skipped,
        0,
      )
    })
  }

  async function decide(action: ConflictAction, applyToRest: boolean) {
    if (!review) return
    const choices = [...review.choices]
    const last = applyToRest ? review.plan.conflicts.length - 1 : review.index
    for (let i = review.index; i <= last; i++) choices[i] = action

    const next = review.index + 1
    if (!applyToRest && next < review.plan.conflicts.length) {
      setReview({ ...review, index: next, choices })
      return
    }

    const finished = { ...review, choices }
    setReview(null)
    await guarded(async () => {
      const writes: UploadWrite[] = finished.plan.fresh.map((file) => ({ file }))
      let discarded = 0
      finished.plan.conflicts.forEach((conflict, i) => {
        if (finished.choices[i] === "replace") {
          writes.push({ file: conflict.file, replaces: conflict.existing })
        } else {
          discarded += 1
        }
      })
      await save(writes, finished.plan.skipped, discarded)
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload</DialogTitle>
            <DialogDescription>
              Add images and videos. They are cached in this browser, so they stay available after a reload.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 py-4"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <FilesIcon />
              <span>File</span>
              <span className="text-xs font-normal text-muted-foreground">Pick one or more files</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 py-4"
              disabled={busy}
              onClick={() => folderInput.current?.click()}
            >
              <FolderUpIcon />
              <span>Folder</span>
              <span className="text-xs font-normal text-muted-foreground">Images, videos and audio only</span>
            </Button>
          </div>

          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={handleChange}
          />
          <input
            {...DIRECTORY_INPUT}
            ref={folderInput}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={handleChange}
          />

          {(busy || message) && (
            <p
              role="status"
              className={failed ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
            >
              {busy ? "Saving to cache..." : message}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {review && (
        <UploadConflictDialog
          key={review.index}
          conflict={review.plan.conflicts[review.index]}
          position={review.index + 1}
          total={review.plan.conflicts.length}
          onChoose={decide}
        />
      )}
    </>
  )
}
