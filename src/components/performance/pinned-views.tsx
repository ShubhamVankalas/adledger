"use client";

import { BookmarkIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { SavedView } from "@/lib/view-params";

/**
 * The sidebar's "Views" group: saved views pinned by the user or shared and pinned for the
 * workspace (at most eight, see listPinnedViews). Renders nothing when there are none. The active
 * item is the view whose id is in the current URL.
 */
export function PinnedViews({ views }: { views: SavedView[] }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  if (!views.length) return null;
  const activeId = sp.get("view");
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Views</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {views.map((v) => (
            <SidebarMenuItem key={v.id}>
              <SidebarMenuButton
                isActive={activeId === v.id && pathname === v.href.split("?")[0]}
                tooltip={v.name}
                render={<Link href={v.href} />}
              >
                <BookmarkIcon strokeWidth={1.75} />
                <span className="flex-1 truncate">{v.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
