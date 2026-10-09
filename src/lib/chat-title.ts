import { generateText, type LanguageModel } from "ai"

// Asks the model for a short title from the first message. Used once per chat.
// Shortens a title to max characters, breaking at a word and ending with an ellipsis.
export function clampTitle(text: string, max = 40): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export async function generateChatTitle(model: LanguageModel, firstMessage: string): Promise<string> {
  const { text } = await generateText({
    model,
    instructions: "Write a short title of 3 to 6 words for a chat that starts with the user's message. Reply with the title only, no quotes or punctuation at the end.",
    prompt: firstMessage,
    maxOutputTokens: 24,
  })
  const title = text.trim().replace(/^["']|["']$/g, "")
  return clampTitle(title || firstMessage)
}
