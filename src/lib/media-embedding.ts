import { load_image, RawImage, RawVideo, RawVideoFrame } from "@huggingface/transformers"
import type { EmbeddingSegment } from "@/lib/embedding-db"
import type { EmbeddingModelParts } from "@/lib/embedding-model"
import { decodeAudio, decodeSoundtrack, drawFrame, isSilent, openVideo, seekTo } from "@/lib/media-decode"
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

async function embed({ model }: EmbeddingModelParts, inputs: unknown): Promise<Float32Array> {
  const output = await model(inputs)
  return Float32Array.from(output.sentence_embedding.data as ArrayLike<number>)
}

// One model run per stretch keeps each run inside the WebGPU batch budget the model card gives.
async function embedAudio(samples: Float32Array, parts: EmbeddingModelParts, skipSilence: boolean) {
  const segments: EmbeddingSegment[] = []
  for (const { start, end } of spansOf(samples.length / SAMPLE_RATE)) {
    const clip = samples.subarray(Math.floor(start * SAMPLE_RATE), Math.floor(end * SAMPLE_RATE))
    if (skipSilence && isSilent(clip)) continue
    const vector = await embed(parts, await parts.processor(null, null, clip))
    segments.push({ start, end, source: "audio", vector })
  }
  return segments
}

async function embedVideo(blob: Blob, parts: EmbeddingModelParts): Promise<EmbeddingSegment[]> {
  const opened = await openVideo(blob)
  const segments: EmbeddingSegment[] = []
  try {
    for (const { start, end } of spansOf(opened.duration)) {
      const count = Math.min(MAX_FRAMES_PER_SEGMENT, Math.max(1, Math.round((end - start) * FRAMES_PER_SECOND)))
      const frames: RawVideoFrame[] = []
      for (let i = 0; i < count; i++) {
        const time = start + ((i + 0.5) / count) * (end - start)
        await seekTo(opened, time)
        const canvas = drawFrame(opened.video, FRAME_MAX_EDGE)
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)
        frames.push(new RawVideoFrame(new RawImage(pixels.data, canvas.width, canvas.height, 4), time))
      }
      const vector = await embed(parts, await parts.processor(null, null, null, new RawVideo(frames, end - start)))
      segments.push({ start, end, source: "frames", vector })
    }
  } finally {
    opened.close()
  }

  // What is said in the video. Videos with no soundtrack, a silent one, or one that cannot be lined up add nothing.
  const soundtrack = await decodeSoundtrack(blob, opened.duration, SAMPLE_RATE)
  if (soundtrack) segments.push(...(await embedAudio(soundtrack, parts, true)))
  return segments
}

// The processor takes text, images, audio, then videos by position. Each media kind goes in
// its own slot, with no text, as the model card shows.
export async function embedMedia(upload: UploadRecord, blob: Blob, parts: EmbeddingModelParts): Promise<EmbeddedMedia> {
  if (upload.kind === "image") {
    return { vector: await embed(parts, await parts.processor(null, await load_image(blob))), segments: [] }
  }

  let segments: EmbeddingSegment[]
  if (upload.kind === "audio") {
    const samples = await decodeAudio(blob, SAMPLE_RATE)
    segments = await embedAudio(samples, parts, true)
    // A quiet recording is still embedded rather than left unsearchable.
    if (segments.length === 0) segments = await embedAudio(samples, parts, false)
  } else {
    segments = await embedVideo(blob, parts)
  }
  return { vector: mean(segments.map((segment) => segment.vector)), segments }
}
