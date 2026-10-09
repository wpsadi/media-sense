import "@videojs/react/audio/skin.css"
import "@videojs/react/video/skin.css"
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio"
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { useUploadUrl } from "@/hooks/use-upload-url"
import { fileDate, type UploadRecord } from "@/lib/upload-cache"
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  ImageIcon,
  InfoIcon,
  MoreHorizontalIcon,
  MusicIcon,
  Trash2Icon,
  VideoIcon,
} from "lucide-react"

// Shows the cached file itself; a video is previewed by its first frame.
// Audio has no picture, so the grid shows an icon and the preview gets a player.
// The preview uses Video.js for audio and video; the grid keeps native elements.
export function UploadMedia({
  upload,
  controls = false,
  className,
}: {
  upload: UploadRecord
  controls?: boolean
  className?: string
}) {
  const url = useUploadUrl(upload.id)
  if (!url) return <div className={`bg-muted ${className ?? ""}`} />

  if (upload.kind === "audio") {
    if (!controls) {
      return (
        <div className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ""}`}>
          <MusicIcon className="size-1/3" />
        </div>
      )
    }
    return (
      <div className="flex size-full items-center justify-center p-6">
        <AudioPlayer>
          <AudioSkin style={{ width: "min(80vw, 36rem)" }}>
            <Audio src={url} />
          </AudioSkin>
        </AudioPlayer>
      </div>
    )
  }

  if (upload.kind === "video") {
    if (controls) {
      return (
        <VideoPlayer>
          <VideoSkin style={{ width: "min(90vw, 56rem)", maxHeight: "75dvh" }}>
            <Video src={url} playsInline />
          </VideoSkin>
        </VideoPlayer>
      )
    }
    return (
      <video
        // A tiny seek makes the browser paint a frame instead of an empty box.
        src={`${url}#t=0.1`}
        muted
        preload="metadata"
        className={className}
      />
    )
  }
  return <img src={url} alt={upload.name} loading="lazy" className={className} />
}

export type UploadHandlers = {
  onOpen: (upload: UploadRecord) => void
  onDetails: (upload: UploadRecord) => void
  onDownload: (upload: UploadRecord) => void
  onCopyName: (upload: UploadRecord) => void
  onDelete: (upload: UploadRecord) => void
}

type TileAction = {
  key: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  destructive?: boolean
  run: () => void
}

// One list feeds both the right-click menu and the three-dot menu.
function tileActions(upload: UploadRecord, handlers: UploadHandlers): TileAction[] {
  return [
    { key: "open", label: "Open", icon: <EyeIcon />, shortcut: "Enter", run: () => handlers.onOpen(upload) },
    { key: "details", label: "Details", icon: <InfoIcon />, run: () => handlers.onDetails(upload) },
    { key: "download", label: "Download", icon: <DownloadIcon />, shortcut: "D", run: () => handlers.onDownload(upload) },
    { key: "copy", label: "Copy name", icon: <CopyIcon />, run: () => handlers.onCopyName(upload) },
    {
      key: "delete",
      label: "Delete",
      icon: <Trash2Icon />,
      shortcut: "Del",
      destructive: true,
      run: () => handlers.onDelete(upload),
    },
  ]
}

type MonthGroup = { key: string; label: string; uploads: UploadRecord[] }

// Uploads arrive newest first, so each month's items are contiguous.
function groupByMonth(uploads: UploadRecord[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>()
  for (const upload of uploads) {
    const date = new Date(fileDate(upload))
    const key = `${date.getFullYear()}-${date.getMonth()}`
    let group = groups.get(key)
    if (!group) {
      const label = date.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      group = { key, label, uploads: [] }
      groups.set(key, group)
    }
    group.uploads.push(upload)
  }
  return [...groups.values()]
}

function GalleryTile({
  upload,
  handlers,
  onActivate,
}: {
  upload: UploadRecord
  handlers: UploadHandlers
  onActivate: (upload: UploadRecord) => void
}) {
  const actions = tileActions(upload, handlers)
  const destructive = actions.find((action) => action.destructive)
  const others = actions.filter((action) => !action.destructive)

  return (
    <li className="group/tile relative">
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              onClick={() => handlers.onOpen(upload)}
              onFocus={() => onActivate(upload)}
              onContextMenu={() => onActivate(upload)}
              title={upload.path}
              className="group relative block aspect-square w-full overflow-hidden rounded-lg border bg-muted transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          }
        >
          <UploadMedia
            upload={upload}
            className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
          <span className="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded bg-background/80 text-muted-foreground backdrop-blur">
            {upload.kind === "video" ? (
              <VideoIcon className="size-3" />
            ) : upload.kind === "audio" ? (
              <MusicIcon className="size-3" />
            ) : (
              <ImageIcon className="size-3" />
            )}
          </span>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {others.map((action) => (
            <ContextMenuItem key={action.key} onClick={action.run}>
              {action.icon}
              <span>{action.label}</span>
              {action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          {destructive && (
            <ContextMenuItem variant="destructive" onClick={destructive.run}>
              {destructive.icon}
              <span>{destructive.label}</span>
              {destructive.shortcut && <ContextMenuShortcut>{destructive.shortcut}</ContextMenuShortcut>}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="secondary"
              size="icon-xs"
              aria-label={`Actions for ${upload.name}`}
              onClick={() => onActivate(upload)}
              className="absolute top-1.5 right-1.5 bg-background/80 backdrop-blur transition-opacity md:opacity-0 md:group-hover/tile:opacity-100 md:focus-visible:opacity-100 aria-expanded:opacity-100"
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48" align="end">
          {others.map((action) => (
            <DropdownMenuItem key={action.key} onClick={action.run}>
              {action.icon}
              <span>{action.label}</span>
              {action.shortcut && <DropdownMenuShortcut>{action.shortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {destructive && (
            <DropdownMenuItem variant="destructive" onClick={destructive.run}>
              {destructive.icon}
              <span>{destructive.label}</span>
              {destructive.shortcut && <DropdownMenuShortcut>{destructive.shortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

export function GalleryGrid({
  uploads,
  handlers,
  onActivate,
}: {
  uploads: UploadRecord[]
  handlers: UploadHandlers
  onActivate: (upload: UploadRecord) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      {groupByMonth(uploads).map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h2 className="text-base font-medium">{group.label}</h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {group.uploads.map((upload) => (
              <GalleryTile key={upload.id} upload={upload} handlers={handlers} onActivate={onActivate} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
