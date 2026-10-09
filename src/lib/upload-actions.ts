import { getUploadBlob, type UploadRecord } from "@/lib/upload-cache"

// Saves the cached file under its real name.
export async function downloadUpload(upload: UploadRecord): Promise<void> {
  const blob = await getUploadBlob(upload.id)
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = upload.name
  link.click()
  // Revoked a moment later so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function copyName(upload: UploadRecord): void {
  void navigator.clipboard?.writeText(upload.name).catch(() => {})
}
