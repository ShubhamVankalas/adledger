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

  return (
    <nav className="md:sticky md:top-20 md:self-start" aria-label="Settings">
      <div className="flex gap-4 overflow-x-auto pb-2 md:flex-col md:gap-6 md:overflow-visible md:pb-0">
        {groups.map((g) => (
          <div key={g.title} className="min-w-max md:min-w-0">
            <div className="px-2 pb-1.5">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</div>
              {g.subtitle ? <div className="truncate text-xs text-muted-foreground/80">{g.subtitle}</div> : null}
            </div>
            <ul className="flex gap-1 md:flex-col">
              {g.items
                .filter((i) => i.show !== false)
                .map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
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
