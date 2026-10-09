import { useEffect, useState } from "react"
import { getUploadBlob } from "@/lib/upload-cache"

// Turns a cached upload into a temporary object URL, released when the component unmounts.
export function useUploadUrl(id: string) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    getUploadBlob(id)
      .then((blob) => {
        if (!blob || cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])

  return url
}
