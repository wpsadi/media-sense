import { create } from "zustand"
import type { UploadKind, UploadRecord } from "@/lib/upload-cache"

export type GalleryFilter = "all" | UploadKind

// Gallery UI state that the command menu, shortcuts and gallery page all share.
type GalleryUiState = {
  filter: GalleryFilter
  setFilter: (filter: GalleryFilter) => void
  // The file the shortcuts act on: the last one focused or opened from its menu.
  activeId: string | null
  setActiveId: (id: string | null) => void
  // The file open in the gallery preview.
  openedId: string | null
  setOpenedId: (id: string | null) => void
  // Waiting for the delete confirmation.
  pendingDelete: UploadRecord | null
  requestDelete: (upload: UploadRecord | null) => void
  // The file whose details dialog is open.
  detailsUpload: UploadRecord | null
  setDetailsUpload: (upload: UploadRecord | null) => void
}

export const useGalleryUiStore = create<GalleryUiState>((set) => ({
  filter: "all",
  setFilter: (filter) => set({ filter }),
  activeId: null,
  setActiveId: (activeId) => set({ activeId }),
  openedId: null,
  setOpenedId: (openedId) => set({ openedId }),
  pendingDelete: null,
  requestDelete: (pendingDelete) => set({ pendingDelete }),
  detailsUpload: null,
  setDetailsUpload: (detailsUpload) => set({ detailsUpload }),
}))
