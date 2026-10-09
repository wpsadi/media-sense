// The Gemini key lives only in this browser's localStorage. It is never bundled or sent to our server.
const STORAGE_KEY = "gemini-api-key"

export function getGeminiKey(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveGeminiKey(key: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // Storage is blocked, so the key lasts only for this page load.
  }
}

export function clearGeminiKey() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored to remove.
  }
}
