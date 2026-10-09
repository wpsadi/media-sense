import { create } from "zustand"
import { experimental_generateSpeech as generateSpeech, type SpeechModel } from "ai"

import { encodeWav } from "@/lib/media-decode"

// Reads one reply aloud at a time with Gemini TTS. The reply is spoken in chunks: a short first one so
// playback starts quickly, then longer ones, each generated while the one before it plays.

export const TTS_MODEL_ID = "gemini-3.8-flash-tts"
const VOICE = "Kore"
const FIRST_CHUNK_WORDS = 30
const CHUNK_WORDS = 160
const RATES = [1, 1.25, 1.5, 2, 0.75]
// Gemini TTS gives no word timings. Within a chunk, the lit word follows playback by its share of
// the characters, and chunks not generated yet are estimated at this pace.
const CHARS_PER_SECOND = 15

type Chunk = {
  from: number
  to: number
  text: string
  // Cumulative character share at the end of each word, to map playback position to a word.
  ends: number[]
  audio?: Promise<string>
  duration?: number
}

type ReadAloudState = {
  // The message being read, or null when nothing is.
  messageId: string | null
  words: string[]
  spokenIndex: number
  playing: boolean
  // Waiting for Gemini to generate the next chunk.
  loading: boolean
  rate: number
  elapsed: number
  duration: number
  error: string | null
  start: (messageId: string, text: string, model: SpeechModel) => void
  toggle: () => void
  cycleRate: () => void
  stop: () => void
}

// Markdown as it should sound: no markup, link text without the address.
export function speakableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*~]/g, "")
    .replace(/[_#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Whole sentences grouped into chunks, the first one short.
function chunksOf(words: string[]): Chunk[] {
  const chunks: Chunk[] = []
  let from = 0
  words.forEach((word, index) => {
    const limit = chunks.length === 0 ? FIRST_CHUNK_WORDS : CHUNK_WORDS
    const sentenceEnd = /[.!?…]$/.test(word)
    const size = index + 1 - from
    if (index === words.length - 1 || (sentenceEnd && size >= limit / 2) || size >= limit * 1.5) {
      const chunkWords = words.slice(from, index + 1)
      const total = chunkWords.reduce((sum, w) => sum + w.length + 1, 0)
      let running = 0
      const ends = chunkWords.map((w) => (running += w.length + 1) / total)
      chunks.push({ from, to: index + 1, text: chunkWords.join(" "), ends })
      from = index + 1
    }
  })
  return chunks
}

const SILENCE = URL.createObjectURL(new Blob([encodeWav(new Float32Array(160), 8000)], { type: "audio/wav" }))

type Session = {
  model: SpeechModel
  chunks: Chunk[]
  // The chunk playing, or about to.
  index: number
  // Whether the audio element holds the current chunk.
  ready: boolean
  audio: HTMLAudioElement
  frame: number
}

let session: Session | null = null

export const useReadAloudStore = create<ReadAloudState>((set, get) => {
  function load(current: Session, chunk: Chunk) {
    chunk.audio ??= generateSpeech({ model: current.model, text: chunk.text, voice: VOICE, outputFormat: "wav" }).then(
      ({ audio }) =>
        URL.createObjectURL(new Blob([new Uint8Array(audio.uint8Array)], { type: audio.mediaType || "audio/wav" })),
    )
    return chunk.audio
  }

  function estimate(chunk: Chunk) {
    return chunk.duration ?? chunk.text.length / CHARS_PER_SECOND
  }

  // Moves the lit word and the clock with playback.
  function track(current: Session) {
    cancelAnimationFrame(current.frame)
    const tick = () => {
      if (session !== current) return
      const chunk = current.chunks[current.index]
      const { currentTime, duration } = current.audio
      if (chunk && current.ready && Number.isFinite(duration) && duration > 0) {
        const share = currentTime / duration
        const word = chunk.ends.findIndex((end) => end > share)
        set({
          spokenIndex: chunk.from + (word === -1 ? chunk.ends.length - 1 : word),
          elapsed: current.chunks.slice(0, current.index).reduce((sum, c) => sum + estimate(c), 0) + currentTime,
          duration: current.chunks.reduce((sum, c) => sum + estimate(c), 0),
        })
      }
      if (!current.audio.paused) current.frame = requestAnimationFrame(tick)
    }
    current.frame = requestAnimationFrame(tick)
  }

  async function playChunk(current: Session, index: number) {
    if (session !== current) return
    const chunk = current.chunks[index]
    current.index = index
    current.ready = false
    if (!chunk) {
      set({ playing: false, loading: false, spokenIndex: get().words.length, elapsed: get().duration })
      return
    }

    set({ loading: true, spokenIndex: chunk.from })
    let url: string
    try {
      url = await load(current, chunk)
    } catch (err) {
      if (session !== current) return
      set({ playing: false, loading: false, error: err instanceof Error ? err.message : "Speech could not be generated." })
      return
    }
    if (session !== current) return
    // The next chunk is generated while this one plays.
    const next = current.chunks[index + 1]
    if (next) load(current, next).catch(() => {})

    current.audio.src = url
    current.audio.playbackRate = get().rate
    current.ready = true
    set({ loading: false })
    // Paused while it was generating: it stays ready and plays on the next toggle.
    if (!get().playing) return
    try {
      await current.audio.play()
      track(current)
    } catch {
      if (session === current) set({ playing: false })
    }
  }

  function end() {
    const current = session
    session = null
    if (!current) return
    cancelAnimationFrame(current.frame)
    current.audio.pause()
    current.audio.removeAttribute("src")
    for (const chunk of current.chunks) chunk.audio?.then((url) => URL.revokeObjectURL(url)).catch(() => {})
  }

  return {
    messageId: null,
    words: [],
    spokenIndex: 0,
    playing: false,
    loading: false,
    rate: 1,
    elapsed: 0,
    duration: 0,
    error: null,

    start: (messageId, text, model) => {
      end()
      const words = speakableText(text).split(" ").filter(Boolean)
      const chunks = chunksOf(words)
      const audio = new Audio()
      // Playing a moment of silence inside the click unlocks audio for Safari, which otherwise
      // blocks the real audio because it starts after the network wait.
      audio.src = SILENCE
      audio.play().catch(() => {})
      const current: Session = { model, chunks, index: 0, ready: false, audio, frame: 0 }
      // Only a chunk ending moves on; the unlocking silence also ends, before any chunk is ready.
      audio.onended = () => {
        if (current.ready) void playChunk(current, current.index + 1)
      }
      session = current
      set({
        messageId,
        words,
        spokenIndex: 0,
        playing: true,
        error: null,
        elapsed: 0,
        duration: chunks.reduce((sum, c) => sum + estimate(c), 0),
      })
      void playChunk(current, 0)
    },

    toggle: () => {
      const current = session
      if (!current) return
      if (get().playing) {
        current.audio.pause()
        set({ playing: false })
        return
      }
      set({ playing: true, error: null })
      // Finished: start over from the first chunk, which is already generated.
      if (current.index >= current.chunks.length) {
        void playChunk(current, 0)
      } else if (current.ready) {
        current.audio.playbackRate = get().rate
        current.audio
          .play()
          .then(() => track(current))
          .catch(() => set({ playing: false }))
      } else if (!get().loading) {
        // A failed chunk is generated again.
        current.chunks[current.index].audio = undefined
        void playChunk(current, current.index)
      }
    },

    // Gemini TTS has no speed setting, so playback speeds up instead, keeping the pitch.
    cycleRate: () => {
      const rate = RATES[(RATES.indexOf(get().rate) + 1) % RATES.length]
      if (session) session.audio.playbackRate = rate
      set({ rate })
    },

    stop: () => {
      end()
      set({ messageId: null, words: [], spokenIndex: 0, playing: false, loading: false, elapsed: 0, duration: 0, error: null })
    },
  }
})
