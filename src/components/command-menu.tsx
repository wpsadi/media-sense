import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { useLocation, useNavigate } from "react-router-dom"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useSemanticMatches } from "@/hooks/use-semantic-matches"
import { copyName, downloadUpload } from "@/lib/upload-actions"
import { fileDate, type UploadRecord } from "@/lib/upload-cache"
import { useCommandMenuStore } from "@/stores/command-menu-store"
import { useGalleryStore } from "@/stores/gallery-store"
import { useEmbeddingModelStore } from "@/stores/embedding-model-store"
import { useGalleryUiStore, type GalleryFilter } from "@/stores/gallery-ui-store"
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  ImageIcon,
  ImagesIcon,
  InfoIcon,
  LayoutGridIcon,
  MoonIcon,
  MusicIcon,
  SparklesIcon,
  SunIcon,
  Trash2Icon,
  VideoIcon,
} from "lucide-react"

// Typing in a field must not trigger single-key shortcuts.
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

// The month and year the gallery groups the file under, so typing "March 2026" finds it.
function monthLabel(upload: UploadRecord) {
  return new Date(fileDate(upload)).toLocaleDateString(undefined, { month: "long", year: "numeric" })
}

// Any open dialog, menu or listbox means the page is busy; shortcuts stay quiet then.
function somePopupOpen() {
  return document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null
}

const GALLERY_PATH = "/gallery"

// Mounted once in the app so the header search, Ctrl/⌘ K and the file shortcuts work on every page.
export function CommandMenu() {
  const open = useCommandMenuStore((s) => s.open)
  const setOpen = useCommandMenuStore((s) => s.setOpen)
  const uploads = useGalleryStore((s) => s.uploads)
  const activeId = useGalleryUiStore((s) => s.activeId)
  const setActiveId = useGalleryUiStore((s) => s.setActiveId)
  const setFilter = useGalleryUiStore((s) => s.setFilter)
  const setOpenedId = useGalleryUiStore((s) => s.setOpenedId)
  const requestDelete = useGalleryUiStore((s) => s.requestDelete)
  const setDetailsUpload = useGalleryUiStore((s) => s.setDetailsUpload)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { resolvedTheme, setTheme } = useTheme()

  const active = uploads.find((upload) => upload.id === activeId) ?? null
  const isDark = resolvedTheme === "dark"

  const [query, setQuery] = useState("")
  const trimmed = query.trim()
  const modelStatus = useEmbeddingModelStore((s) => s.status)
  const semantic = useSemanticMatches(query)
  const semanticUploads = (semantic?.matches ?? []).flatMap(({ uploadId, score }) => {
    const upload = uploads.find((item) => item.id === uploadId)
    return upload ? [{ upload, score }] : []
  })
  // Embedding score per file for the current query, shown on the file rows too.
  const scoreById = new Map((semantic?.matches ?? []).map(({ uploadId, score }) => [uploadId, score]))

  // The active file belongs to the gallery, so leaving it clears the shortcuts' target.
  useEffect(() => {
    if (pathname !== GALLERY_PATH) setActiveId(null)
  }, [pathname, setActiveId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === "k") {
        if (!open && somePopupOpen()) return
        event.preventDefault()
        setOpen(!open)
        return
      }
      if (open || somePopupOpen() || !active) return
      if (modifier || event.altKey || isTypingTarget(event.target)) return

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        requestDelete(active)
      } else if (event.key.toLowerCase() === "d") {
        event.preventDefault()
        void downloadUpload(active)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, active, setOpen, requestDelete])

  // Closing clears the query, so the next open starts fresh.
  function handleOpenChange(next: boolean) {
    if (!next) setQuery("")
    setOpen(next)
  }

  // Every command closes the menu first, so its action can open a dialog of its own.
  function run(action: () => void) {
    return () => {
      handleOpenChange(false)
      action()
    }
  }

  function goToGallery() {
    if (pathname !== GALLERY_PATH) navigate(GALLERY_PATH)
  }

  function showFilter(filter: GalleryFilter) {
    setFilter(filter)
    goToGallery()
  }

  function openFile(upload: UploadRecord) {
    setActiveId(upload.id)
    setOpenedId(upload.id)
    goToGallery()
  }

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} title="Command menu" description="Run a command or find a file">
      <CommandInput placeholder="Type a command or describe a file..." value={query} onValueChange={setQuery} />
      <CommandList>
        {/* cmdk ignores forced rows when counting, so the description group must suppress this itself. */}
        {trimmed.length < 2 && <CommandEmpty>No results found.</CommandEmpty>}

        {trimmed.length >= 2 && modelStatus !== "ready" && (
          <CommandGroup heading="Search by description">
            <CommandItem forceMount disabled value="search-model-not-ready">
              <SparklesIcon />
              Load the embedding model from the sidebar to search by description
            </CommandItem>
          </CommandGroup>
        )}

        {semantic?.error && (
          <CommandGroup heading="Search by description">
            <CommandItem forceMount disabled value="search-error">
              Search failed: {semantic.error}
            </CommandItem>
          </CommandGroup>
        )}

        {semantic && !semantic.error && semanticUploads.length === 0 && (
          <CommandGroup heading="Search by description">
            <CommandItem forceMount disabled value="search-no-matches">
              No embedded media matches yet
            </CommandItem>
          </CommandGroup>
        )}

        {semanticUploads.length > 0 && (
          <CommandGroup heading={`Matches for "${trimmed}"`}>
            {semanticUploads.map(({ upload, score }) => (
              <CommandItem
                key={upload.id}
                value={`match-${upload.id}`}
                forceMount
                onSelect={run(() => openFile(upload))}
              >
                <SparklesIcon />
                <span className="truncate">{upload.name}</span>
                <CommandShortcut>{Math.round(score * 100)}%</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {active && (
          <CommandGroup heading={active.name}>
            <CommandItem onSelect={run(() => openFile(active))}>
              <EyeIcon />
              Open
              <CommandShortcut>Enter</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => setDetailsUpload(active))}>
              <InfoIcon />
              Details
            </CommandItem>
            <CommandItem onSelect={run(() => void downloadUpload(active))}>
              <DownloadIcon />
              Download
              <CommandShortcut>D</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => copyName(active))}>
              <CopyIcon />
              Copy name
            </CommandItem>
            <CommandItem onSelect={run(() => requestDelete(active))}>
              <Trash2Icon />
              Delete
              <CommandShortcut>Del</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Go to">
          <CommandItem onSelect={run(() => navigate("/"))}>
            <SparklesIcon />
            Ask AI
          </CommandItem>
          <CommandItem onSelect={run(() => showFilter("all"))}>
            <ImagesIcon />
            Gallery
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Gallery">
          <CommandItem onSelect={run(() => showFilter("all"))}>
            <LayoutGridIcon />
            Show all
          </CommandItem>
          <CommandItem onSelect={run(() => showFilter("image"))}>
            <ImageIcon />
            Show images
          </CommandItem>
          <CommandItem onSelect={run(() => showFilter("video"))}>
            <VideoIcon />
            Show videos
          </CommandItem>
          <CommandItem onSelect={run(() => showFilter("audio"))}>
            <MusicIcon />
            Show audio
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Theme">
          <CommandItem onSelect={run(() => setTheme(isDark ? "light" : "dark"))}>
            {isDark ? <SunIcon /> : <MoonIcon />}
            {isDark ? "Switch to light theme" : "Switch to dark theme"}
          </CommandItem>
        </CommandGroup>

        {uploads.length > 0 && (
          <CommandGroup heading="Files">
            {uploads.map((upload) => (
              <CommandItem
                key={upload.id}
                value={upload.id}
                keywords={[upload.name, upload.path, upload.kind, upload.type, monthLabel(upload)]}
                onSelect={run(() => openFile(upload))}
              >
                <span className="truncate">{upload.name}</span>
                {scoreById.has(upload.id) && (
                  <CommandShortcut>{Math.round(scoreById.get(upload.id)! * 100)}%</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
