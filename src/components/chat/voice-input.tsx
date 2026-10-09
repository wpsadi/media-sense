import { useEffect, useRef, useState } from "react"
import { generateText, type LanguageModel } from "ai"
import { CheckIcon, MicIcon, XIcon } from "lucide-react"

import { VoiceOrb } from "@/components/assistant-ui/elements/voice"
import { Button } from "@/components/ui/button"
import { formatTime } from "@/lib/format-time"
import { decodeAudio, encodeWav } from "@/lib/media-decode"

// Gemini takes WAV but not the WebM the browser records, so the recording is re-encoded at 16 kHz mono.
const SAMPLE_RATE = 16000
const TRANSCRIBE_PROMPT =
  "Transcribe this voice message exactly as spoken. Keep the speaker's language; write Hindi and Hinglish in Latin script, as it would be typed in a chat. Return only the transcript, with no notes. If nothing is said, return an empty reply."

type Phase = "idle" | "recording" | "transcribing"

type Recording = {
  recorder: MediaRecorder
  stream: MediaStream
  audio: AudioContext
  chunks: Blob[]
  frame: number
  keep: boolean
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function transcribe(model: LanguageModel, recording: Blob) {
  const wav = encodeWav(await decodeAudio(recording, SAMPLE_RATE), SAMPLE_RATE)
  const { text } = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: TRANSCRIBE_PROMPT },
          { type: "file", data: toBase64(wav), mediaType: "audio/wav" },
        ],
      },
    ],
  })
  return text.trim()
}

// The mic button of the composer. While it records, it takes the composer's place with the voice orb,
// which follows the speaker's level; stopping turns the recording into text with Gemini.
export function VoiceInput({
  model,
  disabled,
  onActiveChange,
  onTranscript,
}: {
  model: LanguageModel
  disabled?: boolean
  onActiveChange: (active: boolean) => void
  onTranscript: (text: string) => void
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [volume, setVolume] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recording = useRef<Recording | null>(null)
  // Set while the microphone is being asked for, so a second click or an unmount does not leave a stream open.
  const starting = useRef(false)
  const unmounted = useRef(false)

  function setActive(next: Phase) {
    setPhase(next)
    onActiveChange(next !== "idle")
  }

  function release(current: Recording) {
    cancelAnimationFrame(current.frame)
    current.stream.getTracks().forEach((track) => track.stop())
    void current.audio.close()
  }

  // Releases the microphone if the chat closes mid-recording.
  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      const current = recording.current
      if (!current) return
      current.keep = false
      if (current.recorder.state !== "inactive") current.recorder.stop()
      release(current)
    }
  }, [])

  async function start() {
    if (starting.current || recording.current) return
    starting.current = true
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError("Microphone access was blocked.")
      return
    } finally {
      starting.current = false
    }
    if (unmounted.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }

    const audio = new AudioContext()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 512
    audio.createMediaStreamSource(stream).connect(analyser)
    const levels = new Uint8Array(analyser.fftSize)
    const recorder = new MediaRecorder(stream)
    const current: Recording = { recorder, stream, audio, chunks: [], frame: 0, keep: true }
    recording.current = current
    const startedAt = performance.now()

    // The orb follows the speaker's level, and the timer counts up.
    const tick = () => {
      analyser.getByteTimeDomainData(levels)
      let sum = 0
      for (const level of levels) sum += ((level - 128) / 128) ** 2
      setVolume(Math.min(1, Math.sqrt(sum / levels.length) * 4))
      setSeconds((performance.now() - startedAt) / 1000)
      current.frame = requestAnimationFrame(tick)
    }

    recorder.ondataavailable = (event) => current.chunks.push(event.data)
    recorder.onstop = async () => {
      release(current)
      recording.current = null
      setVolume(0)
      if (!current.keep) {
        setActive("idle")
        return
      }
      setActive("transcribing")
      try {
        const text = await transcribe(model, new Blob(current.chunks, { type: recorder.mimeType }))
        if (text) onTranscript(text)
        else setError("No speech was heard.")
      } catch (err) {
        setError(err instanceof Error ? err.message : "The recording could not be transcribed.")
      } finally {
        setActive("idle")
      }
    }

    recorder.start()
    setSeconds(0)
    setActive("recording")
    current.frame = requestAnimationFrame(tick)
  }

  function finish(keep: boolean) {
    const current = recording.current
    if (!current) return
    current.keep = keep
    current.recorder.stop()
  }

  if (phase === "idle") {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="hidden max-w-48 truncate text-xs text-destructive sm:inline">{error}</span>}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => void start()}
          aria-label="Voice input"
          title={error ?? "Voice input"}
        >
          <MicIcon />
        </Button>
      </div>
    )
  }

  const transcribing = phase === "transcribing"
  return (
    <div className="flex min-h-9 flex-1 items-center gap-3 pl-1" aria-live="polite">
      <span className="relative grid size-9 shrink-0 place-items-center">
        {/* A ring that follows the level, which also shows where WebGL (and so the orb) is unavailable. */}
        <span
          className="absolute inset-1 rounded-full bg-blue-500/25 transition-transform duration-75 dark:bg-blue-400/25"
          style={{ transform: `scale(${transcribing ? 1 : 1 + volume * 0.5})` }}
        />
        <VoiceOrb state={transcribing ? "connecting" : "listening"} volume={volume} variant="blue" className="relative size-9" />
      </span>
      <span className="flex-1 text-sm text-muted-foreground">
        {transcribing ? "Transcribing…" : "Listening…"}
        {!transcribing && <span className="ml-2 font-mono text-xs tabular-nums">{formatTime(seconds)}</span>}
      </span>
      {!transcribing && (
        <>
          <Button type="button" variant="ghost" size="icon" onClick={() => finish(false)} aria-label="Cancel voice input">
            <XIcon />
          </Button>
          <Button type="button" size="icon" onClick={() => finish(true)} aria-label="Stop and transcribe">
            <CheckIcon />
          </Button>
        </>
      )}
    </div>
  )
}
