import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { useChat } from "@ai-sdk/react"
import { createGoogle } from "@ai-sdk/google"
import { DirectChatTransport, Experimental_Agent as Agent, stepCountIs, type ChatTransport, type UIMessage } from "ai"
import { ArrowUpIcon, AudioLinesIcon, HistoryIcon, KeyRoundIcon, SparklesIcon } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { AssistantMessage } from "@/components/chat/assistant-message"
import { ChatHistory } from "@/components/chat/chat-history"
import { LiveVoice } from "@/components/chat/live-voice"
import { VoiceInput } from "@/components/chat/voice-input"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { deleteChat, getChat, listChats, saveChat, type ChatSummary, type StoredChat } from "@/lib/chat-db"
import { clampTitle, generateChatTitle } from "@/lib/chat-title"
import { currentDateLine } from "@/lib/format-time"
import { searchMediaTool, showMediaTool, viewMediaTool } from "@/lib/media-tools"
import { createWebSearchTool } from "@/lib/web-search"
import { clearGeminiKey, getGeminiKey, saveGeminiKey } from "@/lib/gemini-key"
import { TTS_MODEL_ID, useReadAloudStore } from "@/stores/read-aloud-store"

const MODEL_ID = "gemini-3.5-flash-lite"
const INSTRUCTIONS = [
  "You are Ask AI, an assistant inside a video and media workspace. Answer concisely.",
  "You can search the user's saved media with search_media, which returns the top 5 matches by meaning. Use it when a question is about their files.",
  "Search results only name the files. To see or hear a file, call view_media with its id; you then receive its contents. The user does not see files you view.",
  "For videos and audio, search results list moments: the stretches that matched best, in seconds. When the user asks where or when something happens, call view_media with that moment's start and end. You then see frames at one per second, each labelled with its time, and hear the soundtrack. Answer with the time, such as 1:24.",
  "To show files to the user, call show_media with only the files that answer their question, not every file you viewed. They appear where you call it in your reply. For a video or audio file, pass start to open it at the moment you describe.",
  "Describe only what you actually received from view_media. Never claim to see a file you have not viewed. Search again with different wording when the matches look weak.",
  "Your own knowledge is out of date and you cannot tell how far, so search the web yourself, without being asked, whenever an answer depends on facts about the world: news and current events, anything recent or upcoming, people, companies, products, prices, releases, versions, scores, weather, schedules, laws, statistics, or any fact you are not certain of. When in doubt, search; never answer such questions from memory alone, and never tell the user to look it up themselves. Search again with different wording if the first answer is thin. Skip it only for small talk, the user's own files, and timeless knowledge such as maths or definitions.",
  "Call web_search with one clear, self-contained question; for a question with several parts, make several calls. Answer from what it returns, and cite the pages you used as markdown links.",
].join(" ")

function newChatId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export default function AskAIPage() {
  const [apiKey, setApiKey] = useState<string | null>(() => getGeminiKey())
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeId, setActiveId] = useState(newChatId)
  const [loaded, setLoaded] = useState<StoredChat | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  async function refreshChats() {
    try {
      setChats(await listChats())
    } catch (error) {
      console.error("Could not load saved chats", error)
    }
  }

  useEffect(() => {
    if (apiKey) void refreshChats()
  }, [apiKey])

  async function selectChat(id: string) {
    try {
      setLoaded(await getChat(id))
      setActiveId(id)
    } catch (error) {
      console.error("Could not open chat", error)
    }
    setHistoryOpen(false)
  }

  function startNewChat() {
    setLoaded(null)
    setActiveId(newChatId())
    setHistoryOpen(false)
  }

  async function removeChat(id: string) {
    try {
      await deleteChat(id)
    } catch (error) {
      console.error("Could not delete chat", error)
      return
    }
    if (id === activeId) startNewChat()
    await refreshChats()
  }

  function forgetKey() {
    clearGeminiKey()
    setApiKey(null)
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader
          title="Ask AI"
          actions={
            apiKey ? (
              <Button variant="ghost" size="icon" onClick={() => setHistoryOpen(true)} aria-label="Saved chats">
                <HistoryIcon />
              </Button>
            ) : null
          }
        />
        <div className="relative flex h-[calc(100svh-var(--header-height))]">
          {apiKey ? (
            <>
              {/* Desktop: the list sits beside the chat. */}
              <div className="hidden w-64 shrink-0 overflow-hidden border-r md:flex">
                <ChatHistory
                  chats={chats}
                  activeId={activeId}
                  onSelect={selectChat}
                  onNew={startNewChat}
                  onDelete={removeChat}
                />
              </div>

              {/* The header history button opens this sheet, mainly for phones. */}
              <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
                <SheetContent side="left" className="w-72 p-0">
                  <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle>Saved chats</SheetTitle>
                  </SheetHeader>
                  <ChatHistory
                    chats={chats}
                    activeId={activeId}
                    onSelect={selectChat}
                    onNew={startNewChat}
                    onDelete={removeChat}
                  />
                </SheetContent>
              </Sheet>

              <ChatView
                key={activeId}
                chatId={activeId}
                initial={loaded}
                apiKey={apiKey}
                onSaved={refreshChats}
                onForgetKey={forgetKey}
              />
            </>
          ) : (
            <KeyGate onSave={setApiKey} />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

// Shown until a key is saved in this browser, so chat cannot start without one.
function KeyGate({ onSave }: { onSave: (key: string) => void }) {
  const [draft, setDraft] = useState("")

  function submit(event: FormEvent) {
    event.preventDefault()
    const key = draft.trim()
    if (!key) return
    saveGeminiKey(key)
    onSave(key)
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <KeyRoundIcon className="size-8 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-medium">Add your Gemini API key</h2>
          <p className="text-sm text-muted-foreground">
            It is stored only in this browser. Get one from Google AI Studio.
          </p>
        </div>
        <Input
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="GEMINI_API_KEY"
          aria-label="Gemini API key"
        />
        <Button type="submit" disabled={draft.trim().length === 0} className="w-full">
          Start chat
        </Button>
      </form>
    </div>
  )
}

function ChatView({
  chatId,
  initial,
  apiKey,
  onSaved,
  onForgetKey,
}: {
  chatId: string
  initial: StoredChat | null
  apiKey: string
  onSaved: () => void
  onForgetKey: () => void
}) {
  const google = useMemo(() => createGoogle({ apiKey }), [apiKey])
  // Replies are read aloud with Gemini TTS, on the same key.
  const speechModel = useMemo(() => google.speech(TTS_MODEL_ID), [google])
  const transport = useMemo(() => {
    return new DirectChatTransport({
      agent: new Agent({
        model: google(MODEL_ID),
        // The date is set when the chat opens.
        instructions: `${INSTRUCTIONS} ${currentDateLine()}`,
        tools: {
          search_media: searchMediaTool,
          view_media: viewMediaTool,
          show_media: showMediaTool,
          web_search: createWebSearchTool(google),
        },
        // The model may search, read results and search again, up to 8 steps per reply.
        stopWhen: stepCountIs(8),
        // Ask Gemini to stream its thoughts so the chain of thought can be shown.
        providerOptions: { google: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } } },
      }),
    })
  }, [apiKey, google])

  // Saved messages use the default UIMessage type, so the chat is typed to match.
  const { messages, setMessages, sendMessage, status, error } = useChat<UIMessage>({
    id: chatId,
    messages: initial?.messages ?? [],
    transport: transport as ChatTransport<UIMessage>,
  })
  const [input, setInput] = useState("")
  const [voiceActive, setVoiceActive] = useState(false)
  // A Gemini Live call. Its transcript shows below the chat as it happens, and joins the chat when the call ends.
  const [live, setLive] = useState(false)
  const [liveMessages, setLiveMessages] = useState<UIMessage[]>([])
  const busy = status === "submitted" || status === "streaming"

  // A reply read aloud stops when the chat changes.
  const stopReading = useReadAloudStore((state) => state.stop)
  useEffect(() => stopReading, [stopReading])

  // Saves once per finished exchange, so a reload keeps the conversation.
  const savedCount = useRef(initial?.messages.length ?? 0)
  const titled = useRef(initial?.titled ?? false)
  useEffect(() => {
    if (status !== "ready" || messages.length === 0 || messages.length === savedCount.current) return
    savedCount.current = messages.length

    const now = Date.now()
    const firstText = messages[0].parts.find((part) => part.type === "text")
    const firstMessage = firstText?.type === "text" ? firstText.text : "New chat"
    void (async () => {
      // The AI title is written once, after the first exchange. Later saves keep it.
      let title = initial?.title ?? clampTitle(firstMessage)
      if (!titled.current) {
        titled.current = true
        title = await generateChatTitle(google(MODEL_ID), firstMessage).catch(() => clampTitle(firstMessage))
      }
      await saveChat({
        id: chatId,
        title,
        titled: titled.current,
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
        messages,
      })
      onSaved()
    })().catch((err) => console.error("Could not save chat", err))
  }, [status, messages, chatId, initial, onSaved, google])

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput("")
    void sendMessage({ text })
  }

  function startLive() {
    stopReading()
    setLiveMessages([])
    setLive(true)
  }

  const endLive = useCallback(
    (transcript: UIMessage[]) => {
      setLive(false)
      setLiveMessages([])
      if (transcript.length) setMessages((current) => [...current, ...transcript])
    },
    [setMessages],
  )

  // Enter sends, Shift+Enter adds a line.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-40 lg:px-6">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-4">
          {messages.length === 0 && liveMessages.length === 0 && (
            <div className="m-auto flex flex-col items-center gap-2 text-center">
              <SparklesIcon className="size-8 text-muted-foreground" />
              <h2 className="text-xl font-medium">Ask AI</h2>
              <p className="text-sm text-muted-foreground">Ask anything about your media or the workspace.</p>
            </div>
          )}

          {[...messages, ...liveMessages].map((message, index) =>
            message.role === "user" ? (
              <div key={message.id} className="ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-2 whitespace-pre-wrap">
                {message.parts.map((part, partIndex) => (part.type === "text" ? <span key={partIndex}>{part.text}</span> : null))}
              </div>
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                streaming={(busy && index === messages.length - 1) || index >= messages.length}
                speechModel={speechModel}
              />
            ),
          )}

          {status === "submitted" && <p className="text-sm text-muted-foreground">Thinking…</p>}
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          <button type="button" onClick={onForgetKey} className="self-center text-xs text-muted-foreground underline">
            Remove saved API key
          </button>
        </div>
      </div>

      <form onSubmit={submit} className="absolute inset-x-0 bottom-6 px-4">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border bg-background p-2 shadow-lg">
          {live && <LiveVoice google={google} viewModel={google(MODEL_ID)} history={messages} onMessages={setLiveMessages} onEnd={endLive} />}
          {/* While voice input records, the orb takes the text box's place. */}
          {!live && !voiceActive && (
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask AI anything..."
              rows={1}
              className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              aria-label="Ask AI"
            />
          )}
          {!live && (
            <VoiceInput
              model={google(MODEL_ID)}
              onActiveChange={setVoiceActive}
              onTranscript={(text) => setInput((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text))}
            />
          )}
          {/* With nothing typed, the send button starts a Gemini Live voice chat instead. */}
          {!live && !voiceActive &&
            (input.trim() || busy ? (
              <Button type="submit" size="icon" disabled={busy || input.trim().length === 0} aria-label="Send">
                <ArrowUpIcon />
              </Button>
            ) : (
              <Button type="button" size="icon" onClick={startLive} aria-label="Start voice chat" title="Voice chat with Gemini Live">
                <AudioLinesIcon />
              </Button>
            ))}
        </div>
      </form>
    </div>
  )
}
