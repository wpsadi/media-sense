import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { UploadConflict } from "@/lib/upload-cache"

export type ConflictAction = "replace" | "discard"

// Asks once per colliding file. Closing it is not offered, so every collision gets an answer.
export function UploadConflictDialog({
  conflict,
  position,
  total,
  onChoose,
}: {
  conflict: UploadConflict
  position: number
  total: number
  onChoose: (action: ConflictAction, applyToRest: boolean) => void
}) {
  // Reset per file (the parent keys this component by position), so each prompt starts unchecked.
  const [applyToRest, setApplyToRest] = useState(false)

  return (
    <Dialog open>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>File already exists</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground break-all">{conflict.file.name}</span> is already in the
            gallery. Replace the saved copy with this file, or discard this file.
            {total > 1 && <span className="mt-1 block">File {position} of {total}</span>}
          </DialogDescription>
        </DialogHeader>

        {position < total && (
          <div className="flex items-center gap-2">
            <Checkbox id="upload-conflict-all" checked={applyToRest} onCheckedChange={setApplyToRest} />
            <Label htmlFor="upload-conflict-all" className="font-normal">
              Do this for all remaining ones
            </Label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onChoose("discard", applyToRest)}>
            Discard
          </Button>
          <Button onClick={() => onChoose("replace", applyToRest)}>Replace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
