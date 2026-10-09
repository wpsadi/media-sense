import { Button } from "@/components/ui/button"

// Shown for any path the app does not have.
export default function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-medium">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The page you are looking for does not exist or has moved.</p>
      <Button render={<a href="/" />}>Back to Ask AI</Button>
    </main>
  )
}
