import { useEffect, useState } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import type { SpeechModel, UIMessage } from "ai"
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FileIcon,
  LoaderIcon,
  SearchIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react"

import { MediaPreview, MediaView, type ShownMedia } from "@/components/chat/media-results"
import { ReadAloud } from "@/components/assistant-ui/elements/read-aloud"
import { Button } from "@/components/ui/button"
import { formatMoment, formatTime } from "@/lib/format-time"
import { useReadAloudStore } from "@/stores/read-aloud-store"
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@/components/ui/preview-card"

type Part = UIMessage["parts"][number]

// Markdown from the model. Styled inline because the app has no typography plugin.
const markdownComponents: Components = {
  p: ({ children }) => <p className="leading-7">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h1 className="mt-2 text-xl font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-2 text-lg font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 font-semibold">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-6">{children}</ol>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">{children}</code>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
}

function isToolPart(part: Part) {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

function toolName(part: Part) {
  const info = part as { type: string; toolName?: string }
  return info.toolName ?? info.type.replace(/^tool-/, "")
}

// The file the model viewed with view_media, shown in the chat.
function shownMedia(part: Part): ShownMedia | null {
  const output = (part as { output?: Partial<ShownMedia> }).output
  return output?.id && output.name && output.kind ? (output as ShownMedia) : null
}

// The files the model chose to show the user with show_media.
function shownFiles(part: Part): ShownMedia[] {
  return (part as { output?: { files?: ShownMedia[] } }).output?.files ?? []
}

// One short line per tool step: what was searched for, or which file was viewed or shown. No scores or results.
function stepLabel(part: Part): { text: string; detail?: string } {
  const info = part as { input?: { query?: string } }
  const name = toolName(part)
  if (name === "search_media") return { text: "Searched media", detail: info.input?.query }
  if (name === "web_search") {
    const count = (part as { output?: { sources?: unknown[] } }).output?.sources?.length
    const sources = count ? ` · ${count} ${count === 1 ? "source" : "sources"}` : ""
    return { text: "Searched the web", detail: info.input?.query ? `${info.input.query}${sources}` : undefined }
  }
  if (name === "view_media") {
    const media = shownMedia(part)
    const moment = formatMoment(media?.start, media?.end)
    return { text: "Viewed file", detail: media && moment ? `${media.name} · ${moment}` : media?.name }
  }
  if (name === "show_media") {
    const count = shownFiles(part).length
    return { text: "Showed", detail: count ? `${count} ${count === 1 ? "file" : "files"}` : undefined }
  }
  return { text: name }
}

function stepStatus(part: Part) {
  const state = (part as { state?: string }).state
  if (state === "output-available") return <CheckIcon className="size-3.5" />
  if (state === "output-error") return <CircleAlertIcon className="size-3.5 text-destructive" />
  return <LoaderIcon className="size-3.5 animate-spin" />
}

// The model's thinking and its tool steps in one block. Open while the reply streams, closed once it finishes.
function ChainOfThought({ thoughts, steps, streaming }: { thoughts: string; steps: Part[]; streaming: boolean }) {
  const [open, setOpen] = useState(streaming)
  useEffect(() => setOpen(streaming), [streaming])

  const count = steps.length
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground select-none">
        <BrainIcon className="size-4" />
        {streaming ? "Thinking…" : `Chain of thought${count ? ` · ${count} ${count === 1 ? "step" : "steps"}` : ""}`}
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
      </summary>

      <div className="mt-3 flex flex-col gap-3 border-l-2 pl-4 text-muted-foreground">
        {thoughts && <p className="whitespace-pre-wrap">{thoughts}</p>}

        {count > 0 && (
          <ol className="flex flex-col gap-2">
            {steps.map((part, index) => {
              const label = stepLabel(part)
              const media = toolName(part) === "view_media" ? shownMedia(part) : null
              return (
                <li key={index} className="flex items-center gap-2">
                  {label.detail ? <SearchIcon className="size-3.5 shrink-0" /> : <FileIcon className="size-3.5 shrink-0" />}
                  {media ? (
                    // A viewed file: hovering its step shows a preview of the file.
                    <PreviewCard>
                      <PreviewCardTrigger className="flex min-w-0 items-center gap-2 underline decoration-dotted underline-offset-4">
                        <span className="font-medium">{label.text}</span>
                        <span className="min-w-0 truncate">{label.detail}</span>
                      </PreviewCardTrigger>
                      <PreviewCardContent>
                        <MediaPreview media={media} />
                      </PreviewCardContent>
                    </PreviewCard>
                  ) : (
                    <>
                      <span className="font-medium">{label.text}</span>
                      {label.detail && <span className="min-w-0 truncate">{label.detail}</span>}
                    </>
                  )}
                  <span className="ml-auto shrink-0">{stepStatus(part)}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </details>
  )
}

// A finished reply's read-aloud button. While this reply is read, it becomes the player, with the spoken word lit.
function ReadAloudControl({ messageId, text, speechModel }: { messageId: string; text: string; speechModel: SpeechModel }) {
  const active = useReadAloudStore((state) => state.messageId === messageId)
  const words = useReadAloudStore((state) => state.words)
  const spokenIndex = useReadAloudStore((state) => state.spokenIndex)
  const playing = useReadAloudStore((state) => state.playing)
  const loading = useReadAloudStore((state) => state.loading)
  const rate = useReadAloudStore((state) => state.rate)
  const elapsed = useReadAloudStore((state) => state.elapsed)
  const duration = useReadAloudStore((state) => state.duration)
  const error = useReadAloudStore((state) => state.error)
  const { start, toggle, cycleRate, stop } = useReadAloudStore.getState()

  if (!active) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className="-ml-1.5 text-muted-foreground"
        onClick={() => start(messageId, text, speechModel)}
        aria-label="Read aloud"
        title="Read aloud"
      >
        <Volume2Icon />
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-1">
        <ReadAloud
          words={words}
          spokenIndex={spokenIndex}
          playing={playing}
          rate={rate}
          elapsed={formatTime(elapsed)}
          duration={formatTime(duration)}
          onToggle={toggle}
          onRateChange={cycleRate}
          className="max-w-xl"
        />
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={stop} aria-label="Stop reading">
          <XIcon />
        </Button>
      </div>
      {loading && playing && <span className="shimmer text-xs text-muted-foreground">Generating speech…</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

export function AssistantMessage({
  message,
  streaming,
  speechModel,
}: {
  message: UIMessage
  streaming: boolean
  speechModel: SpeechModel
}) {
  const reasoningParts = message.parts.filter((part) => part.type === "reasoning")
  const thoughts = reasoningParts.map((part) => part.text).join("\n\n")
  const steps = message.parts.filter((part) => isToolPart(part))
  const sources = message.parts.filter((part) => part.type === "source-url")
  const replyText = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim()
  const hasChain = reasoningParts.length > 0 || steps.length > 0

  return (
    <div className="flex flex-col gap-3">
      {hasChain && <ChainOfThought thoughts={thoughts} steps={steps} streaming={streaming} />}

      {/* Parts render in the order the model produced them, so files it chose to show sit between the text around them.
          Files it only viewed stay in the chain of thought, with a hover preview. */}
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {part.text}
            </ReactMarkdown>
          )
        }
        if (isToolPart(part) && toolName(part) === "show_media") {
          return shownFiles(part).map((media) => <MediaView key={`${index}-${media.id}`} media={media} />)
        }
        return null
      })}

      {!streaming && replyText && <ReadAloudControl messageId={message.id} text={replyText} speechModel={speechModel} />}

      {sources.length > 0 && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Sources</span>
          {sources.map((part, index) =>
            part.type === "source-url" ? (
              <a
                key={index}
                href={part.url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-muted-foreground underline underline-offset-4"
              >
                {part.title ?? part.url}
              </a>
            ) : null,
          )}
        </div>
      )}
    </div>
  )
}
