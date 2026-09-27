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
import { Fragment, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; short?: string; icon: LucideIcon; show?: boolean };

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
  const strip = useRef<HTMLDivElement>(null);
  const groups: { title: string; subtitle?: string; items: Item[] }[] = [
    { title: "Account", items: [{ href: "/settings/account", label: "Profile & security", short: "Profile", icon: UserIcon }] },
    {
      title: "Workspace",
      subtitle: workspaceName,
      items: [
        { href: "/settings/workspace", label: "General", icon: SlidersHorizontalIcon },
        { href: "/settings/workspace/tracking", label: "Tracking & forms", short: "Tracking", icon: MousePointerClickIcon, show: canWorkspace },
        { href: "/settings/workspace/integrations", label: "Integrations", icon: CableIcon, show: canWorkspace },
        { href: "/settings/workspace/notifications", label: "Notifications", icon: BellIcon, show: canWorkspace },
        { href: "/settings/workspace/import", label: "Import data", short: "Import", icon: UploadIcon, show: canWorkspace },
        { href: "/settings/workspace/ai", label: "AI model", icon: BotIcon, show: canWorkspace },
        { href: "/settings/workspace/api", label: "API & MCP", icon: CodeIcon, show: canApi },
      ],
    },
    {
      title: "Organization",
      subtitle: organizationName,
      items: [
        { href: "/settings/organization", label: "Organization & workspaces", short: "Organization", icon: Building2Icon },
        { href: "/settings/organization/members", label: "Members & roles", short: "Members", icon: UsersIcon, show: canMembers },
        { href: "/settings/organization/audit", label: "Audit log", icon: FileClockIcon, show: canAudit },
      ],
    },
  ];
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show !== false) }));
  const active = (href: string) => (href === "/settings/workspace" || href === "/settings/organization" ? pathname === href : pathname.startsWith(href));

  // Keep the current page visible in the horizontal strip (phones and tablets); edges fade so a cut-off pill reads as "scroll for more".
  useEffect(() => {
    const el = strip.current;
    const cur = el?.querySelector<HTMLElement>("[aria-current=page]");
    if (!el || !cur) return;
    el.scrollLeft = cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2;
  }, [pathname]);

  return (
    <>
      {/* Phones & tablets: one scrollable row of pills. */}
      <nav aria-label="Settings" className="-mx-4 border-b md:-mx-6 lg:hidden">
        <div
          ref={strip}
          className="relative flex items-center gap-1 overflow-x-auto overscroll-x-contain px-4 pb-3 [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] [scrollbar-width:none] md:px-6 [&::-webkit-scrollbar]:hidden"
        >
          {visible.map((g, gi) => (
            <Fragment key={g.title}>
              {gi > 0 ? <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-border" /> : null}
              {g.items.map((i) => {
                const on = active(i.href);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                      on
                        ? "border-primary/30 bg-primary/10 font-medium text-foreground dark:bg-primary/15"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <i.icon className={cn("size-4 shrink-0", on && "text-primary")} />
                    {i.short ?? i.label}
                  </Link>
                );
              })}
            </Fragment>
          ))}
        </div>
      </nav>

      {/* Desktop: grouped vertical list. */}
      <nav aria-label="Settings" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <div className="flex flex-col gap-6">
          {visible.map((g) => (
            <div key={g.title} className="min-w-0">
              <div className="px-2.5 pb-1.5">
                <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g.title}</div>
                {g.subtitle ? <div className="truncate text-xs text-muted-foreground">{g.subtitle}</div> : null}
              </div>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((i) => {
                  const on = active(i.href);
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "relative flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                          on && "bg-muted font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
                        )}
                      >
                        <i.icon className={cn("size-4 shrink-0", on && "text-primary")} />
                        <span className="truncate">{i.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
