import { PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ChatSummary } from "@/lib/chat-db"

type ChatHistoryProps = {
  chats: ChatSummary[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

// Saved chats, newest first. The active one is highlighted.
export function ChatHistory({ chats, activeId, onSelect, onNew, onDelete }: ChatHistoryProps) {
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 p-3">
      <Button variant="outline" onClick={onNew} className="w-full justify-start gap-2">
        <PlusIcon />
        New chat
      </Button>

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label="Saved chats">
        {chats.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No saved chats yet.</p>}
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex items-center gap-1 rounded-md pr-1 ${
              chat.id === activeId ? "bg-muted" : "hover:bg-muted/60"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(chat.id)}
              className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
              title={chat.title}
            >
              {/* Long titles end with an ellipsis; the full title shows on hover. */}
              <span className="block truncate">{chat.title}</span>
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onDelete(chat.id)}
              aria-label={`Delete ${chat.title}`}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
      </nav>
    </aside>
  )
}
