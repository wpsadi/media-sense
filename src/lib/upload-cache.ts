// Uploads live in Cache Storage so they survive reloads. Each file is one cached
// response; its metadata travels in a header so listing never needs a second store.
const CACHE_NAME = "video-sence-uploads"
const UPLOAD_PATH = "/uploads/"
const META_HEADER = "X-Upload-Meta"

export type UploadKind = "image" | "video" | "audio"

export type UploadRecord = {
  id: string
  name: string
  // Folder-relative path for folder uploads, otherwise the file name.
  path: string
  type: string
  size: number
  kind: UploadKind
  // The file's own last-modified time. Browsers do not expose creation time.
  // Missing on records saved before this field existed.
  modifiedAt?: number
  uploadedAt: number
}

// A file that is already saved under the same path, waiting for a Replace or Discard decision.
export type UploadConflict = {
  file: File
  existing: UploadRecord
}

export type UploadPlan = {
  fresh: File[]
  conflicts: UploadConflict[]
  skipped: number
}

// One cache write. `replaces` is the saved copy this file takes the place of.
export type UploadWrite = {
  file: File
  replaces?: UploadRecord
}

export function fileDate(record: UploadRecord): number {
  return record.modifiedAt ?? record.uploadedAt
}

function kindOf(file: File): UploadKind | null {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  return null
}

function pathOf(file: File): string {
  return file.webkitRelativePath || file.name
}

async function openCache() {
  // Cache Storage only exists in secure contexts (https or localhost).
  if (!("caches" in window)) {
    throw new Error("Cache Storage is unavailable here. Open the app over https or localhost.")
  }
  return caches.open(CACHE_NAME)
}

function readRecord(response: Response): UploadRecord | null {
  const raw = response.headers.get(META_HEADER)
  if (!raw) return null
  try {
    return JSON.parse(decodeURIComponent(raw)) as UploadRecord
  } catch {
    return null
  }
}

// Splits a selection into files that can be saved as they are and files whose path
// is already in the cache. Nothing is written here, so the caller can ask first.
export async function planUploads(files: File[]): Promise<UploadPlan> {
  const existing = new Map((await listUploads()).map((record) => [record.path, record]))
  const plan: UploadPlan = { fresh: [], conflicts: [], skipped: 0 }

  for (const file of files) {
    if (!kindOf(file)) {
      plan.skipped += 1
      continue
    }
    const match = existing.get(pathOf(file))
    if (match) plan.conflicts.push({ file, existing: match })
    else plan.fresh.push(file)
  }

  return plan
}

// Images, videos and audio only; anything else is skipped by planUploads.
// The new copy is written before the one it replaces is removed.
export async function saveUploads(writes: UploadWrite[]): Promise<UploadRecord[]> {
  const cache = await openCache()
  const saved: UploadRecord[] = []

  for (const { file, replaces } of writes) {
    const kind = kindOf(file)
    if (!kind) continue

    const record: UploadRecord = {
      id: crypto.randomUUID(),
      name: file.name,
      path: pathOf(file),
      type: file.type,
      size: file.size,
      kind,
      modifiedAt: file.lastModified,
      uploadedAt: Date.now(),
    }

    await cache.put(
      UPLOAD_PATH + record.id,
      new Response(file, {
        headers: {
          "Content-Type": file.type,
          [META_HEADER]: encodeURIComponent(JSON.stringify(record)),
        },
      }),
    )
    if (replaces) await cache.delete(UPLOAD_PATH + replaces.id)
    saved.push(record)
  }

  return saved
}

// Newest file date first; the gallery groups this order by month.
export async function listUploads(): Promise<UploadRecord[]> {
  const cache = await openCache()
  const requests = await cache.keys()
  const responses = await Promise.all(
    requests
      .filter((request) => new URL(request.url).pathname.startsWith(UPLOAD_PATH))
      .map((request) => cache.match(request)),
  )
  return responses
    .filter((response): response is Response => response !== undefined)
    .map(readRecord)
    .filter((record): record is UploadRecord => record !== null)
    .sort((a, b) => fileDate(b) - fileDate(a))
}

export async function getUploadBlob(id: string): Promise<Blob | null> {
  const cache = await openCache()
  const response = await cache.match(UPLOAD_PATH + id)
  return response ? response.blob() : null
}

export async function deleteUpload(id: string): Promise<void> {
  const cache = await openCache()
  await cache.delete(UPLOAD_PATH + id)
}
