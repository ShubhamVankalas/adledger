"use client";

import {
  BellIcon,
  BotIcon,
  Building2Icon,
  CableIcon,
  CodeIcon,
  FileClockIcon,
  MousePointerClickIcon,
  SlidersHorizontalIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon; show?: boolean };

export function SettingsNav({
  workspaceName,
  organizationName,
  canWorkspace,
  canApi,
  canMembers,
  canAudit,
}: {
  workspaceName: string;
  organizationName: string;
  canWorkspace: boolean;
  canApi: boolean;
  canMembers: boolean;
  canAudit: boolean;
}) {
  const pathname = usePathname();
  const groups: { title: string; subtitle?: string; items: Item[] }[] = [
    { title: "Account", items: [{ href: "/settings/account", label: "Profile & security", icon: UserIcon }] },
    {
      title: "Workspace",
      subtitle: workspaceName,
      items: [
        { href: "/settings/workspace", label: "General", icon: SlidersHorizontalIcon },
        { href: "/settings/workspace/tracking", label: "Tracking & forms", icon: MousePointerClickIcon, show: canWorkspace },
        { href: "/settings/workspace/integrations", label: "Integrations", icon: CableIcon, show: canWorkspace },
        { href: "/settings/workspace/notifications", label: "Notifications", icon: BellIcon, show: canWorkspace },
        { href: "/settings/workspace/import", label: "Import data", icon: UploadIcon, show: canWorkspace },
        { href: "/settings/workspace/ai", label: "AI model", icon: BotIcon, show: canWorkspace },
        { href: "/settings/workspace/api", label: "API & MCP", icon: CodeIcon, show: canApi },
      ],
    },
    {
      title: "Organization",
      subtitle: organizationName,
      items: [
        { href: "/settings/organization", label: "Organization & workspaces", icon: Building2Icon },
        { href: "/settings/organization/members", label: "Members & roles", icon: UsersIcon, show: canMembers },
        { href: "/settings/organization/audit", label: "Audit log", icon: FileClockIcon, show: canAudit },
      ],
    },
  ];
  const active = (href: string) => (href === "/settings/workspace" || href === "/settings/organization" ? pathname === href : pathname.startsWith(href));

  // On phones the nav is a horizontal strip: keep the current page's link in view.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !current || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = current.offsetLeft - el.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
  }, [pathname]);

  return (
    <nav className="min-w-0 lg:sticky lg:top-20 lg:self-start" aria-label="Settings">
      <div ref={strip} className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 lg:mx-0 lg:flex-col lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0">
        {groups.map((g) => (
          <div key={g.title} className="min-w-max lg:min-w-0">
            <div className="px-2 pb-1.5">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</div>
              {g.subtitle ? <div className="truncate text-xs text-muted-foreground">{g.subtitle}</div> : null}
            </div>
            <ul className="flex gap-1 lg:flex-col">
              {g.items
                .filter((i) => i.show !== false)
                .map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={active(i.href) ? "page" : undefined}
                      className={cn(
                        "flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm lg:min-h-0 whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                        active(i.href) && "bg-muted font-medium text-foreground",
                      )}
                    >
                      <i.icon className="size-4 shrink-0" />
                      {i.label}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
