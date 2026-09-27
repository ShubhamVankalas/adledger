import {
  BadgeDollarSignIcon,
  ChevronRightIcon,
  FileTextIcon,
  GlobeIcon,
  MousePointerClickIcon,
  Undo2Icon,
} from "lucide-react";
import { BrandGlyph } from "@/components/brand-icon";
import { PlatformBadge } from "@/components/platform-badge";
import { CHANNEL_LABELS, money } from "@/lib/format";
import type { JourneyItem } from "@/lib/reports";
import { TINT, tintStyle } from "@/lib/avatar-tint";
import { cn } from "@/lib/utils";

export function initials(name: string | null, email: string | null) {
  const n = name?.trim();
  if (n) {
    const words = n.split(/\s+/).filter(Boolean);
    return (
      (
        (words[0]?.[0] ?? "") +
        (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")
      ).toUpperCase() || "?"
    );
  }
  const local = email?.split("@")[0]?.replace(/[^a-z0-9]/gi, "") ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

export function ContactAvatar({
  id,
  name,
  email,
  className,
}: {
  id: string;
  name: string | null;
  email: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={tintStyle(id)}
      className={cn(
        "flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold tracking-tight select-none",
        TINT,
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}

export const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  microsoft: "Microsoft",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  reddit: "Reddit",
  x: "X",
};

const PARAM_LABELS: Record<string, string> = {
  utm_source: "Source",
  utm_medium: "Medium",
  utm_campaign: "Campaign",
  utm_term: "Term",
  utm_content: "Content",
  utm_id: "Campaign ID",
  gclid: "Google click ID",
  gbraid: "Google click ID",
  wbraid: "Google click ID",
  fbclid: "Meta click ID",
  msclkid: "Microsoft click ID",
  ttclid: "TikTok click ID",
  li_fat_id: "LinkedIn click ID",
  epik: "Pinterest click ID",
  sccid: "Snapchat click ID",
  rdt_cid: "Reddit click ID",
  twclid: "X click ID",
};

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseUrl(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.host.replace(/^www\./, ""),
      path: decodeURIComponent(u.pathname) || "/",
      params: [...u.searchParams.entries()],
    };
  } catch {
    return null;
  }
}

const LEAD_SOURCES: Record<string, string> = {
  pixel: "website form",
  webhook: "form webhook",
  api: "API",
  meta_leads: "Meta lead form",
  google_ads_leads: "Google Ads lead form",
  tiktok_leads: "TikTok lead form",
  whatsapp: "WhatsApp",
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
};

export function leadSourceLabel(source: string) {
  return LEAD_SOURCES[source] ?? source.replace(/_/g, " ");
}

function Chip({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 text-xs">
      {label ? <span className="text-muted-foreground">{label}</span> : null}
      <span className="truncate font-medium text-foreground/90">
        {children}
      </span>
    </span>
  );
}

const KIND = {
  touchpoint: {
    icon: MousePointerClickIcon,
    tone: "border bg-card text-muted-foreground",
  },
  lead: {
    icon: FileTextIcon,
    tone: "bg-chart-2/15 text-chart-2 ring-1 ring-chart-2/25",
  },
  payment: {
    icon: BadgeDollarSignIcon,
    tone: "bg-success/15 text-success ring-1 ring-success/30",
  },
  refund: {
    icon: Undo2Icon,
    tone: "bg-destructive/10 text-destructive ring-1 ring-destructive/25",
  },
} as const;

export function TimelineItem({
  item: i,
  time,
  showDevice,
  last,
}: {
  item: JourneyItem;
  time: string;
  showDevice: boolean;
  last: boolean;
}) {
  const { icon: Icon, tone } = KIND[i.kind];
  return (
    <li className="relative flex gap-3 sm:gap-4">
      {/* Rail: the connector line runs from under this node to the next one. */}
      <div className="relative flex w-8 shrink-0 justify-center">
        {!last ? (
          <span
            aria-hidden
            className="absolute top-9 -bottom-1 w-px bg-border"
          />
        ) : null}
        <span
          className={cn(
            "relative flex size-8 items-center justify-center rounded-full",
            tone,
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-6")}>
        {i.kind === "touchpoint" ? (
          <Touchpoint item={i} time={time} showDevice={showDevice} />
        ) : null}
        {i.kind === "lead" ? (
          <>
            <Title time={time}>Became a lead</Title>
            <p className="mt-1 text-sm text-muted-foreground">
              {i.formName ? (
                <>
                  Submitted{" "}
                  <span className="font-medium text-foreground/90">
                    {i.formName}
                  </span>{" "}
                  via {leadSourceLabel(i.source)}
                </>
              ) : (
                <>Captured via {leadSourceLabel(i.source)}</>
              )}
            </p>
          </>
        ) : null}
        {i.kind === "payment" || i.kind === "refund" ? (
          <Title
            time={time}
            aside={
              <span
                className={cn(
                  "tabular font-semibold",
                  i.kind === "refund" ? "text-destructive" : "text-success",
                )}
              >
                {i.kind === "refund" ? "−" : "+"}
                {money(Math.abs(i.amountMinor), i.currency)}
              </span>
            }
          >
            {i.kind === "payment" ? "Payment received" : "Refund issued"}
          </Title>
        ) : null}
      </div>
    </li>
  );
}

function Title({
  children,
  time,
  aside,
}: {
  children: React.ReactNode;
  time: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-0.5">
      <div className="min-w-0 flex-1 text-sm font-medium break-words">
        {children}
      </div>
      {aside}
      <time className="tabular shrink-0 text-xs text-muted-foreground">
        {time}
      </time>
    </div>
  );
}

function Touchpoint({
  item: i,
  time,
  showDevice,
}: {
  item: Extract<JourneyItem, { kind: "touchpoint" }>;
  time: string;
  showDevice: boolean;
}) {
  const channel = CHANNEL_LABELS[i.channel] ?? i.channel.replace(/_/g, " ");
  const landing = parseUrl(i.landingUrl);
  const referrer = parseUrl(i.referrer);
  const params = (landing?.params ?? []).filter(
    ([k]) => PARAM_LABELS[k] || k.startsWith("utm_"),
  );
  const clickId = params.find(([k]) => PARAM_LABELS[k]?.endsWith("click ID"));
  const path = [i.adGroup, i.ad].filter((x): x is string => Boolean(x));
  const hasDetails =
    params.length > 0 || Boolean(i.landingUrl) || Boolean(i.referrer);
  return (
    <>
      <Title time={time}>
        {i.campaign ??
          (i.platform
            ? `${PLATFORM_LABELS[i.platform] ?? i.platform} visit`
            : `${channel} visit`)}
      </Title>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        {i.platform ? <PlatformBadge platform={i.platform} /> : null}
        {[channel, ...path].map((p, idx) => (
          <span key={idx} className="flex min-w-0 items-center gap-2">
            {idx > 0 ? (
              <ChevronRightIcon
                className="size-3 shrink-0 opacity-60"
                aria-hidden
              />
            ) : null}
            <span className="min-w-0 break-words">{p}</span>
          </span>
        ))}
        {showDevice ? <span>· Device {i.device}</span> : null}
      </div>
      {landing || i.source || i.medium || referrer ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {landing ? (
            <Chip label="Landed on">
              <span title={i.landingUrl ?? undefined}>{landing.path}</span>
            </Chip>
          ) : null}
          {i.source || i.medium ? (
            <Chip label="via">
              {[i.source, i.medium].filter(Boolean).join(" / ")}
            </Chip>
          ) : null}
          {referrer && !i.source ? (
            <Chip label="from">{referrer.host}</Chip>
          ) : null}
          {clickId ? <Chip>{PARAM_LABELS[clickId[0]]}</Chip> : null}
        </div>
      ) : null}
      {hasDetails ? (
        <details className="group/details mt-2 text-xs">
          <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-md text-muted-foreground transition-colors select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              className="size-3.5 transition-transform group-open/details:rotate-90"
              aria-hidden
            />
            Tracking details
          </summary>
          <dl className="mt-2 grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 p-3">
            {landing ? (
              <>
                <dt className="text-muted-foreground">Website</dt>
                <dd className="flex min-w-0 items-center gap-1.5">
                  <GlobeIcon
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="truncate">{landing.host}</span>
                </dd>
              </>
            ) : null}
            {referrer ? (
              <>
                <dt className="text-muted-foreground">Referrer</dt>
                <dd className="truncate">{referrer.host}</dd>
              </>
            ) : null}
            {params.map(([k, v]) => (
              <Row
                key={k}
                label={
                  PARAM_LABELS[k] ??
                  sentence(k.replace(/^utm_/, "").replace(/_/g, " "))
                }
                value={v}
              />
            ))}
            {i.landingUrl ? (
              <>
                <dt className="text-muted-foreground">Full URL</dt>
                <dd className="font-mono text-[11px] leading-relaxed break-all text-muted-foreground">
                  {i.landingUrl}
                </dd>
              </>
            ) : null}
          </dl>
        </details>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular min-w-0 break-all">{value}</dd>
    </>
  );
}

export function SourceValue({
  item,
}: {
  item: Extract<JourneyItem, { kind: "touchpoint" }> | undefined;
}) {
  if (!item) return <span className="text-muted-foreground">Unknown</span>;
  const channel =
    CHANNEL_LABELS[item.channel] ?? item.channel.replace(/_/g, " ");
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {item.platform ? (
        <BrandGlyph id={item.platform} className="size-3.5" />
      ) : null}
      <span className="truncate">
        {item.platform
          ? (PLATFORM_LABELS[item.platform] ?? item.platform)
          : channel}
      </span>
    </span>
  );
}
