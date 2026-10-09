import type { GoogleGenerativeAIProvider } from "@ai-sdk/google"
import { generateText, jsonSchema, tool } from "ai"

import { currentDateLine } from "@/lib/format-time"

// Web search runs in its own small model with Google Search grounding. The agents call it as a tool and get back an
// answer with its sources, so grounding never mixes with their own tools.
const WEB_SEARCH_MODEL_ID = "gemini-3.5-flash-lite"
const WEB_SEARCH_PROMPT =
  "Search the web and answer the question below with current, factual information. Be concise: the key facts in plain sentences, under 200 words, with dates where they matter. If the results do not answer it, say so."

export type WebSource = { title?: string; url: string }

export function createWebSearchTool(google: GoogleGenerativeAIProvider) {
  return tool({
    description:
      "Search the web with Google. Use it on your own initiative for any question about the world rather than the user's saved media: news, recent events, people, companies, products, prices, releases, scores, weather, facts and figures, how-tos, or anything you are not sure is still true. Your training data is out of date, so prefer searching over answering from memory. Returns an answer and the pages it came from. Ask one clear, self-contained question.",
    inputSchema: jsonSchema<{ query: string }>({
      type: "object",
      properties: {
        query: { type: "string", description: "The question to look up, self-contained, in plain words." },
      },
      required: ["query"],
    }),
    execute: async ({ query }) => {
      const { text, sources } = await generateText({
        model: google(WEB_SEARCH_MODEL_ID),
        tools: { google_search: google.tools.googleSearch({}) },
        prompt: `${WEB_SEARCH_PROMPT} ${currentDateLine()}\n\nQuestion: ${query}`,
      })
      const seen = new Set<string>()
      const pages: WebSource[] = []
      for (const source of sources) {
        if (source.sourceType !== "url" || seen.has(source.url)) continue
        seen.add(source.url)
        pages.push({ title: source.title, url: source.url })
      }
      return { query, answer: text.trim(), sources: pages.slice(0, 8) }
    },
  })
}
