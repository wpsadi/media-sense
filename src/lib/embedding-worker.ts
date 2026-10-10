// The embedding model, run off the UI thread. embedding-client.ts sends requests here and the model stays
// loaded for as long as this worker lives. Requests run one at a time, in the order they arrive.
import { AutoModel, AutoProcessor, load_image, RawImage, RawVideo, RawVideoFrame } from "@huggingface/transformers"
import { EMBEDDING_MODEL_ID, type FileProgress } from "@/lib/embedding-model"

export type Device = "webgpu" | "wasm"

// The pixels of one frame. Its buffer is transferred to the worker, not copied.
export type WorkerFrame = { data: Uint8ClampedArray; width: number; height: number; time: number }

export type WorkerRequest =
  | { type: "load"; forceWasm: boolean }
  | { type: "text"; text: string }
  | { type: "image"; blob: Blob }
  | { type: "frames"; frames: WorkerFrame[]; duration: number }
  | { type: "clip"; samples: Float32Array }

export type WorkerEnvelope = { id: number } & WorkerRequest

export type WorkerMessage =
  | { type: "progress"; id: number; files: FileProgress[] }
  | { type: "reply"; id: number; vector?: Float32Array; device?: Device; error?: string }

type Loaded = {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>
  device: Device
}

let loaded: Loaded | null = null

const post = (message: WorkerMessage, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(message, transfer)

async function load(id: number, forceWasm: boolean): Promise<Device> {
  // Byte counts per downloaded file, keyed by file name, so overall progress
  // is summed across every file the model pulls rather than one file's percent.
  // "initiate" fires before the size is known (the size lookup), so a file's
  // total stays 0 until its first "progress" event.
  const files = new Map<string, FileProgress>()
  const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (!info.file) return
    const previous = files.get(info.file) ?? { file: info.file, loaded: 0, total: 0 }
    if (info.status === "initiate") {
      files.set(info.file, previous)
    } else if (info.status === "progress") {
      files.set(info.file, { file: info.file, loaded: info.loaded ?? 0, total: info.total ?? previous.total })
    } else if (info.status === "done") {
      files.set(info.file, { ...previous, loaded: previous.total })
    } else {
      return
    }
    post({ type: "progress", id, files: [...files.values()] })
  }

  const attempt = async (device: Device): Promise<Loaded> => {
    const processor = await AutoProcessor.from_pretrained(EMBEDDING_MODEL_ID, { progress_callback })
    const model = await AutoModel.from_pretrained(EMBEDDING_MODEL_ID, { device, dtype: "q4", progress_callback })
    return { processor, model, device }
  }

  // Set after a WebGPU failure while running, because a lost GPU device cannot be reused.
  // The client starts a fresh worker for every load, so this load never shares a device with a failed one.
  loaded = forceWasm ? await attempt("wasm") : await attempt("webgpu").catch(() => attempt("wasm"))
  return loaded.device
}

async function embed(request: Exclude<WorkerRequest, { type: "load" }>): Promise<Float32Array> {
  if (!loaded) throw new Error("The embedding model is not loaded.")
  const { processor, model } = loaded

  // Each media kind goes in its own processor slot, with no text, as the model card shows.
  let inputs: unknown
  switch (request.type) {
    // The client adds the search prefix, so the text is matched against media in the same space.
    case "text":
      inputs = await processor([request.text])
      break
    case "image":
      inputs = await processor(null, await load_image(request.blob))
      break
    case "clip":
      inputs = await processor(null, null, request.samples)
      break
    case "frames": {
      const frames = request.frames.map(
        (frame) => new RawVideoFrame(new RawImage(frame.data, frame.width, frame.height, 4), frame.time),
      )
      inputs = await processor(null, null, null, new RawVideo(frames, request.duration))
      break
    }
  }

  const output = await model(inputs)
  return Float32Array.from(output.sentence_embedding.data as ArrayLike<number>)
}

// One request at a time: the model runs one batch on the device at once.
let chain: Promise<void> = Promise.resolve()

self.addEventListener("message", (event: MessageEvent<WorkerEnvelope>) => {
  const request = event.data
  chain = chain.then(async () => {
    try {
      if (request.type === "load") {
        post({ type: "reply", id: request.id, device: await load(request.id, request.forceWasm) })
        return
      }
      const vector = await embed(request)
      post({ type: "reply", id: request.id, vector }, [vector.buffer])
    } catch (err) {
      post({ type: "reply", id: request.id, error: err instanceof Error ? err.message : String(err) })
    }
  })
})
