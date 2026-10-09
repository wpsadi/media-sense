import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { experimental_useRealtime as useRealtime } from "@ai-sdk/react"
import type { GoogleGenerativeAIProvider } from "@ai-sdk/google"
import {
  experimental_getRealtimeToolDefinitions as getRealtimeToolDefinitions,
  jsonSchema,
  tool,
  type LanguageModel,
  type Experimental_RealtimeSessionConfig as RealtimeSessionConfig,
  type ToolExecutionOptions,
  type UIMessage,
} from "ai"
import { MicIcon, MicOffIcon, PhoneOffIcon } from "lucide-react"

import { VoiceOrb, type VoiceOrbState } from "@/components/assistant-ui/elements/voice"
import { Button } from "@/components/ui/button"
import { currentDateLine, formatTime } from "@/lib/format-time"
import { createLiveViewMediaTool, searchMediaTool, showMediaTool } from "@/lib/media-tools"
import { createWebSearchTool } from "@/lib/web-search"

// A spoken conversation with Gemini Live. The browser mints a short-lived token with the user's own key, so no
// server is needed. Live tool results are plain JSON, so its view_media has a regular model describe the file.
// gemini-3.1-flash-live-preview accepted the setup but restarted every turn and closed with 1011, with or without tools.
const LIVE_MODEL_ID = "gemini-3.8-live"
// The model hangs up itself. The call ends once its goodbye has finished playing; LiveSession handles that.
const endCallTool = tool({
  description:
    "Hang up this voice call. Call it when the user says goodbye or asks to end, stop or hang up the call, after you have said a short goodbye. The call ends once your goodbye has played.",
  // Gemini rejects an object schema with no properties, so the tool takes a short reason.
  inputSchema: jsonSchema<{ reason?: string }>({
    type: "object",
    properties: { reason: { type: "string", description: "Why the call is ending, in a few words." } },
  }),
  execute: async () => ({ ending: true }),
})
function liveTools(google: GoogleGenerativeAIProvider, viewModel: LanguageModel) {
  return {
    search_media: searchMediaTool,
    view_media: createLiveViewMediaTool(viewModel),
    show_media: showMediaTool,
    web_search: createWebSearchTool(google),
    end_call: endCallTool,
  }
}
type LiveTools = ReturnType<typeof liveTools>
const LIVE_INSTRUCTIONS = [
  "You are Ask AI, an assistant inside a video and media workspace, talking with the user by voice. Keep replies short and conversational.",
  "You can search the user's saved media with search_media, which returns the top 5 matches by meaning. Use it when a question is about their files.",
  "Search results only name the files and the moments that matched. To find out what a file or a moment shows or says, call view_media with its id, the user's question, and for video or audio the moment's start and end; it returns a description. Tell the user you are taking a look first, since it takes a few seconds.",
  "Only say what a file shows from a view_media description, never from its name or a search score.",
  "To show files to the user, call show_media with the ones that answer their question. For a video or audio file, pass start to open it at the matched moment.",
  "Your own knowledge is out of date and you cannot tell how far, so search the web yourself, without being asked, whenever an answer depends on facts about the world: news and current events, anything recent or upcoming, people, companies, products, prices, releases, versions, scores, weather, schedules, laws, statistics, or any fact you are not certain of. When in doubt, search; never answer such questions from memory alone, and never tell the user to look it up themselves. Search again with different wording if the first answer is thin. Skip it only for small talk, the user's own files, and timeless knowledge such as maths or definitions.",
  "Call web_search with one clear, self-contained question and answer from what it returns. Say briefly that you are checking first, such as 'let me check'. Do not read out web addresses.",
  "When the user says goodbye or asks to end the call, say a brief goodbye and call end_call. Do not end the call otherwise.",
].join(" ")
// Every step of a call is logged to the console under this prefix, to debug calls that fail to connect.
// The latest steps are also kept, so a failed call prints what led up to it in one block.
const recentLog: string[] = []
function log(...args: unknown[]) {
  console.info("[Gemini Live]", ...args)
  const line = args.map((arg) => (typeof arg === "string" ? arg : safeJson(arg))).join(" ")
  recentLog.push(`${new Date().toISOString().slice(11, 23)} ${line.slice(0, 600)}`)
  if (recentLog.length > 40) recentLog.shift()
}
function safeJson(value: unknown) {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
function dumpRecentLog(reason: string) {
  console.error(`[Gemini Live] ${reason}. The steps before it, to copy:\n\n${recentLog.join("\n")}`)
}
// Server events that stream many times a second are counted, not logged one by one.
const NOISY_EVENTS = new Set(["audio-delta", "audio-transcript-delta", "input-audio-transcript-delta", "audio-chunk"])

// In development, the Gemini Live WebSocket itself is tapped: its open and close (with the close code and reason),
// every message sent, grouped by its top-level key and counted each second, and every received message except
// audio, so a call that drops or goes silent shows why.
if (import.meta.env.DEV && typeof WebSocket !== "undefined" && !("__geminiLiveTap" in WebSocket)) {
  const Native = WebSocket
  const Tapped = class extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      if (!String(url).includes("BidiGenerateContent")) return
      log("ws opening", String(url).replace(/access_token=[^&]+/, "access_token=…"))
      const sent: Record<string, number> = {}
      const timer = setInterval(() => {
        if (Object.keys(sent).length) log("ws sent in the last second", { ...sent })
        for (const key of Object.keys(sent)) delete sent[key]
      }, 1000)
      const send = this.send.bind(this)
      this.send = (data) => {
        try {
          const keys = typeof data === "string" ? Object.keys(JSON.parse(data)) : ["binary"]
          for (const key of keys) {
            if (key === "realtimeInput") sent[key] = (sent[key] ?? 0) + 1
            else {
              const message = typeof data === "string" ? JSON.parse(data) : data
              log("ws send", key, message)
              // The setup is long, so its tools are logged on their own lines, in full.
              for (const declaration of message.setup?.tools?.[0]?.functionDeclarations ?? []) {
                log("setup tool", declaration.name, declaration.parametersJsonSchema ?? declaration.parameters)
              }
            }
          }
        } catch {
          // Not JSON; sent as is.
        }
        send(data)
      }
      this.addEventListener("open", () => log("ws open"))
      this.addEventListener("error", (event) => log("ws error", event))
      this.addEventListener("close", (event) => {
        clearInterval(timer)
        log("ws closed", { code: event.code, reason: event.reason, wasClean: event.wasClean })
        if (event.code !== 1000) dumpRecentLog(`WebSocket closed with ${event.code}`)
      })
      this.addEventListener("message", async (event) => {
        const text = typeof event.data === "string" ? event.data : await (event.data as Blob).text()
        try {
          const message = JSON.parse(text)
          const parts = message.serverContent?.modelTurn?.parts as { inlineData?: unknown }[] | undefined
          if (parts?.some((part) => part.inlineData)) return
          log("ws received", message)
        } catch {
          log("ws received (not JSON)", text.slice(0, 200))
        }
      })
    }
  }
  Object.defineProperty(Tapped, "__geminiLiveTap", { value: true })
  window.WebSocket = Tapped
}

// For debugging: localStorage "gemini-live-model" picks another Live model for the next call.
function liveModelId() {
  try {
    return window.localStorage.getItem("gemini-live-model") || LIVE_MODEL_ID
  } catch {
    return LIVE_MODEL_ID
  }
}

function liveToolsOff() {
  try {
    return window.localStorage.getItem("gemini-live-tools") === "off"
  } catch {
    return false
  }
}

// How long the token may be used to open the session. Gemini checks it against its own clock, and the default of
// 60 seconds is counted from this computer's clock, so a clock a minute slow made every call fail with
// "new_session_expire_time deadline exceeded". The token is minted just before connecting either way.
const TOKEN_OPEN_WINDOW_SECONDS = 10 * 60

// The earlier text chat is given to the model as context, newest turns last, up to this many characters.
const HISTORY_CHARS = 4000


function historyText(messages: UIMessage[]) {
  let text = ""
  for (const message of [...messages].reverse()) {
    const said = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ").trim()
    if (!said) continue
    const line = `${message.role === "user" ? "User" : "You"}: ${said}\n`
    if (text.length + line.length > HISTORY_CHARS) break
    text = line + text
  }
  return text
}

// Live transcripts as chat messages: empty parts dropped, ids made unique so they can join the saved chat.
function liveTranscript(messages: UIMessage[], sessionId: string): UIMessage[] {
  return messages.flatMap((message, index) => {
    const parts = message.parts.filter((part) => part.type !== "text" || part.text.trim())
    return parts.length ? [{ ...message, id: `live-${sessionId}-${index}`, parts }] : []
  })
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop())
}

type Setup = {
  stream: MediaStream
  sessionConfig: Partial<RealtimeSessionConfig>
  token: string
  tools: LiveTools
  // The token is minted for one model, so the session must use the same one.
  modelId: string
}

// Asks for the microphone, then mints the token. The session mounts once both are ready.
export function LiveVoice({
  google,
  viewModel,
  history,
  onMessages,
  onEnd,
}: {
  google: GoogleGenerativeAIProvider
  viewModel: LanguageModel
  history: UIMessage[]
  onMessages: (messages: UIMessage[]) => void
  onEnd: (messages: UIMessage[]) => void
}) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The history at the moment the call started; later changes do not restart it.
  const [context] = useState(() => historyText(history))
  const [tools] = useState(() => liveTools(google, viewModel))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let stream: MediaStream
      log("asking for the microphone")
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      } catch (err) {
        log("microphone blocked", err)
        if (!cancelled) setError("Microphone access was blocked.")
        return
      }
      const track = stream.getAudioTracks()[0]
      log("microphone open", { label: track?.label, settings: track?.getSettings(), cancelled })
      // Once the session mounts it releases the stream; until then, a cancelled start releases it here.
      const release = () => stopStream(stream)
      if (cancelled) return release()
      try {
        const sessionConfig: RealtimeSessionConfig = {
          instructions: [`${LIVE_INSTRUCTIONS} ${currentDateLine()}`, context && `The conversation so far:\n${context}`]
            .filter(Boolean)
            .join("\n\n"),
          outputModalities: ["audio"],
          inputAudioFormat: { type: "audio/pcm", rate: 16000 },
          outputAudioFormat: { type: "audio/pcm", rate: 24000 },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // For debugging: localStorage "gemini-live-tools" set to "off" starts the call with no tools.
          tools: liveToolsOff() ? [] : await getRealtimeToolDefinitions({ tools }),
        }
        const modelId = liveModelId()
        log("minting token", { model: modelId, tools: sessionConfig.tools?.map((tool) => tool.name) })
        const { token, url, expiresAt } = await google.experimental_realtime.getToken({
          model: modelId,
          sessionConfig,
          expiresAfterSeconds: TOKEN_OPEN_WINDOW_SECONDS,
        })
        log("token minted", { url, expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : undefined, cancelled })
        if (cancelled) return release()
        // The session fetches its setup from a URL. A data: URL hands it the token minted here, in place of a server route.
        const payload = JSON.stringify({ token, url, expiresAt })
        setSetup({ stream, sessionConfig, tools, modelId, token: `data:application/json,${encodeURIComponent(payload)}` })
      } catch (err) {
        release()
        console.error("[Gemini Live] could not start", err)
        if (!cancelled) setError(err instanceof Error ? err.message : "Gemini Live could not start.")
      }
    })()
    return () => {
      cancelled = true
    }
    // Runs once per call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (setup) return <LiveSession google={google} setup={setup} onMessages={onMessages} onEnd={onEnd} />
  return (
    <LiveBar
      phase={error ? "error" : "connecting"}
      state={error ? "idle" : "connecting"}
      label={error ?? "Connecting to Gemini Live…"}
      onEnd={() => onEnd([])}
    />
  )
}

function LiveSession({
  google,
  setup,
  onMessages,
  onEnd,
}: {
  google: GoogleGenerativeAIProvider
  setup: Setup
  onMessages: (messages: UIMessage[]) => void
  onEnd: (messages: UIMessage[]) => void
}) {
  const model = useMemo(() => google.experimental_realtime(setup.modelId), [google, setup.modelId])
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 10))

  const eventCounts = useRef<Record<string, number>>({})
  // Set when the model calls end_call.
  const [hangingUp, setHangingUp] = useState(false)
  const realtime = useRealtime({
    model,
    api: { token: setup.token },
    sessionConfig: setup.sessionConfig,
    onToolCall: async ({ toolCall }) => {
      log("tool call", toolCall.toolName, toolCall.args)
      const tool = setup.tools[toolCall.toolName as keyof LiveTools]
      if (!tool?.execute) return { error: `There is no tool named ${toolCall.toolName}.` }
      if (toolCall.toolName === "end_call") setHangingUp(true)
      const options = { toolCallId: toolCall.toolCallId, messages: [], context: undefined } as ToolExecutionOptions<unknown>
      try {
        const result = await tool.execute(toolCall.args as never, options as never)
        log("tool result", toolCall.toolName, result)
        return result
      } catch (err) {
        log("tool failed", toolCall.toolName, err)
        return { error: err instanceof Error ? err.message : "The tool failed." }
      }
    },
    onEvent: (event) => {
      if (NOISY_EVENTS.has(event.type)) {
        eventCounts.current[event.type] = (eventCounts.current[event.type] ?? 0) + 1
        return
      }
      log("event", event.type, event)
    },
    onError: (err) => {
      console.error("[Gemini Live] error", err)
      log("error", err)
      setError(err.message)
    },
  })
  const { status, messages, isPlaying, isCapturing, connect, disconnect, resumePlayback, startAudioCapture, stopAudioCapture, commitAudio } =
    realtime

  // The hook disposes the session itself when it unmounts; by then its controls are detached and throw,
  // so there is no disconnect in this cleanup, and a late connect or resume is ignored.
  useEffect(() => {
    log("connecting")
    void connect({ stream: setup.stream })
      .then(() => {
        log("connect() resolved")
        return resumePlayback()
      })
      .catch((err) => log("connect() or resumePlayback() failed", err))
  }, [connect, resumePlayback, setup.stream])

  const transcript = useMemo(() => liveTranscript(messages, sessionId), [messages, sessionId])
  useEffect(() => onMessages(transcript), [transcript, onMessages])

  // The call counts as live only while the session is connected. The timer starts at that moment, and a call
  // that drops afterwards shows as ended, not as connecting again.
  useEffect(() => log("status", status), [status])
  useEffect(() => log(isCapturing ? "sending microphone audio" : "not sending microphone audio"), [isCapturing])
  useEffect(() => log(isPlaying ? "playing reply" : "reply playback idle"), [isPlaying])
  // Once a second, how many streamed events arrived, so a silent connection is easy to spot.
  useEffect(() => {
    const timer = setInterval(() => {
      const counts = eventCounts.current
      if (Object.keys(counts).length) log("streamed events in the last second", { ...counts })
      eventCounts.current = {}
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  const connected = status === "connected"
  const [wasConnected, setWasConnected] = useState(false)
  if (connected && !wasConnected) setWasConnected(true)

  // connect() with a token only holds on to the stream; the microphone is streamed to Gemini once capture starts.
  // Capture takes over the stream it is given and stops its tracks when it stops, so it gets a clone: muting
  // stops the clone, unmuting streams a fresh one, and the call's own stream stays open for the level meter.
  const capturing = useRef(false)
  useEffect(() => {
    if (!connected || muted || hangingUp || capturing.current) return
    capturing.current = true
    try {
      log("starting microphone capture")
      startAudioCapture(setup.stream.clone())
    } catch (err) {
      log("microphone capture failed", err)
      capturing.current = false
      setError(err instanceof Error ? err.message : "The microphone could not be streamed.")
    }
  }, [connected, muted, hangingUp, startAudioCapture, setup.stream])
  function stopCapture() {
    if (!capturing.current) return
    capturing.current = false
    log("stopping microphone capture and sending audioStreamEnd")
    try {
      stopAudioCapture()
      // Tells Gemini the audio has paused, so it answers what was said instead of waiting for more.
      commitAudio()
    } catch (err) {
      log("could not stop capture; the session is closing", err)
    }
  }

  // The orb follows the speaker's level.
  useEffect(() => {
    const audio = new AudioContext()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 512
    audio.createMediaStreamSource(setup.stream).connect(analyser)
    const levels = new Uint8Array(analyser.fftSize)
    let frame = 0
    const tick = () => {
      analyser.getByteTimeDomainData(levels)
      let sum = 0
      for (const level of levels) sum += ((level - 128) / 128) ** 2
      setVolume(Math.min(1, Math.sqrt(sum / levels.length) * 4))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      void audio.close()
    }
  }, [setup.stream])

  useEffect(() => {
    if (!connected) return
    const startedAt = performance.now()
    const timer = setInterval(() => setSeconds((performance.now() - startedAt) / 1000), 250)
    return () => clearInterval(timer)
  }, [connected])

  // Muting stops sending audio altogether; the session keeps running and unmuting resumes it.
  function toggleMute() {
    const next = !muted
    log(next ? "muted" : "unmuted")
    if (next) stopCapture()
    setMuted(next)
  }

  // The microphone closes whenever the call goes away, whether or not capture ever started. StrictMode unmounts
  // and remounts once on mount, so the release waits a tick and skips a component that came back.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (mounted.current) return
        log("call unmounted, closing the microphone")
        stopStream(setup.stream)
      })
    }
  }, [setup.stream])

  const endedRef = useRef(false)
  function end() {
    if (endedRef.current) return
    endedRef.current = true
    log("ending the call", { status, messages: transcript.length })
    try {
      disconnect()
    } catch {
      // Already detached; unmounting disposes the session.
    }
    stopStream(setup.stream)
    onEnd(transcript)
  }

  // After end_call, the microphone stops at once and the call ends when the goodbye has played: once playback has
  // been idle for a moment, or after a few seconds at most if it never goes quiet.
  const endFromModel = useEffectEvent(() => {
    log("the model ended the call")
    end()
  })
  useEffect(() => {
    if (!hangingUp) return
    const latest = setTimeout(endFromModel, 10_000)
    return () => clearTimeout(latest)
  }, [hangingUp])
  useEffect(() => {
    if (!hangingUp || isPlaying) return
    const quiet = setTimeout(endFromModel, 2000)
    return () => clearTimeout(quiet)
  }, [hangingUp, isPlaying])
  const stopForHangUp = useEffectEvent(() => stopCapture())
  useEffect(() => {
    if (hangingUp) stopForHangUp()
  }, [hangingUp])

  const phase: LivePhase =
    status === "error" || error ? "error" : connected ? "live" : wasConnected ? "ended" : "connecting"
  const state: VoiceOrbState =
    phase === "connecting" ? "connecting" : phase !== "live" ? "idle" : muted ? "muted" : isPlaying ? "speaking" : "listening"
  const label = {
    error: error ?? "Gemini Live disconnected.",
    ended: "The call ended.",
    connecting: "Connecting to Gemini Live…",
    live: hangingUp ? "Hanging up…" : muted ? "Muted" : isPlaying ? "Speaking…" : "Listening…",
  }[phase]

  return (
    <LiveBar
      phase={phase}
      state={state}
      volume={phase !== "live" || muted ? 0 : isPlaying ? 0.6 : volume}
      label={label}
      seconds={wasConnected ? seconds : undefined}
      muted={muted}
      onToggleMute={phase === "live" ? toggleMute : undefined}
      onEnd={end}
    />
  )
}

// A call card, unlike the inline bar of voice input: a live badge, a larger violet orb, level bars and round controls.
type LivePhase = "connecting" | "live" | "ended" | "error"

function LiveBar({
  phase,
  state,
  volume = 0,
  label,
  seconds,
  muted,
  onToggleMute,
  onEnd,
}: {
  phase: LivePhase
  state: VoiceOrbState
  volume?: number
  label: string
  seconds?: number
  muted?: boolean
  onToggleMute?: () => void
  onEnd: () => void
}) {
  const live = phase === "live"
  const error = phase === "error"
  return (
    <div
      className="flex flex-1 items-center gap-4 rounded-xl bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-transparent p-2 pr-1 dark:from-violet-400/15"
      aria-live="polite"
    >
      <span className="relative grid size-14 shrink-0 place-items-center">
        {/* Rings that follow the level, which also show where WebGL (and so the orb) is unavailable. */}
        <span
          className="absolute inset-0 rounded-full border-2 border-violet-500/40 transition-transform duration-75 dark:border-violet-400/40"
          style={{ transform: `scale(${1 + volume * 0.35})` }}
        />
        <span className="absolute inset-1.5 rounded-full bg-violet-500/20 dark:bg-violet-400/20" />
        <VoiceOrb state={error ? "idle" : state} volume={volume} variant="violet" className="relative size-12" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${
              error
                ? "bg-destructive/10 text-destructive"
                : live
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            <span className={`size-1.5 rounded-full ${error ? "bg-destructive" : live ? "animate-pulse bg-red-500" : "bg-muted-foreground"}`} />
            {{ connecting: "Connecting", live: "Live", ended: "Ended", error: "Offline" }[phase]}
          </span>
          <span className="text-xs font-medium text-muted-foreground">Gemini Live</span>
          {seconds != null && <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{formatTime(seconds)}</span>}
        </div>
        <div className="flex items-center gap-2">
          {live && <LevelBars volume={volume} active={!muted} />}
          <span className={`min-w-0 truncate text-sm ${error ? "text-destructive" : "text-foreground"}`} title={label}>
            {label}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onToggleMute && (
          <Button
            type="button"
            variant={muted ? "secondary" : "outline"}
            size="icon"
            className="rounded-full"
            onClick={onToggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
          >
            {muted ? <MicOffIcon /> : <MicIcon />}
          </Button>
        )}
        <Button type="button" variant="destructive" size="icon" className="rounded-full" onClick={onEnd} aria-label={live || phase === "connecting" ? "End voice chat" : "Close"}>
          <PhoneOffIcon />
        </Button>
      </div>
    </div>
  )
}

// Five bars that rise with the level, tallest in the middle.
const BAR_WEIGHTS = [0.5, 0.8, 1, 0.8, 0.5]

function LevelBars({ volume, active }: { volume: number; active: boolean }) {
  return (
    <span className="flex h-4 shrink-0 items-center gap-0.5" aria-hidden>
      {BAR_WEIGHTS.map((weight, index) => (
        <span
          key={index}
          className="w-0.5 rounded-full bg-violet-500 transition-[height] duration-75 dark:bg-violet-400"
          style={{ height: `${Math.max(3, (active ? volume : 0) * weight * 16)}px` }}
        />
      ))}
    </span>
  )
}
