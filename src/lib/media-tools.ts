import { generateText, jsonSchema, tool, type LanguageModel } from "ai"

import { searchMedia } from "@/lib/semantic-search"
import { formatRange, formatTime } from "@/lib/format-time"
import { modelPartsFor, type ModelPart } from "@/lib/media-frames"
import { getUploadBlob, type UploadKind } from "@/lib/upload-cache"
import { useEmbeddingModelStore } from "@/stores/embedding-model-store"
import { useGalleryStore } from "@/stores/gallery-store"

// A stretch of a video or audio file that matched the query.
type MomentHit = {
  // Seconds from the start of the file, to pass to view_media.
  start: number
  end: number
  // The same stretch as m:ss, for the reply.
  at: string
  // "frames" matched what is seen, "audio" what is heard.
  matched: "frames" | "audio"
  score: number
}

export type MediaHit = {
  id: string
  name: string
  kind: UploadKind
  // Cosine similarity between the query and the file's best match, from 0 to 1.
  score: number
  // Video and audio only: the best-matching stretches, best first.
  moments?: MomentHit[]
}

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places

// Every search returns this many candidates, best first.
const TOP_K = 5

// Runs in the browser. Returns candidates only; the model calls view_media to look at one.
export const searchMediaTool = tool({
  description:
    "Search the user's saved images, videos and audio by meaning. Returns the top 5 most similar files with scores. Videos and audio also list moments: the stretches that matched best, in seconds, and whether they matched what is seen (frames) or heard (audio). Search again with different wording if the matches look weak. To look at a file, or at one moment of it, call view_media with its id and the moment's start and end.",
  inputSchema: jsonSchema<{ query: string }>({
    type: "object",
    properties: {
      query: { type: "string", description: "What to look for, in plain words." },
    },
    required: ["query"],
  }),
  execute: async ({ query }) => {
    const text = query.trim()
    if (!text) return { error: "The query is empty." }

    if (useEmbeddingModelStore.getState().status !== "ready") {
      return { error: "The embedding model is not loaded. Ask the user to load it from the sidebar." }
    }

    const gallery = useGalleryStore.getState()
    if (!gallery.loaded) await gallery.refresh()
    const byId = new Map(useGalleryStore.getState().uploads.map((upload) => [upload.id, upload]))

    const ranked = await searchMedia(text, TOP_K)

    const results: MediaHit[] = ranked.flatMap(({ uploadId, score, moments }) => {
      const upload = byId.get(uploadId)
      if (!upload) return []
      const hit: MediaHit = { id: upload.id, name: upload.name, kind: upload.kind, score: round(score) }
      if (moments.length > 0) {
        hit.moments = moments.map((moment) => ({
          start: round(moment.start, 1),
          end: round(moment.end, 1),
          at: formatRange(moment.start, moment.end),
          matched: moment.source,
          score: round(moment.score),
        }))
      }
      return [hit]
    })

    if (results.length === 0) return { query: text, results, note: "No embedded media matches. Upload or embed files first." }
    return { query: text, results }
  },
})

// The model's view of a file, prepared in execute and handed over in toModelOutput.
// Keyed by tool call id, so the large payload never enters the saved chat.
const pendingViews = new Map<string, ModelPart[]>()

// Runs in the browser. Gives the model a file's contents to look at or listen to. The user is not shown it.
export const viewMediaTool = tool({
  description:
    "Look at one saved file yourself. You receive its contents: an image; frames from a video at one per second, each labelled with its time, plus its soundtrack; or an audio clip. The user does not see it; call show_media to show them a file. Use the id from a search_media result. For a video or audio file, pass start and end in seconds to look at one stretch, such as a moment from search_media; without them you get the whole file, and long videos are sampled more sparsely. Call this before you say what a file shows or contains.",
  inputSchema: jsonSchema<{ id: string; start?: number; end?: number }>({
    type: "object",
    properties: {
      id: { type: "string", description: "The id of the file, from a search_media result." },
      start: { type: "number", description: "Video or audio only: where to start, in seconds from the start of the file." },
      end: { type: "number", description: "Video or audio only: where to stop, in seconds from the start of the file." },
    },
    required: ["id"],
  }),
  execute: async ({ id, start, end }, { toolCallId }) => {
    const gallery = useGalleryStore.getState()
    if (!gallery.loaded) await gallery.refresh()
    const upload = useGalleryStore.getState().uploads.find((item) => item.id === id)
    if (!upload) throw new Error("No saved file has that id. Search for it with search_media first.")

    const blob = await getUploadBlob(upload.id)
    if (!blob) throw new Error("The saved copy of this file could not be read.")

    const range = upload.kind !== "image" && (start != null || end != null) ? { start, end } : undefined
    pendingViews.set(toolCallId, await modelPartsFor(blob, upload.kind, upload.type, range))
    return { id: upload.id, name: upload.name, kind: upload.kind, ...range }
  },
  toModelOutput: ({ toolCallId, output }) => {
    const parts = pendingViews.get(toolCallId)
    pendingViews.delete(toolCallId)
    if (!parts) return { type: "text", value: "The file could not be prepared." }
    return {
      type: "content",
      value: [{ type: "text", text: `Contents of ${output.name} (${output.kind}).` }, ...parts],
    }
  },
})

// Runs in the browser. The model picks which files the user sees; they appear in the reply where it is called.
export const showMediaTool = tool({
  description:
    "Show saved files to the user in the chat, at this point in your reply. Show only the files that answer their question, usually ones you have looked at with view_media. Use ids from search_media results. For a video or audio file, pass start to open it at the moment you are talking about.",
  inputSchema: jsonSchema<{ files: { id: string; start?: number }[] }>({
    type: "object",
    properties: {
      files: {
        type: "array",
        description: "The files to show, in order.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The id of the file." },
            start: { type: "number", description: "Video or audio only: the moment to open it at, in seconds." },
          },
          required: ["id"],
        },
      },
    },
    required: ["files"],
  }),
  execute: async ({ files: requested }) => {
    const gallery = useGalleryStore.getState()
    if (!gallery.loaded) await gallery.refresh()
    const byId = new Map(useGalleryStore.getState().uploads.map((upload) => [upload.id, upload]))

    const files = requested.flatMap(({ id, start }) => {
      const upload = byId.get(id)
      if (!upload) return []
      const at = upload.kind !== "image" && start != null && start > 0 ? { start } : {}
      return [{ id: upload.id, name: upload.name, kind: upload.kind, ...at }]
    })
    const missing = requested.map(({ id }) => id).filter((id) => !byId.has(id))
    if (files.length === 0) throw new Error("None of these ids match a saved file. Search for them with search_media first.")
    return missing.length ? { files, missing } : { files }
  },
})

// Gemini Live takes tool results as plain JSON, so it cannot receive a file's frames. Its view_media hands the
// file to a regular Gemini model with the question, and returns that model's description as text.
export function createLiveViewMediaTool(model: LanguageModel) {
  return tool({
    description:
      "Look at one saved file. Another model watches and listens to it and answers your question in detail: an image; frames from a video at one per second, plus its soundtrack; or an audio clip. Use the id from a search_media result. For a video or audio file, pass start and end in seconds to look at one stretch, such as a moment from search_media. Call this before you say what a file shows or contains. It takes a few seconds.",
    inputSchema: jsonSchema<{ id: string; question: string; start?: number; end?: number }>({
      type: "object",
      properties: {
        id: { type: "string", description: "The id of the file, from a search_media result." },
        question: { type: "string", description: "What you want to know about the file, in the user's words." },
        start: { type: "number", description: "Video or audio only: where to start, in seconds from the start of the file." },
        end: { type: "number", description: "Video or audio only: where to stop, in seconds from the start of the file." },
      },
      required: ["id", "question"],
    }),
    execute: async ({ id, question, start, end }) => {
      const gallery = useGalleryStore.getState()
      if (!gallery.loaded) await gallery.refresh()
      const upload = useGalleryStore.getState().uploads.find((item) => item.id === id)
      if (!upload) throw new Error("No saved file has that id. Search for it with search_media first.")

      const blob = await getUploadBlob(upload.id)
      if (!blob) throw new Error("The saved copy of this file could not be read.")

      const range = upload.kind !== "image" && (start != null || end != null) ? { start, end } : undefined
      const parts = await modelPartsFor(blob, upload.kind, upload.type, range)
      const { text } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `This is ${upload.name}, a saved ${upload.kind} file${range ? (range.end != null ? `, from ${formatRange(range.start ?? 0, range.end)}` : `, from ${formatTime(range.start ?? 0)} on`) : ""}. Another assistant is talking with the user by voice and cannot see or hear it. Answer their question about it: "${question}". Describe what is seen and heard that bears on it, with times for video and audio. Be concrete and factual, in plain sentences, under 150 words.`,
              },
              ...parts,
            ],
          },
        ],
      })
      return { id: upload.id, name: upload.name, kind: upload.kind, ...range, description: text.trim() }
    },
  })
}
