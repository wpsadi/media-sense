import * as React from "react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { SparklesIcon, ImagesIcon, VideoIcon } from "lucide-react"

const data = {
  navMain: [
    {
      title: "Ask AI",
      url: "/",
      icon: (
        <SparklesIcon
        />
      ),
    },
    {
      title: "Gallery",
      url: "/gallery",
      icon: (
        <ImagesIcon
        />
      ),
    },
    
  ],
  navClouds: [
    // {
    //   title: "Capture",
    //   icon: (
    //     <CameraIcon
    //     />
    //   ),
    //   isActive: true,
    //   url: "#",
    //   items: [
    //     {
    //       title: "Active Proposals",
    //       url: "#",
    //     },
    //     {
    //       title: "Archived",
    //       url: "#",
    //     },
    //   ],
    // },
    // {
    //   title: "Proposal",
    //   icon: (
    //     <FileTextIcon
    //     />
    //   ),
    //   url: "#",
    //   items: [
    //     {
    //       title: "Active Proposals",
    //       url: "#",
    //     },
    //     {
    //       title: "Archived",
    //       url: "#",
    //     },
    //   ],
    // },
    // {
    //   title: "Prompts",
    //   icon: (
    //     <FileTextIcon
    //     />
    //   ),
    //   url: "#",
    //   items: [
    //     {
    //       title: "Active Proposals",
    //       url: "#",
    //     },
    //     {
    //       title: "Archived",
    //       url: "#",
    //     },
    //   ],
    // },
  ],
  navSecondary: [
    // {
    //   title: "Settings",
    //   url: "#",
    //   icon: (
    //     <Settings2Icon
    //     />
    //   ),
    // },
    // {
    //   title: "Get Help",
    //   url: "#",
    //   icon: (
    //     <CircleHelpIcon
    //     />
    //   ),
    // },
    // {
    //   title: "Search",
    //   url: "#",
    //   icon: (
    //     <SearchIcon
    //     />
    //   ),
    // },
  ],
  documents: [
    // {
    //   name: "Data Library",
    //   url: "#",
    //   icon: (
    //     <DatabaseIcon
    //     />
    //   ),
    // },
    // {
    //   name: "Reports",
    //   url: "#",
    //   icon: (
    //     <FileChartColumnIcon
    //     />
    //   ),
    // },
    // {
    //   name: "Word Assistant",
    //   url: "#",
    //   icon: (
    //     <FileIcon
    //     />
    //   ),
    // },
  ],
}
export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="#" />}
            >
              <VideoIcon className="size-5!" />
              <span className="text-base font-semibold">VideoSence</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  )
}
