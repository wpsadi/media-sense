import { useEffect } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { GalleryGrid, UploadMedia, type UploadHandlers } from "@/components/gallery-grid"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { copyName, downloadUpload } from "@/lib/upload-actions"
import { useGalleryStore } from "@/stores/gallery-store"
import { useGalleryUiStore, type GalleryFilter } from "@/stores/gallery-ui-store"
import { ImagesIcon, Trash2Icon, XIcon } from "lucide-react"

export default function GalleryPage() {
  const uploads = useGalleryStore((s) => s.uploads)
  const loaded = useGalleryStore((s) => s.loaded)
  const error = useGalleryStore((s) => s.error)
  const refresh = useGalleryStore((s) => s.refresh)

  const filter = useGalleryUiStore((s) => s.filter)
  const setFilter = useGalleryUiStore((s) => s.setFilter)
  const setActiveId = useGalleryUiStore((s) => s.setActiveId)
  const openedId = useGalleryUiStore((s) => s.openedId)
  const setOpenedId = useGalleryUiStore((s) => s.setOpenedId)
  const requestDelete = useGalleryUiStore((s) => s.requestDelete)
  const setDetailsUpload = useGalleryUiStore((s) => s.setDetailsUpload)

  // Derived from the cache, so a deleted file's preview closes by itself.
  const opened = uploads.find((upload) => upload.id === openedId) ?? null

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = filter === "all" ? uploads : uploads.filter((upload) => upload.kind === filter)

  const handlers: UploadHandlers = {
    onOpen: (upload) => {
      setActiveId(upload.id)
      setOpenedId(upload.id)
    },
    onDetails: (upload) => setDetailsUpload(upload),
    onDownload: (upload) => void downloadUpload(upload),
    onCopyName: copyName,
    onDelete: (upload) => requestDelete(upload),
  }

  let content
  if (error) {
    content = <p className="text-sm text-destructive">Could not read the cache: {error}</p>
  } else if (!loaded) {
    content = <p className="text-sm text-muted-foreground">Loading...</p>
  } else if (visible.length === 0) {
    content = (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
        <ImagesIcon className="size-8 text-muted-foreground" />
        <p className="font-medium">{uploads.length === 0 ? "Nothing uploaded yet" : "No items match this filter"}</p>
        <p className="text-sm text-muted-foreground">
          {uploads.length === 0 ? "Use Upload in the sidebar to add images or videos." : "Try another tab."}
        </p>
      </div>
    )
  } else {
    content = <GalleryGrid uploads={visible} handlers={handlers} onActivate={(upload) => setActiveId(upload.id)} />
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader title="Gallery" />
        <div className="flex flex-1 flex-col gap-4 px-4 py-4 lg:px-6 md:py-6">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as GalleryFilter)}>
            <TabsList>
              <TabsTrigger value="all">All ({uploads.length})</TabsTrigger>
              <TabsTrigger value="image">Images</TabsTrigger>
              <TabsTrigger value="video">Videos</TabsTrigger>
              <TabsTrigger value="audio">Audio</TabsTrigger>
            </TabsList>
          </Tabs>
          {content}
        </div>

        <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpenedId(null)}>
          <DialogContent
            showCloseButton={false}
            className="w-auto min-w-72 max-w-[min(90vw,56rem)] gap-0 overflow-hidden border-0 bg-black p-0 sm:max-w-[min(90vw,56rem)]"
          >
            {opened && (
              <>
                <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2 text-white">
                  <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                    {opened.name}
                  </DialogTitle>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    className="text-white hover:bg-white/10 hover:text-red-400"
                    onClick={() => handlers.onDelete(opened)}
                  >
                    <Trash2Icon />
                  </Button>
                  <DialogClose
                    render={
                      <Button variant="ghost" size="icon-sm" aria-label="Close" className="text-white hover:bg-white/10" />
                    }
                  >
                    <XIcon />
                  </DialogClose>
                </div>
                <UploadMedia
                  upload={opened}
                  controls
                  className="block max-h-[75dvh] max-w-full object-contain"
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  )
}
