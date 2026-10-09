import { create } from "zustand"
import {
  deleteUpload,
  listUploads,
  saveUploads,
  type UploadRecord,
  type UploadWrite,
} from "@/lib/upload-cache"

type GalleryState = {
  uploads: UploadRecord[]
  loaded: boolean
  error: string | null
  refresh: () => Promise<void>
  addFiles: (writes: UploadWrite[]) => Promise<UploadRecord[]>
  remove: (id: string) => Promise<void>
}

// Shared so the sidebar upload and the gallery page stay in sync.
export const useGalleryStore = create<GalleryState>((set, get) => ({
  uploads: [],
  loaded: false,
  error: null,
  refresh: async () => {
    try {
      const uploads = await listUploads()
      set({ uploads, loaded: true, error: null })
    } catch (err) {
      set({ loaded: true, error: err instanceof Error ? err.message : String(err) })
    }
  },
  addFiles: async (writes) => {
    const saved = await saveUploads(writes)
    await get().refresh()
    return saved
  },
  remove: async (id) => {
    await deleteUpload(id)
    set({ uploads: get().uploads.filter((upload) => upload.id !== id) })
  },
}))
