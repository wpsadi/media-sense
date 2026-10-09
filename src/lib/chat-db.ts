import type { UIMessage } from "ai"

// Saved Ask AI chats live in this browser's IndexedDB. They never leave the device.
const DB_NAME = "ask-ai"
const STORE = "chats"

export type StoredChat = {
  id: string
  title: string
  // True once the AI has written this chat's title, so it is only generated once.
  titled?: boolean
  createdAt: number
  updatedAt: number
  messages: UIMessage[]
}

export type ChatSummary = Omit<StoredChat, "messages">

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Runs one request in its own transaction and resolves with its result.
async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = action(transaction.objectStore(STORE))
    transaction.oncomplete = () => {
      db.close()
      resolve(request.result)
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

// Newest first. Messages are left out so the list stays light.
export async function listChats(): Promise<ChatSummary[]> {
  const chats = await run<StoredChat[]>("readonly", (store) => store.getAll())
  return chats
    .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getChat(id: string): Promise<StoredChat | null> {
  const chat = await run<StoredChat | undefined>("readonly", (store) => store.get(id))
  return chat ?? null
}

export async function saveChat(chat: StoredChat): Promise<void> {
  await run("readwrite", (store) => store.put(chat))
}

export async function deleteChat(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id))
}
