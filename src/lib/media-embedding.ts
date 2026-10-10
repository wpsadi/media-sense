import type { EmbeddingSegment } from "@/lib/embedding-db"
import { embedClip, embedFrames, embedImage } from "@/lib/embedding-client"
import type { WorkerFrame } from "@/lib/embedding-worker"
import { decodeAudio, decodeSoundtrack, drawFrame, isSilent, openVideo, seekTo, type OpenVideo } from "@/lib/media-decode"
import type { UploadRecord } from "@/lib/upload-cache"

export type EmbeddedMedia = {
  vector: Float32Array
  segments: EmbeddingSegment[]
}

// Video and audio are embedded in stretches of this length, so search can say when something happens.
// Long files use longer stretches, so no file needs more than MAX_SEGMENTS.
const SEGMENT_SECONDS = 10
const MAX_SEGMENTS = 90
// Video is sampled at one frame per second. Very long videos have longer stretches, so a stretch is
// capped at the 32 frames the video processor takes before it subsamples on its own.
const FRAMES_PER_SECOND = 1
const MAX_FRAMES_PER_SEGMENT = 32
// The processor resizes frames itself; drawing them small keeps memory low on long videos.
const FRAME_MAX_EDGE = 768
// The model's audio feature extractor expects mono 16 kHz.
const SAMPLE_RATE = 16000
// How many stretches may be waiting on the worker while the next one is being cut from the file.
// One is enough to keep the worker busy; two also covers a slow seek.
const MAX_IN_FLIGHT = 2

type Span = { start: number; end: number }

function spansOf(duration: number): Span[] {
  const length = Math.max(SEGMENT_SECONDS, duration / MAX_SEGMENTS)
  const spans: Span[] = []
  for (let start = 0; start < duration; start += length) spans.push({ start, end: Math.min(duration, start + length) })
  // A short tail is folded into the stretch before it.
  const last = spans.at(-1)
  if (spans.length > 1 && last && last.end - last.start < length / 4) {
    spans.pop()
    spans[spans.length - 1].end = last.end
  }
  return spans.length > 0 ? spans : [{ start: 0, end: duration }]
}

function mean(vectors: Float32Array[]): Float32Array {
  const result = new Float32Array(vectors[0].length)
  for (const vector of vectors) {
    let norm = 0
    for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i]
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < vector.length; i++) result[i] += vector[i] / norm
  }
  return result
}

// Pixels of the frames in one stretch, drawn on the UI thread and handed to the worker.
async function extractFrames(opened: OpenVideo, start: number, end: number): Promise<WorkerFrame[]> {
  const count = Math.min(MAX_FRAMES_PER_SEGMENT, Math.max(1, Math.round((end - start) * FRAMES_PER_SECOND)))
  const frames: WorkerFrame[] = []
  for (let i = 0; i < count; i++) {
    const time = start + ((i + 0.5) / count) * (end - start)
    await seekTo(opened, time)
    const canvas = drawFrame(opened.video, FRAME_MAX_EDGE)
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)
    frames.push({ data: pixels.data, width: canvas.width, height: canvas.height, time })
  }
  return frames
}

// One model run per stretch keeps each run inside the WebGPU batch budget the model card gives.
// Clips are cut and sent in order; the worker answers in order, so the segments keep their order too.
async function embedAudio(samples: Float32Array, skipSilence: boolean): Promise<EmbeddingSegment[]> {
  const segments: EmbeddingSegment[] = []
  const waiting: Promise<EmbeddingSegment>[] = []
  for (const { start, end } of spansOf(samples.length / SAMPLE_RATE)) {
    const clip = samples.subarray(Math.floor(start * SAMPLE_RATE), Math.floor(end * SAMPLE_RATE))
    if (skipSilence && isSilent(clip)) continue
    if (waiting.length >= MAX_IN_FLIGHT) segments.push(await waiting.shift()!)
    waiting.push(embedClip(clip).then((vector): EmbeddingSegment => ({ start, end, source: "audio", vector })))
  }
  segments.push(...(await Promise.all(waiting)))
  return segments
}

async function embedVideo(blob: Blob): Promise<EmbeddingSegment[]> {
  const opened = await openVideo(blob)
  // The soundtrack decodes while the frames are being cut. It is awaited once the picture is done.
  const soundtrack = decodeSoundtrack(blob, opened.duration, SAMPLE_RATE)
  const segments: EmbeddingSegment[] = []
  const waiting: Promise<EmbeddingSegment>[] = []
  try {
    for (const { start, end } of spansOf(opened.duration)) {
      // Cutting this stretch's frames overlaps with the worker still embedding the earlier ones.
      const frames = await extractFrames(opened, start, end)
      if (waiting.length >= MAX_IN_FLIGHT) segments.push(await waiting.shift()!)
      waiting.push(embedFrames(frames, end - start).then((vector): EmbeddingSegment => ({ start, end, source: "frames", vector })))
    }
    segments.push(...(await Promise.all(waiting)))
  } finally {
    opened.close()
  }

  // What is said in the video. Videos with no soundtrack, a silent one, or one that cannot be lined up add nothing.
  const audio = await soundtrack
  if (audio) segments.push(...(await embedAudio(audio, true)))
  return segments
}

// Images, audio and videos each take their own slot in the processor, with no text, as the model card shows.
export async function embedMedia(upload: UploadRecord, blob: Blob): Promise<EmbeddedMedia> {
  if (upload.kind === "image") {
    return { vector: await embedImage(blob), segments: [] }
  }

  let segments: EmbeddingSegment[]
  if (upload.kind === "audio") {
    const samples = await decodeAudio(blob, SAMPLE_RATE)
    segments = await embedAudio(samples, true)
    // A quiet recording is still embedded rather than left unsearchable.
    if (segments.length === 0) segments = await embedAudio(samples, false)
  } else {
    segments = await embedVideo(blob)
  }
  return { vector: mean(segments.map((segment) => segment.vector)), segments }
}
