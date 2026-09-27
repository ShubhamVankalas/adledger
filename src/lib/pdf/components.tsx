import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { Sparkline } from "./charts/sparkline";
import { change, safeText, signedPct } from "./format";
import { PDF_COLORS as C, TYPE } from "./theme";

// Layout building blocks shared by every report kind: masthead, cover block, section titles,
// KPI tiles, tables with repeating headers, callouts and the watermark footer.

export const s = StyleSheet.create({
  eyebrow: { fontSize: TYPE.micro, fontWeight: 500, letterSpacing: 0.9, textTransform: "uppercase", color: C.fgMuted },
  h2: { fontSize: TYPE.titleSm, fontWeight: 600, color: C.fg, letterSpacing: -0.1 },
  caption: { fontSize: TYPE.caption, color: C.fgMuted, lineHeight: 1.45 },
  body: { fontSize: TYPE.body, color: C.fg, lineHeight: 1.5 },
  muted: { color: C.fgMuted },
  faint: { color: C.fgFaint },
  row: { flexDirection: "row" },
  card: { borderWidth: 0.6, borderColor: C.border, borderRadius: 6, padding: 10, backgroundColor: C.paper },
});

/** Org logo (PNG/JPEG bytes) or a wordmark built from the org name. */
export function Brand({ name, logo, size = 18, brand }: { name: string; logo: Uint8Array | null; size?: number; brand: string }) {
  const label = safeText(name, 48);
  if (logo) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt; the org name is printed beside it */}
        <Image src={{ data: Buffer.from(logo), format: logo[0] === 0xff ? "jpg" : "png" }} style={{ width: size, height: size, objectFit: "contain" }} />
        <Text style={{ fontSize: TYPE.ui, fontWeight: 600, color: C.fg }}>{label}</Text>
      </View>
    );
  }
  const initial = label.slice(0, 1).toUpperCase() || "A";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <View style={{ width: size, height: size, borderRadius: 4, backgroundColor: brand, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size * 0.5, fontWeight: 600, color: "#ffffff" }}>{initial}</Text>
      </View>
      <Text style={{ fontSize: TYPE.ui, fontWeight: 600, color: C.fg }}>{label}</Text>
    </View>
  );
}

/** Section title: small uppercase eyebrow + a hairline running to the right edge. */
export function Section({ title, aside, children, style, breakBefore }: { title: string; aside?: string; children: ReactNode; style?: object; breakBefore?: boolean }) {
  return (
    <View style={{ marginTop: 16, ...style }} break={breakBefore}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Text style={s.eyebrow}>{title}</Text>
        <View style={{ flexGrow: 1, height: 0.6, backgroundColor: C.border }} />
        {aside ? <Text style={{ ...s.caption, fontSize: TYPE.micro }}>{aside}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export type Polarity = "up" | "down" | "neutral";

/** Δ text and colour by metric polarity; |Δ| < 2% reads as a muted "flat". */
export function deltaTone(cur: number | null, prev: number | null, polarity: Polarity) {
  const d = change(cur, prev);
  if (d === null) return { text: "—", color: C.fgFaint, d };
  if (Math.abs(d) < 0.02) return { text: "flat", color: C.fgMuted, d };
  const arrow = d > 0 ? "▲" : "▼";
  const good = polarity === "neutral" ? null : polarity === "up" ? d > 0 : d < 0;
  return { text: `${arrow} ${signedPct(d).replace(/^[+−]/, "")}`, color: good === null ? C.fgMuted : good ? C.positive : C.negative, d };
}

export function KpiTile({
  label,
  value,
  cur,
  prev,
  prevLabel,
  polarity,
  spark,
  sparkCompare,
  color = C.fg,
  width,
}: {
  label: string;
  value: string;
  cur: number | null;
  prev?: number | null;
  prevLabel?: string;
  polarity: Polarity;
  spark?: number[];
  sparkCompare?: number[];
  color?: string;
  width: number;
}) {
  const tone = prev === undefined ? null : deltaTone(cur, prev, polarity);
  return (
    <View style={{ width, borderWidth: 0.6, borderColor: C.border, borderRadius: 5, paddingVertical: 8, paddingHorizontal: 9, backgroundColor: C.paper }} wrap={false}>
      <Text style={{ fontSize: TYPE.caption, fontWeight: 500, color: C.fgMuted }}>{label}</Text>
      <Text style={{ fontSize: TYPE.kpi, fontWeight: 600, color: C.fg, letterSpacing: -0.3, marginTop: 2 }}>{value}</Text>
      {tone ? (
        <View style={{ flexDirection: "row", gap: 4, marginTop: 1.5, alignItems: "baseline" }}>
          <Text style={{ fontSize: TYPE.micro + 0.5, fontWeight: 500, color: tone.color }}>{tone.text}</Text>
          {prevLabel ? <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgFaint }}>was {prevLabel}</Text> : null}
        </View>
      ) : null}
      {spark && spark.length > 1 ? (
        <View style={{ marginTop: 5 }}>
          <Sparkline width={width - 18} height={16} values={spark} compare={sparkCompare} color={color} compareColor={C.fgFaint} />
        </View>
      ) : null}
    </View>
  );
}

export type Column<R> = {
  header: string;
  /** Flex weight of the column (names get more room). */
  flex?: number;
  width?: number;
  align?: "left" | "right";
  cell: (row: R, index: number) => ReactNode;
  /** Optional muted second line under the value. */
  sub?: (row: R) => string | null;
};

/**
 * Table with a header that repeats on every page it spans and rows that never split. Capped at
 * `limit` rows with an "and N more" line (full data lives in the CSV exports).
 */
export function Table<R>({
  columns,
  rows,
  limit = 25,
  moreNoun = "rows",
  total,
  dense = false,
  emptyText = "Nothing to show for this period.",
}: {
  columns: Column<R>[];
  rows: R[];
  limit?: number;
  moreNoun?: string;
  total?: R;
  dense?: boolean;
  emptyText?: string;
}) {
  const shown = rows.slice(0, limit);
  const more = rows.length - shown.length;
  const padV = dense ? 3.5 : 5;
  const cellStyle = (c: Column<R>) => ({
    ...(c.width ? { width: c.width } : { flex: c.flex ?? 1 }),
    textAlign: c.align ?? "left",
    paddingHorizontal: 4,
  });
  const renderRow = (r: R, i: number, isTotal = false) => (
    <View
      key={isTotal ? "total" : i}
      wrap={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: padV,
        borderBottomWidth: isTotal ? 0 : 0.5,
        borderTopWidth: isTotal ? 0.8 : 0,
        borderColor: isTotal ? C.borderStrong : C.border,
      }}
    >
      {columns.map((c, ci) => {
        const v = c.cell(r, i);
        const sub = c.sub?.(r);
        return (
          <View key={ci} style={cellStyle(c)}>
            {typeof v === "string" || typeof v === "number" ? (
              <Text style={{ fontSize: TYPE.ui, color: C.fg, fontWeight: isTotal ? 600 : ci === 0 ? 500 : 400 }}>{typeof v === "string" ? safeText(v, 80) : v}</Text>
            ) : (
              v
            )}
            {sub ? <Text style={{ fontSize: TYPE.micro, color: C.fgFaint, marginTop: 1 }}>{safeText(sub, 60)}</Text> : null}
          </View>
        );
      })}
    </View>
  );
  if (rows.length === 0) {
    return <Text style={{ ...s.caption, paddingVertical: 6, paddingHorizontal: 4, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.border }}>{emptyText}</Text>;
  }
  return (
    <View>
      <View fixed style={{ flexDirection: "row", paddingVertical: 4.5, backgroundColor: C.bgSubtle, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.border }}>
        {columns.map((c, ci) => (
          <Text key={ci} style={{ ...cellStyle(c), fontSize: TYPE.caption - 0.5, fontWeight: 500, color: C.fgMuted }}>
            {c.header}
          </Text>
        ))}
      </View>
      {shown.map((r, i) => renderRow(r, i))}
      {total ? renderRow(total, -1, true) : null}
      {more > 0 ? (
        <Text style={{ fontSize: TYPE.caption, color: C.fgMuted, paddingTop: 5, paddingHorizontal: 4 }}>
          and {more.toLocaleString("en-US")} more {moreNoun}. Export the full list as CSV from AdLedger.
        </Text>
      ) : null}
    </View>
  );
}

/** Tinted callout box (warning = amber, positive = green, neutral = grey). */
export function Callout({ tone = "neutral", title, children }: { tone?: "neutral" | "warning" | "positive" | "negative"; title: string; children: ReactNode }) {
  const bg = { neutral: C.bgSubtle, warning: C.warningSoft, positive: C.positiveSoft, negative: C.negativeSoft }[tone];
  const bar = { neutral: C.borderStrong, warning: C.warning, positive: C.positive, negative: C.negative }[tone];
  const fg = { neutral: C.fg, warning: C.warningText, positive: C.positive, negative: C.negative }[tone];
  return (
    <View wrap={false} style={{ flexDirection: "row", backgroundColor: bg, borderRadius: 5, overflow: "hidden" }}>
      <View style={{ width: 2.5, backgroundColor: bar }} />
      <View style={{ paddingVertical: 8, paddingHorizontal: 10, flexGrow: 1, flexShrink: 1 }}>
        <Text style={{ fontSize: TYPE.ui, fontWeight: 600, color: fg }}>{title}</Text>
        <View style={{ marginTop: 3 }}>{typeof children === "string" ? <Text style={s.caption}>{children}</Text> : children}</View>
      </View>
    </View>
  );
}

/** Bulleted list of short statements. */
export function Bullets({ items, size = TYPE.body }: { items: string[]; size?: number }) {
  return (
    <View style={{ gap: 4 }}>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 6 }} wrap={false}>
          <Text style={{ fontSize: size, color: C.fgFaint }}>•</Text>
          <Text style={{ fontSize: size, color: C.fg, lineHeight: 1.45, flexShrink: 1 }}>{safeText(it, 280)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Legend row: coloured keys + labels. */
export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; box?: boolean }[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {it.box ? (
            <View style={{ width: 6, height: 6, borderRadius: 1.5, backgroundColor: it.color }} />
          ) : (
            <View style={{ width: 10, height: 0, borderTopWidth: 1.4, borderColor: it.color, borderStyle: it.dashed ? "dashed" : "solid" }} />
          )}
          <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgMuted }}>{safeText(it.label, 40)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Small key/value pair used in stat strips. */
export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View>
      <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgMuted, fontWeight: 500 }}>{label}</Text>
      <Text style={{ fontSize: TYPE.titleSm, fontWeight: 600, color: tone ?? C.fg, marginTop: 1.5 }}>{value}</Text>
    </View>
  );
}

/** Coloured dot + text (legend-like inline marker). */
export function Dot({ color, size = 5 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}
