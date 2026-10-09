// Seconds as m:ss, or h:mm:ss from an hour on.
export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = String(total % 60).padStart(2, "0")
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`
}

export function formatRange(start: number, end: number) {
  return `${formatTime(start)}–${formatTime(end)}`
}

// A moment in a file: a range when it has an end, a time when it only has a start.
export function formatMoment(start?: number, end?: number) {
  if (start == null) return undefined
  return end != null ? formatRange(start, end) : formatTime(start)
}

// The user's current date, time and time zone, as one sentence for a model's instructions. Models do not know it.
export function currentDateLine(now = new Date()) {
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `Right now it is ${date}, ${time} in the user's time zone (${zone}).`
}
