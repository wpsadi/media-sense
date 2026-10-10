// The UI thread's side of the embedding worker. Each call posts one request and resolves with its reply.
import type { FileProgress } from "@/lib/embedding-model"
import type { Device, WorkerFrame, WorkerMessage, WorkerRequest } from "@/lib/embedding-worker"

type Reply = { vector?: Float32Array; device?: Device }

type Pending = {
  resolve: (reply: Reply) => void
  reject: (error: Error) => void
  onProgress?: (files: FileProgress[]) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function spawn(): Worker {
  const next = new Worker(new URL("./embedding-worker.ts", import.meta.url), { type: "module" })
  next.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data
    if (message.type === "progress") {
      pending.get(message.id)?.onProgress?.(message.files)
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error))
    else entry.resolve({ vector: message.vector, device: message.device })
  }
  // An uncaught error in the worker leaves no reply to wait for, so every waiting call fails.
  next.onerror = (event) => failAll(new Error(event.message || "The embedding worker failed."))
  return next
}

function active(): Worker {
  if (!worker) worker = spawn()
  return worker
}

function failAll(error: Error) {
  for (const [id, entry] of pending) {
    pending.delete(id)
    entry.reject(error)
  }
}

function call(request: WorkerRequest, transfer: Transferable[] = [], onProgress?: (files: FileProgress[]) => void) {
  const id = nextId++
  return new Promise<Reply>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    active().postMessage({ ...request, id }, transfer)
  })
}

function vectorOf(reply: Reply): Float32Array {
  if (!reply.vector) throw new Error("The embedding worker sent no vector.")
  return reply.vector
}

// Loads the model in a fresh worker. A new worker also drops a GPU device that failed.
export async function loadEmbeddingModel(
  forceWasm: boolean,
  onProgress: (files: FileProgress[]) => void,
): Promise<Device> {
  worker?.terminate()
  worker = null
  failAll(new Error("The embedding model was reloaded."))
  const reply = await call({ type: "load", forceWasm }, [], onProgress)
  if (!reply.device) throw new Error("The embedding worker did not report a device.")
  return reply.device
}

export async function embedText(text: string): Promise<Float32Array> {
  return vectorOf(await call({ type: "text", text }))
}

export async function embedImage(blob: Blob): Promise<Float32Array> {
  return vectorOf(await call({ type: "image", blob }))
}

// The frames' buffers move to the worker, so the caller must not use them afterwards.
export async function embedFrames(frames: WorkerFrame[], duration: number): Promise<Float32Array> {
  const transfer = frames.map((frame) => frame.data.buffer as ArrayBuffer)
  return vectorOf(await call({ type: "frames", frames, duration }, transfer))
}

// A copy is sent, so the caller's samples stay usable and the worker gets only this clip, not the whole file.
export async function embedClip(samples: Float32Array): Promise<Float32Array> {
  const copy = samples.slice()
  return vectorOf(await call({ type: "clip", samples: copy }, [copy.buffer]))
}
