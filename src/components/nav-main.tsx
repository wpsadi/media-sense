import { Activity, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { CheckIcon, CpuIcon, UploadIcon } from "lucide-react"
import { ModelDownloadDialog, RadialProgress } from "@/components/model-download"
import { UploadDialog } from "@/components/upload-dialog"
import { useModelDownload } from "@/hooks/use-model-download"

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: React.ReactNode
  }[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const model = useModelDownload()
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()

  function handleModelClick() {
    if (model.status === "idle" || model.status === "error") model.start()
    setDialogOpen(true)
  }

  const modelLabel =
    model.status === "ready"
      ? "Model is downloaded"
      : model.status === "downloading"
        ? model.preparing
          ? "Preparing the model..."
          : `Downloading model ${Math.round(model.progress)}%`
        : model.status === "error"
          ? "Model failed to load, click to retry"
          : "Load the model"

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip="Upload"
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
              onClick={() => setUploadOpen(true)}
            >
              <UploadIcon
              />
              <span>Upload</span>
            </SidebarMenuButton>
            <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    className="size-8 group-data-[collapsible=icon]:opacity-0"
                    variant="outline"
                    onClick={handleModelClick}
                    aria-label={modelLabel}
                  />
                }
              >
                {/* Each icon stays mounted; Activity only toggles which one is shown. */}
                <Activity mode={model.status === "ready" ? "visible" : "hidden"}>
                  <CheckIcon className="text-green-600 dark:text-green-500" />
                </Activity>
                <Activity mode={model.status === "downloading" ? "visible" : "hidden"}>
                  <RadialProgress value={model.preparing ? undefined : model.progress} />
                </Activity>
                <Activity
                  mode={model.status === "idle" || model.status === "error" ? "visible" : "hidden"}
                >
                  <CpuIcon className={model.status === "error" ? "text-destructive" : undefined} />
                </Activity>
              </TooltipTrigger>
              <TooltipContent side="right">{modelLabel}</TooltipContent>
            </Tooltip>
            <ModelDownloadDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              status={model.status}
              progress={model.progress}
              preparing={model.preparing}
              downloadedMb={model.downloadedMb}
              totalMb={model.totalMb}
              bytesPerSecond={model.bytesPerSecond}
              error={model.error}
              onRetry={model.start}
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={item.url !== "#" && pathname === item.url}
                // On phones the sidebar is a sheet; picking an item should close it.
                onClick={() => setOpenMobile(false)}
                render={item.url === "#" ? undefined : <Link to={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
