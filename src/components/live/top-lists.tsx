import { FileTextIcon, SignpostIcon } from "lucide-react";
import { PlatformBadge } from "@/components/platform-badge";
import { channelLabel, num } from "@/lib/format";
import type { LiveSnapshot } from "@/lib/reports-live";
import { LiveCard, LiveCardEmpty } from "./live-card";

// "Right now" lists (last 30 minutes): the pages people are on and where they came from. Each row
// carries a faint bar scaled to the top row, like a ledger column you can read at a glance.

function Bar({ share }: { share: number }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0.5 left-0 rounded-sm bg-fill transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
    />
  );
}

export function TopPages({ pages, minutes }: { pages: LiveSnapshot["topPages"]; minutes: number }) {
  const max = Math.max(1, ...pages.map((p) => p.visitors));
  return (
    <LiveCard title="Top pages" description={`Where visitors are, last ${minutes} minutes`}>
      {pages.length === 0 ? (
        <LiveCardEmpty icon={FileTextIcon} title="No page views right now">
          Pages show up here as soon as someone browses your site.
        </LiveCardEmpty>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {pages.map((p) => (
            <li key={p.path} className="relative flex min-h-8 items-center gap-3 px-2">
              <Bar share={p.visitors / max} />
              <span className="relative min-w-0 flex-1 truncate font-mono text-mono" translate="no" title={p.path}>
                {p.path}
              </span>
              <span className="relative shrink-0 text-ui font-medium tabular-nums">{num(p.visitors)}</span>
            </li>
          ))}
        </ol>
      )}
    </LiveCard>
  );
}

export function TopSources({ sources, minutes }: { sources: LiveSnapshot["topSources"]; minutes: number }) {
  const max = Math.max(1, ...sources.map((s) => s.visitors));
  return (
    <LiveCard title="Top sources" description={`Latest touch of active visitors, last ${minutes} minutes`}>
      {sources.length === 0 ? (
        <LiveCardEmpty icon={SignpostIcon} title="No visitors right now">
          Ads, search, email and referrals appear here as people arrive.
        </LiveCardEmpty>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {sources.map((s) => (
            <li key={`${s.channel}:${s.platform ?? ""}`} className="relative flex min-h-8 items-center gap-3 px-2">
              <Bar share={s.visitors / max} />
              <span className="relative flex min-w-0 flex-1 items-center gap-2 text-ui">
                <span className="truncate">{channelLabel(s.channel)}</span>
                {s.platform ? <PlatformBadge platform={s.platform} className="text-caption" /> : null}
              </span>
              <span className="relative shrink-0 text-ui font-medium tabular-nums">{num(s.visitors)}</span>
            </li>
          ))}
        </ol>
      )}
    </LiveCard>
  );
}
