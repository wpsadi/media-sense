import { create } from "zustand"

type CommandMenuState = {
  open: boolean
  setOpen: (open: boolean) => void
}

// Shared so the header search and the keyboard shortcut open the same menu.
export const useCommandMenuStore = create<CommandMenuState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
