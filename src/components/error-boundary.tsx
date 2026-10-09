import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

type ErrorBoundaryState = { error: Error | null }

// Catches errors thrown while rendering, so a crash shows an error page instead of a blank screen.
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">Error</p>
        <h1 className="text-2xl font-medium">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page hit an unexpected error. Reload to try again, or go back to Ask AI.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button render={<a href="/" />}>Back to Ask AI</Button>
        </div>
      </main>
    )
  }
}
