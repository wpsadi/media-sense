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
import type { ModelStatus } from "@/hooks/use-model-download"

// Empty while no speed is known yet, so the label only appears once bytes are arriving.
function formatSpeed(bytesPerSecond: number) {
  if (bytesPerSecond <= 0) return ""
  const mbPerSecond = bytesPerSecond / (1024 * 1024)
  return mbPerSecond >= 1 ? `${mbPerSecond.toFixed(1)} MB/s` : `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
}

// Without a value, the ring shows a short spinning arc (size not known yet).
export function RadialProgress({ value }: { value?: number }) {
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const indeterminate = value === undefined
  return (
    <svg
      viewBox="0 0 20 20"
      className={indeterminate ? "size-5 animate-spin" : "size-5 -rotate-90"}
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={2.5}
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={indeterminate ? circumference * 0.75 : circumference * (1 - value / 100)}
        className="transition-[stroke-dashoffset] duration-150 ease-linear"
      />
    </svg>
  )
}

export function ModelDownloadDialog({
  open,
  onOpenChange,
  status,
  progress,
  preparing,
  downloadedMb,
  totalMb,
  bytesPerSecond,
  error,
  onRetry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ModelStatus
  progress: number
  preparing: boolean
  downloadedMb: number
  totalMb: number
  bytesPerSecond: number
  error: string | null
  onRetry: () => void
}) {
  const percent = Math.round(progress)
  const isPreparing = status === "downloading" && preparing
  const speedLabel = formatSpeed(bytesPerSecond)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {status === "ready"
              ? "Model is downloaded"
              : status === "error"
                ? "Model failed to load"
                : isPreparing
                  ? "Preparing the model"
                  : "Downloading model"}
          </DialogTitle>
          <DialogDescription>
            {status === "ready"
              ? `The model (${totalMb.toFixed(0)} MB) is ready to use.`
              : status === "error"
                ? error ?? "Something went wrong while loading the model."
                : isPreparing
                  ? "Checking the model size before the download starts..."
                  : "The model is being downloaded. You can close this window and it will keep going."}
          </DialogDescription>
        </DialogHeader>

        {status !== "error" && (
          <div className="flex flex-col gap-2">
            {isPreparing ? (
              <div
                role="progressbar"
                aria-label="Preparing the model"
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
              </div>
            ) : (
              <>
                <div
                  role="progressbar"
                  aria-label="Model download progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full bg-primary transition-[width] duration-150 ease-linear"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>
                    {downloadedMb.toFixed(0)} / {totalMb.toFixed(0)} MB
                    {speedLabel && ` · ${speedLabel}`}
                  </span>
                  <span>{percent}%</span>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {status === "error" && (
            <Button variant="default" onClick={onRetry}>
              Retry
            </Button>
          )}
          <DialogClose render={<Button variant="outline" />}>
            {status === "ready" ? "Done" : "Close"}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
