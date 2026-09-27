import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { MODEL_LABELS } from "../format";
import type { Methodology, RenderContext, ReportMeta } from "../report-kinds/types";
import { Brand, s } from "./components";
import { registerFonts } from "./fonts";
import { dateRange, longDate, pct, safeText } from "./format";
import { PDF_COLORS as C, TYPE } from "./theme";

// The frame every report shares: page chrome (masthead + watermark footer with "n / total"),
// the cover block on page one, and the methodology appendix at the end.

const PAD_X = 36;

/** Fingerprint as printed: first 20 hex characters in groups of four ("7f3a 9c21 …"). */
export const shortFingerprint = (fp: string) => (fp.slice(0, 20).match(/.{1,4}/g) ?? []).join(" ");

export function ReportDocument({ meta, ctx, methodology, children }: { meta: ReportMeta; ctx: RenderContext; methodology: Methodology; children: ReactNode }) {
  const families = registerFonts();
  const period = dateRange(methodology.start, methodology.end);
  const workspace = safeText(ctx.workspaceName, 60);
  const compact = meta.length === "1 page";
  return (
    <Document
      title={`${meta.title} · ${workspace} · ${period}`}
      author={safeText(ctx.organizationName, 80)}
      subject={meta.description}
      creator="AdLedger"
      producer="AdLedger"
      keywords={`adledger report ${meta.id} ${ctx.exportId}`}
      language="en"
      creationDate={ctx.issuedAt}
      modificationDate={ctx.issuedAt}
    >
      <Page
        size="A4"
        orientation={meta.orientation}
        wrap
        style={{
          fontFamily: families,
          fontSize: TYPE.ui,
          color: C.fg,
          backgroundColor: C.paper,
          paddingTop: 62,
          paddingBottom: 46,
          paddingHorizontal: PAD_X,
          fontFeatureSettings: { tnum: true, liga: false },
        }}
      >
        <Masthead meta={meta} ctx={ctx} period={period} />
        <Cover meta={meta} ctx={ctx} methodology={methodology} compact={compact} />
        {children}
        <MethodologyAppendix meta={meta} ctx={ctx} m={methodology} compact={compact} twoColumns={compact || meta.orientation === "landscape"} />
        <Footer ctx={ctx} />
      </Page>
    </Document>
  );
}

function Masthead({ meta, ctx, period }: { meta: ReportMeta; ctx: RenderContext; period: string }) {
  return (
    <View fixed style={{ position: "absolute", top: 22, left: PAD_X, right: PAD_X }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 9, borderBottomWidth: 0.6, borderColor: C.border }}>
        <Brand name={ctx.organizationName} logo={ctx.logo} brand={ctx.theme.brand} />
        <Text style={{ fontSize: TYPE.caption, color: C.fgMuted }}>
          {meta.title} · {period}
        </Text>
      </View>
    </View>
  );
}

function Cover({ meta, ctx, methodology: m, compact }: { meta: ReportMeta; ctx: RenderContext; methodology: Methodology; compact: boolean }) {
  const bits = [
    m.compareStart && m.compareEnd ? `compared with ${dateRange(m.compareStart, m.compareEnd)}` : null,
    meta.usesModel ? `${MODEL_LABELS[m.model] ?? m.model} attribution` : "All attribution models",
    m.currency,
  ].filter(Boolean);
  return (
    <View style={{ marginBottom: compact ? 4 : 8 }}>
      <View style={{ width: 22, height: 2, backgroundColor: ctx.theme.brand, borderRadius: 1, marginBottom: compact ? 7 : 10 }} />
      <Text style={s.eyebrow}>{meta.title}</Text>
      <Text style={{ fontSize: compact ? TYPE.title + 2 : TYPE.display, fontWeight: 600, letterSpacing: compact ? -0.3 : -0.6, color: C.fg, marginTop: compact ? 3 : 5 }}>{safeText(ctx.workspaceName, 60)}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: compact ? 3 : 6 }}>
        <Text style={{ fontSize: TYPE.body, fontWeight: 500, color: C.fg }}>{dateRange(m.start, m.end)}</Text>
        {bits.map((b, i) => (
          <Text key={i} style={{ fontSize: TYPE.body, color: C.fgMuted }}>
            · {b}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Footer({ ctx }: { ctx: RenderContext }) {
  const line = `Confidential · Prepared for ${safeText(ctx.preparedFor, 48)} · ${safeText(ctx.workspaceName, 48)} · ${ctx.issuedOn} · ${shortFingerprint(ctx.fingerprint)}`;
  return (
    <View fixed style={{ position: "absolute", bottom: 20, left: PAD_X, right: PAD_X, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 0.6, borderColor: C.border, paddingTop: 7 }}>
      <Text style={{ fontSize: TYPE.micro, color: C.fgFaint, maxWidth: "88%" }}>{line}</Text>
      <Text style={{ fontSize: TYPE.micro, color: C.fgMuted, fontWeight: 500 }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

const when = (iso: string | null) => (iso ? `${longDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC` : "never");

/** "Meta Ads, Google Ads and Stripe 27 Sep 2026 07:19 UTC (demo data) · TikTok Ads never". */
export function syncSummary(syncs: Methodology["syncs"]): string {
  if (!syncs.length) return "No ad or revenue connections";
  const groups = new Map<string, string[]>();
  for (const x of syncs) {
    const key = `${when(x.lastSyncedAt)}${x.mode === "mock" ? " (demo data)" : ""}${x.failing ? ", last sync failed" : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), safeText(x.label, 40)]);
  }
  const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  return [...groups].map(([k, names]) => `${list(names)} ${k}`).join(" · ");
}

/** Full fingerprint in eight groups of eight so it wraps cleanly. */
const groupedFingerprint = (fp: string) => (fp.match(/.{1,8}/g) ?? []).join(" ");

function MethodologyAppendix({ meta, ctx, m, compact, twoColumns }: { meta: ReportMeta; ctx: RenderContext; m: Methodology; compact: boolean; twoColumns: boolean }) {
  const rows: [string, string][] = [
    ["Attribution", meta.usesModel ? `${MODEL_LABELS[m.model] ?? m.model} model, ${m.windowDays}-day window` : `First touch, last touch and linear side by side, ${m.windowDays}-day window`],
    ["Period", `${dateRange(m.start, m.end)} (${m.timezone})${m.compareStart && m.compareEnd ? `, compared with ${dateRange(m.compareStart, m.compareEnd)}` : ""}`],
    ["Unattributed", m.unattributedShare === null ? "No revenue in this period" : `${pct(m.unattributedShare)} of revenue had no tracked touch before the payment`],
    ["Currency", m.exclusions.length ? `${m.currency}. ${m.exclusions.join(" ")}` : `${m.currency}. Nothing in other currencies was excluded.`],
    ["Last sync", syncSummary(m.syncs)],
    ["Pixel", m.pixel.lastEventAt ? `${m.pixel.events24h.toLocaleString("en-US")} events in the last 24 hours, latest ${when(m.pixel.lastEventAt)}` : "No website events recorded yet"],
    ["Source", "Every figure is computed by SQL from this AdLedger ledger. No number was written or calculated by AI."],
    ["Fingerprint", `${groupedFingerprint(ctx.fingerprint)}. ${ctx.verifyUrl ? `Check it at ${ctx.verifyUrl}` : "Check it on the /verify page of your AdLedger"}.`],
  ];
  const size = compact ? TYPE.micro : TYPE.caption;
  return (
    <View wrap={false} style={{ marginTop: compact ? 12 : 22 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: compact ? 4 : 8 }}>
        <Text style={s.eyebrow}>Methodology</Text>
        <View style={{ flexGrow: 1, height: 0.6, backgroundColor: C.border }} />
      </View>
      <View style={twoColumns ? { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" } : undefined}>
        {rows.map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", paddingVertical: compact ? 1.5 : 3.5, width: twoColumns ? "49%" : "100%", borderBottomWidth: compact ? 0 : 0.5, borderColor: C.border }}>
            <Text style={{ width: compact ? 58 : twoColumns ? 84 : 110, fontSize: size, color: C.fgMuted, fontWeight: 500 }}>{k}</Text>
            <Text style={{ flex: 1, fontSize: size, color: C.fg, lineHeight: 1.4 }}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
