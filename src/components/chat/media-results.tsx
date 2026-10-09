import type { SyntheticEvent } from "react"

import { useUploadUrl } from "@/hooks/use-upload-url"
import { formatMoment } from "@/lib/format-time"

// start and end are seconds into a video or audio file: where show_media opens it, or the stretch view_media looked at.
export type ShownMedia = { id: string; name: string; kind: "image" | "video" | "audio"; start?: number; end?: number }

// Opens the player at the moment the model chose.
function seekToStart(start: number | undefined) {
  return (event: SyntheticEvent<HTMLMediaElement>) => {
    if (start) event.currentTarget.currentTime = start
  }
}

function Player({ media, url, className }: { media: ShownMedia; url: string; className: string }) {
  const onLoadedMetadata = seekToStart(media.start)
  if (media.kind === "image") return <img src={url} alt={media.name} className={`${className} w-full object-contain`} />
  if (media.kind === "video") {
    return <video src={url} controls preload="metadata" onLoadedMetadata={onLoadedMetadata} className={`${className} w-full`} />
  }
  return <audio src={url} controls preload="metadata" onLoadedMetadata={onLoadedMetadata} className="w-full px-3" />
}

function Caption({ media }: { media: ShownMedia }) {
  const moment = formatMoment(media.start, media.end)
  return (
    <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
      <span className="truncate">{media.name}</span>
      {moment && <span className="shrink-0 tabular-nums">· {moment}</span>}
    </span>
  )
}

// A file the model chose to show with show_media, in the reply with its player.
export function MediaView({ media }: { media: ShownMedia }) {
  const url = useUploadUrl(media.id)

  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {url ? <Player media={media} url={url} className="max-h-96" /> : <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      <figcaption>
        <Caption media={media} />
      </figcaption>
    </figure>
  )
}

// A file the model viewed, previewed on hover over its step in the chain of thought.
export function MediaPreview({ media }: { media: ShownMedia }) {
  const url = useUploadUrl(media.id)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-24 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {url ? <Player media={media} url={url} className="max-h-64" /> : <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      <Caption media={media} />
    </div>
  )
}
