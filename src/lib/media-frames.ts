import { formatRange, formatTime } from "@/lib/format-time"
import { decodeAudio, decodeSoundtrack, drawFrame, encodeWav, isSilent, openVideo, seekTo } from "@/lib/media-decode"
import type { UploadKind } from "@/lib/upload-cache"

// What the model receives for a file: text plus base64 parts it can look at or listen to.
export type ModelPart =
  | { type: "text"; text: string }
  | { type: "file"; data: { type: "data"; data: string }; mediaType: string }

// A stretch of a video or audio file to look at, in seconds. Either end may be left out.
export type TimeRange = { start?: number; end?: number }

const IMAGE_MAX_EDGE = 1024
const VIDEO_MAX_EDGE = 768
// Video is sampled at one frame per second. Longer stretches are spread over this many frames,
// and the model is told to look at a shorter range for every second.
const FRAMES_PER_SECOND = 1
const MAX_VIDEO_FRAMES = 60
// Audio clips are sent as 16 kHz mono WAV: about 1.9 MB a minute.
const CLIP_SAMPLE_RATE = 16000
const MAX_CLIP_SECONDS = 8 * 60
// A whole audio file under this size is sent as it is, in its own format.
const AUDIO_MAX_BYTES = 15 * 1024 * 1024

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function text(value: string): ModelPart {
  return { type: "text", text: value }
}

function file(data: string, mediaType: string): ModelPart {
  return { type: "file", data: { type: "data", data }, mediaType }
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
  if (!blob) throw new Error("Could not encode the image.")
  return toBase64(new Uint8Array(await blob.arrayBuffer()))
}

// The asked-for stretch, kept inside the file. With no range, the whole file.
function clampRange(range: TimeRange | undefined, duration: number) {
  const start = Math.min(Math.max(0, range?.start ?? 0), duration)
  const end = Math.min(Math.max(start, range?.end ?? duration), duration)
  return end > start ? { start, end } : { start: Math.max(0, start - 5), end: Math.min(duration, start + 5) }
}

async function imageParts(blob: Blob): Promise<ModelPart[]> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas is unavailable in this browser.")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return [file(await canvasJpeg(canvas), "image/jpeg")]
  } finally {
    URL.revokeObjectURL(url)
  }
}

// A WAV clip of the samples between start and end, or null when that stretch is silent.
function audioClip(samples: Float32Array, start: number, end: number): ModelPart | null {
  const clip = samples.subarray(Math.floor(start * CLIP_SAMPLE_RATE), Math.floor(end * CLIP_SAMPLE_RATE))
  if (isSilent(clip)) return null
  return file(toBase64(encodeWav(clip, CLIP_SAMPLE_RATE)), "audio/wav")
}

// Frames at one per second, each labelled with its time, plus the soundtrack of the same stretch.
async function videoParts(blob: Blob, range: TimeRange | undefined): Promise<ModelPart[]> {
  const opened = await openVideo(blob)
  const { start, end } = clampRange(range, opened.duration)
  const wanted = Math.max(1, Math.round((end - start) * FRAMES_PER_SECOND))
  const count = Math.min(MAX_VIDEO_FRAMES, wanted)
  const step = (end - start) / count

  const parts: ModelPart[] = [
    text(
      `The video is ${formatTime(opened.duration)} long. These are frames from ${formatRange(start, end)}, ` +
        (count === wanted
          ? "one per second"
          : `one every ${step.toFixed(1)} seconds; call view_media with a shorter start and end to see every second`) +
        ". Each frame is labelled with its time from the start of the video.",
    ),
  ]
  try {
    for (let i = 0; i < count; i++) {
      const time = start + (i + 0.5) * step
      await seekTo(opened, time)
      parts.push(text(`Frame at ${formatTime(time)}`), file(await canvasJpeg(drawFrame(opened.video, VIDEO_MAX_EDGE)), "image/jpeg"))
    }
  } finally {
    opened.close()
  }

  if (end - start > MAX_CLIP_SECONDS) {
    parts.push(text("The soundtrack is left out for stretches this long. View a shorter range to hear it."))
    return parts
  }
  const samples = await decodeSoundtrack(blob, opened.duration, CLIP_SAMPLE_RATE)
  const clip = samples && audioClip(samples, start, end)
  parts.push(
    clip
      ? text(`Soundtrack from ${formatRange(start, end)}. Its time 0:00 is ${formatTime(start)} in the video.`)
      : text("The video has no audible soundtrack in this stretch, or its sound could not be lined up with the picture."),
  )
  if (clip) parts.push(clip)
  return parts
}

async function audioParts(blob: Blob, mediaType: string, range: TimeRange | undefined): Promise<ModelPart[]> {
  // The whole file as it is, when it is small enough. The model gives times from its start.
  if (!range && blob.size <= AUDIO_MAX_BYTES) {
    const data = toBase64(new Uint8Array(await blob.arrayBuffer()))
    return [text("The whole audio file. Give times from its start."), file(data, mediaType || "audio/mpeg")]
  }

  const samples = await decodeAudio(blob, CLIP_SAMPLE_RATE)
  const duration = samples.length / CLIP_SAMPLE_RATE
  const { start, end } = clampRange(range, duration)
  if (end - start > MAX_CLIP_SECONDS) {
    throw new Error(
      `This audio is ${formatTime(duration)} long. Call view_media with a start and end at most ${MAX_CLIP_SECONDS / 60} minutes apart.`,
    )
  }
  const clip = audioClip(samples, start, end)
  if (!clip) return [text(`The audio from ${formatRange(start, end)} is silent.`)]
  return [
    text(`Audio from ${formatRange(start, end)} of a ${formatTime(duration)} file. Its time 0:00 is ${formatTime(start)} in the file.`),
    clip,
  ]
}

// Turns a saved file, or a stretch of it, into what the model can see or hear.
export async function modelPartsFor(
  blob: Blob,
  kind: UploadKind,
  mediaType: string,
  range?: TimeRange,
): Promise<ModelPart[]> {
  if (kind === "image") return imageParts(blob)
  if (kind === "video") return videoParts(blob, range)
  return audioParts(blob, mediaType, range)
}
