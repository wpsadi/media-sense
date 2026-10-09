// Browser decoding shared by embedding (media-embedding.ts) and the model's view of a file (media-frames.ts).

export type OpenVideo = {
  video: HTMLVideoElement
  duration: number
  close: () => void
}

function waitFor(video: HTMLVideoElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      video.removeEventListener(event, done)
      video.removeEventListener("error", fail)
      resolve()
    }
    const fail = () => {
      video.removeEventListener(event, done)
      reject(new Error("The video could not be read."))
    }
    video.addEventListener(event, done, { once: true })
    video.addEventListener("error", fail, { once: true })
  })
}

// Loads a video for seeking. Call close when done to release it.
export async function openVideo(blob: Blob): Promise<OpenVideo> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement("video")
  video.muted = true
  video.preload = "auto"
  video.src = url
  const close = () => {
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }

  try {
    await waitFor(video, "loadedmetadata")
    // Recordings from MediaRecorder (screen recordings) report Infinity until the end has been reached.
    if (!Number.isFinite(video.duration)) {
      video.currentTime = Number.MAX_SAFE_INTEGER
      await waitFor(video, "seeked")
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("The video length could not be read.")
    return { video, duration: video.duration, close }
  } catch (error) {
    close()
    throw error
  }
}

// Seeks to a time, kept just inside the clip so the last frame still decodes.
export async function seekTo({ video, duration }: OpenVideo, time: number) {
  video.currentTime = Math.min(Math.max(0, time), Math.max(0, duration - 0.05))
  await waitFor(video, "seeked")
}

// The current frame, scaled so its longest edge is at most maxEdge.
export function drawFrame(video: HTMLVideoElement, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Canvas is unavailable in this browser.")
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

// The audio of a file, or the soundtrack of a video, as mono samples at sampleRate.
// Rejects when the file has no audio the browser can decode.
export async function decodeAudio(blob: Blob, sampleRate: number): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate })
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0)
    const mono = new Float32Array(decoded.length)
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel)
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels
    }
    return mono
  } finally {
    void context.close()
  }
}

// A video's soundtrack, or null when it has none or it cannot be lined up with the picture.
// The browser decodes the audio track without its start time, so a track that starts late in the
// container would put every sound at the wrong time. Its length must match the video's.
export async function decodeSoundtrack(blob: Blob, duration: number, sampleRate: number): Promise<Float32Array | null> {
  const samples = await decodeAudio(blob, sampleRate).catch(() => null)
  if (!samples) return null
  return Math.abs(samples.length / sampleRate - duration) <= Math.max(1, duration * 0.02) ? samples : null
}

// Screen recordings often carry a silent track; silence is neither embedded nor sent to the model.
export function isSilent(samples: Float32Array) {
  if (samples.length === 0) return true
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length) < 0.005
}

// 16-bit PCM WAV, which Gemini accepts as audio.
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples.length * 2))
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return bytes
}
