import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useCommandMenuStore } from "@/stores/command-menu-store"
import { SearchIcon } from "lucide-react"

export function SiteHeader({ title = "Ask AI", actions }: { title?: string; actions?: React.ReactNode }) {
  const setOpen = useCommandMenuStore((s) => s.setOpen)

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="text-base font-medium">{title}</h1>

        <div className="ml-auto flex items-center gap-1">
          {actions}
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            aria-label="Search files and run commands"
            className="h-8 w-56 justify-start gap-2 bg-background/50 font-normal text-muted-foreground"
          >
            <SearchIcon />
            <span className="flex-1 truncate text-left">Search files and commands...</span>
            <kbd className="rounded border px-1 text-xs">Ctrl K</kbd>
          </Button>
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
