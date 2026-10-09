import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { CommandMenu } from '@/components/command-menu'
import { DeleteUploadDialog } from '@/components/delete-upload-dialog'
import { EmbeddingSync } from '@/components/embedding-sync'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UploadDetailsDialog } from '@/components/upload-details-dialog'
import AskAIPage from '@/pages/ask-ai'
import GalleryPage from '@/pages/gallery'

function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <Routes>
          <Route path="/" element={<AskAIPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
        </Routes>
        <CommandMenu />
        <DeleteUploadDialog />
        <UploadDetailsDialog />
        <EmbeddingSync />
      </TooltipProvider>
    </BrowserRouter>
  )
}

export default App
