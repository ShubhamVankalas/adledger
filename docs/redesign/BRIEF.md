# AdLedger redesign brief: "Quiet Ledger"

Status: approved · Date: 2026-09-27 · Sources: six research reports (attribution competitors, modern CRM, design language, analytics dashboards, AdLedger audit, UX/mobile/speed).

**In one sentence:** AdLedger should feel like a calm, expensive financial statement that updates live. You open it and it tells you which ad made money. You can rearrange it to show the numbers you care about. Every number leads to the people behind it.

---

## 1. Design direction

**Design read:** *A Mercury-calm money ledger with Linear's disciplined chrome, Stripe's "answer before the chart" dashboards, Attio's spreadsheet-grade CRM, and a live pulse that shows money arriving as it happens.*

Today AdLedger is capable but flat. Six equal KPI boxes, one chart, read-only tables, a CRM that is only a list, and a contacts page that takes 15+ seconds. The redesign keeps the stack and the "one `docker compose up`" promise and changes the feel in four ways.

1. **Quieter surfaces.** A neutral sage-graphite UI where colour appears only when it means money.
2. **An answer-first Overview** that the owner can rearrange, like Triple Whale's Summary and Shopify's dashboard.
3. **A real CRM.** Views, filters, stages, notes and a pipeline, all tied back to the ad that brought each person in.
4. **Speed you can feel.** Widgets stream in independently. Filters never blank the screen. ⌘K is everywhere. A Live view shows visitors, leads and payments arriving as they happen.

We go deliberately calm on variance and motion (3/10 each) and moderately dense (6/10). This is a data tool, not a landing page.

### Principles

1. **Answer first, chart second.** Every page and widget states the value and its change before any visualisation. The Overview opens with one plain sentence naming the most profitable ad, filled from `reports.ts` numbers. *(Stripe chart layout, Mercury)*
2. **Colour means money, nothing else.** Green is revenue or gain, red is loss, amber is a warning. The emerald accent is kept for focus and selection. Primary buttons are ink (near-black or near-white). Colour is always paired with a sign, arrow or label. *(Mercury, Cal.com)*
3. **Structure is felt, not seen.** Hairlines at about 7% ink. Shadows only on floating layers. The sidebar is dimmer than the content. *(Linear 2026 refresh, Vercel Geist)*
4. **Never blank the screen.** Filter changes keep the old data visible, dimmed, with a 2px progress line. Skeletons appear only on a cold load, after a 200ms delay, and match the real layout exactly. *(Vercel Web Interface Guidelines)*
5. **Every number is a door.** Click a KPI, a bar, a row or a funnel step to reach the campaigns, then the contacts, then the journey behind it. *(SegMetrics, Hyros Deep Mode, Plausible click-to-filter)*
6. **Calm defaults, deep customisation.** New workspaces get a minimal, good-looking preset. Power users pin, reorder, save views and build their own board. Nobody starts from a blank canvas, and "Reset" is always one click. *(Shopify, Geckoboard "clarity over quantity")*
7. **Keyboard-first, mouse-friendly.** ⌘K reaches every page, record and action, and shortcuts are shown where they apply. Novices never need them. *(Linear, Raycast, Attio)*
8. **The state is the URL.** Date range, comparison, model, filters, columns and sort all live in the URL, so any screen is a shareable link and any link can be saved as a view. *(Vercel guidelines, Attio/Close saved views)*
9. **Honest numbers.** Show "last synced" times, platform-reported vs AdLedger-attributed side by side, "too early to judge" badges and "—" instead of `0x`, `NaN` or "0.5 customers". *(Northbeam learning period; the top competitor complaint is "doesn't match Ads Manager")*
10. **Alive, not noisy.** Live data ticks in with small, meaningful motion under 300ms. Nothing animates on keyboard actions, and reduced motion is fully respected. *(Plausible Realtime, Shopify Live View, Emil Kowalski's motion standards)*

---

## 2. Design system spec

All tokens live in `src/app/globals.css` (Tailwind v4 `@theme inline`) and are mapped onto the existing shadcn variable names, so every existing component picks up the new look without edits.

### 2.1 Typography

**Font: Geist Sans + Geist Mono. Keep them.** They are already self-hosted through the `geist` package (`geist/font/sans`, `geist/font/mono` in `src/app/layout.tsx`). That package wraps `next/font/local` with the font files inside `node_modules`, so there are no Google Fonts requests at build or run time and Docker or offline installs keep working. We use the variable axis to get weight 450 for body text in dark mode. No new font dependency.

- Weights: **400 / 500 / 600 only** (and 450 for dark-mode body).
- `font-variant-numeric: tabular-nums` on every KPI, table cell, axis tick and delta, through a `.num` utility and the `td` default.
- Tracking: 0 from 11 to 14px, negative from 16px up.
- `text-wrap: balance` on headings and `pretty` on prose. `-webkit-font-smoothing: antialiased`.
- Mobile inputs are 16px to prevent iOS zoom.

| Token | Size / line-height (px) | Weight | Tracking | Use |
|---|---|---|---|---|
| `text-micro` | 11 / 16 | 500 | +0.01em | badges, kbd, axis ticks, legends |
| `text-caption` | 12 / 16 | 400 | 0 | meta, helper text, timestamps, table headers (500) |
| `text-ui` | 13 / 20 | 400 (strong 500) | 0 | **default**: nav, table cells, menus, dense inputs |
| `text-body` | 14 / 22 | 400 (strong 500) | 0 | prose, forms, dialogs, AI text |
| `text-title-sm` | 16 / 24 | 600 | −0.011em | card titles, page-header title |
| `text-title` | 20 / 28 | 600 | −0.02em | page titles, contact name |
| `text-kpi` | 24 / 32 | 600 | −0.02em | KPI tile values |
| `text-kpi-lg` | 32 / 40 | 600 | −0.025em | hero metric, Live counters |
| `text-mono` | 12 / 16 | 400 | 0 | UTMs, IDs, click IDs, code, pixel snippet |

**Money typography.** In hero KPIs the currency symbol and minor units render at 60% size in `--fg-muted` (for example ₹**6,50,000**.00). Numbers format with `Intl.NumberFormat` in the workspace locale (`en-IN` gives lakh/crore grouping), with compact notation on tiles (₹6.5L, $553.9K) and full values in tables and tooltips. Ratios display as `3.25×`, never "325%". Use `&nbsp;` between a number and its unit. All formatting goes through `src/lib/money.ts`.

### 2.2 Colour (OKLCH)

All neutrals use one tinted family (hue 165, "sage graphite"). The accent is emerald (hue 162). This replaces today's cool-slate neutrals (hue 250) and the emerald primary buttons.

```css
:root {
  /* neutrals */
  --bg:            oklch(0.985 0.003 165);  /* app canvas */
  --bg-subtle:     oklch(0.972 0.004 165);  /* sidebar, table header */
  --surface:       oklch(1 0 0);            /* cards, popovers */
  --fill:          oklch(0.955 0.004 165);  /* control rest */
  --fill-hover:    oklch(0.935 0.005 165);
  --fill-active:   oklch(0.915 0.006 165);  /* pressed, active nav */
  --border:        oklch(0.922 0.004 165);  /* hairline */
  --border-strong: oklch(0.86 0.006 165);   /* inputs */
  --fg-faint:      oklch(0.62 0.01 165);    /* placeholder, icons only */
  --fg-muted:      oklch(0.5 0.012 165);    /* secondary text, ≥4.5:1 */
  --fg:            oklch(0.2 0.012 165);
  --ink:           oklch(0.2 0.012 165);    /* primary button */
  --ink-fg:        oklch(0.985 0.003 165);
  /* accent: focus, selection, links, revenue series */
  --accent:        oklch(0.55 0.13 162);
  --accent-hover:  oklch(0.5 0.13 162);
  --accent-soft:   oklch(0.55 0.13 162 / 0.09);
  --accent-fg:     oklch(0.42 0.1 162);
  --ring:          oklch(0.55 0.13 162 / 0.45);
  /* semantic */
  --positive: oklch(0.52 0.13 155);
  --negative: oklch(0.55 0.19 27);
  --warning:  oklch(0.7 0.14 70);
  --info:     oklch(0.55 0.12 250);
  /* charts: one colour per metric, everywhere */
  --chart-revenue:   oklch(0.62 0.14 160);
  --chart-spend:     oklch(0.6 0.03 250);   /* calm slate: spend is neutral, not bad */
  --chart-leads:     oklch(0.72 0.14 70);
  --chart-customers: oklch(0.58 0.14 265);
  --chart-5:         oklch(0.65 0.16 20);
  --chart-grid:      oklch(0.922 0.004 165);
}
.dark {
  --bg:            oklch(0.165 0.004 165);
  --bg-subtle:     oklch(0.145 0.004 165);  /* sidebar darker = dimmer */
  --surface:       oklch(0.195 0.005 165);
  --fill:          oklch(0.225 0.005 165);
  --fill-hover:    oklch(0.25 0.006 165);
  --fill-active:   oklch(0.275 0.007 165);
  --border:        oklch(1 0 0 / 0.07);
  --border-strong: oklch(1 0 0 / 0.13);
  --fg-faint:      oklch(0.55 0.008 165);
  --fg-muted:      oklch(0.71 0.008 165);
  --fg:            oklch(0.95 0.004 165);   /* off-white, never #fff */
  --ink:           oklch(0.95 0.004 165);
  --ink-fg:        oklch(0.17 0.004 165);
  --accent:        oklch(0.74 0.14 162);
  --accent-hover:  oklch(0.79 0.13 162);
  --accent-soft:   oklch(0.74 0.14 162 / 0.12);
  --accent-fg:     oklch(0.8 0.12 162);
  --ring:          oklch(0.74 0.14 162 / 0.5);
  --positive: oklch(0.74 0.15 155);
  --negative: oklch(0.7 0.17 25);
  --warning:  oklch(0.8 0.13 75);
  --info:     oklch(0.72 0.11 250);
  --chart-revenue:   oklch(0.74 0.14 160);
  --chart-spend:     oklch(0.68 0.03 250);
  --chart-leads:     oklch(0.8 0.13 75);
  --chart-customers: oklch(0.7 0.13 268);
  --chart-5:         oklch(0.72 0.15 20);
  --chart-grid:      oklch(1 0 0 / 0.06);
}
```

How the new tokens map onto the existing shadcn names:

| shadcn variable | New token |
|---|---|
| `--background` | `--bg` |
| `--card`, `--popover` | `--surface` |
| `--primary` | `--ink` (with `--primary-foreground` = `--ink-fg`) |
| `--secondary`, `--muted` | `--fill` |
| `--muted-foreground` | `--fg-muted` |
| `--accent` (shadcn hover fill) | `--fill-hover` |
| `--border` | `--border` |
| `--input` | `--border-strong` |
| `--ring` | `--ring` |
| `--destructive` | `--negative` |
| `--sidebar` | `--bg-subtle` |
| `--chart-1..5` | the named chart tokens |

Rules:
- `color-scheme: light dark` on `<html>`, and `<meta name="theme-color">` follows `--bg`.
- Native `<select>` gets an explicit background and foreground (Windows dark mode).
- Every text/background pair must pass AA. Check the chart palette for colour-blind safety with the dataviz validator before merge.
- Deltas use polarity from the metric registry: spend is neutral, CAC and CPL are good when they go down. |Δ| < 2% renders as a muted "flat".
- Agencies can set an optional per-workspace `--brand`, clamped to L 0.50–0.60 (light) and 0.70–0.80 (dark). It is used only on share links and client reports.

### 2.3 Radius, elevation, spacing, sizes

- **Radius (locked):**
  - 4px: badge, kbd, checkbox, chart bar
  - 6px: button, input, menu item, tab pill
  - 8px: popover, menu, tooltip, KPI tile
  - 12px: card, dialog, command palette, sheet
  - full: avatar, status dot, segmented thumb
  - Nested radius = parent radius − padding. Replace the current `--radius: 0.7rem` calc multipliers with explicit `--radius-xs/sm/md/lg`.
- **Elevation (light):**
  - `--shadow-hairline: 0 0 0 1px oklch(0.2 0.02 165 / .07)`
  - `--shadow-sm`: hairline + `0 1px 2px /.04`
  - `--shadow-md`: hairline + `0 2px 4px /.04, 0 8px 16px -4px /.06` (popover, menu)
  - `--shadow-lg`: hairline + `0 8px 16px -4px /.06, 0 24px 40px -8px /.10` (dialog, palette, dragged widget)
  - **Dark:** no shadows on resting surfaces, only a surface step plus a hairline. Floating layers get `0 8px 24px oklch(0 0 0/.35)` (md) or `0 16px 48px /.5` (lg).
  - Cards sit flat on `--bg` with the hairline. Shadows mean "floating", nothing else.
- **Spacing (4px base):** `0 2 4 6 8 12 16 20 24 32 40 48 64`.
  - Card padding: 16 dense, 20 default. Grid gap: 16. Section gap: 32.
  - Page gutter: 24 desktop, 16 mobile. Max content width: 1440.
- **Sizes:**
  - Controls: 28 (toolbar and table), 32 (default), 36 (forms and dialogs). Mobile hit targets ≥ 44.
  - Table rows: 36 compact, 44 comfortable.
  - Sidebar: 240 expanded (resizable 200–320) or a 48 icon rail. Sidebar item: 30. Page header: 52.
- **Icons:** Lucide at 16px with `strokeWidth={1.75}`. Nav icons use `--fg-faint` and become `--fg` when active.

### 2.4 Motion

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);    /* enter and exit */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* movement on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--dur-instant: 100ms;  /* press, hover colour */
--dur-fast:    150ms;  /* tooltip, small popover, row hover */
--dur-base:    200ms;  /* dropdown, segmented thumb, tab indicator */
--dur-slow:    280ms;  /* dialog, sheet, widget reorder */
--dur-drawer:  420ms;  /* mobile drawers only */
--stagger:     40ms;   /* first paint only, max 8 items */
```

Recipes:
- Buttons: `:active scale(.97)`.
- Popovers: from `scale(.96)` + opacity 0 at the trigger origin (Base UI `--transform-origin`).
- Dialogs: `scale(.98)` + fade.
- Chart first draw: a 400ms clip reveal, on first load only. Time series use `animationMatchBy={matchByDataKey('date')}`.
- KPI changes: an in-house `<CountUp>` (about 500ms, formats through `money.ts`).
- Route changes: React `<ViewTransition>` crossfades for same-route changes and a contact avatar morph for list → record.
- **Never:** `transition: all`, ease-in on UI, motion over 300ms (drawers aside), or animation on keyboard-triggered surfaces (the ⌘K palette opens instantly, and J/K moves are instant).
- **Reduced motion:** keep opacity changes, drop transforms, count-ups and chart tweens. Add a "Reduce motion" override under Settings → Account → Appearance.

### 2.5 Component treatments

**Sidebar** *(Linear dimming, Supabase collapse and lock, Clerk switcher, Vercel resizable)*
- `--bg-subtle` background, one step dimmer than the content. Inactive labels use `--fg-muted` 13/400. The active item gets a `--fill-active` background and weight 500, with no accent bar.
- **Top:** a workspace switcher (initial avatar + name + chevron). The dropdown has a searchable list with ⌘1–9 hints, "All clients" roll-up (agencies), "Create workspace…", and badges for pending invites or broken connections. Below it, a full-width "Search ⌘K" button.
- **Bottom:**
  - A Setup progress ring (hidden once setup is complete)
  - A Live pulse dot showing today's revenue in mono
  - Settings
  - Help & shortcuts (`?`)
  - User menu (theme, density, sign out)
- `[` toggles the icon rail. A lock pin keeps the chosen state, stored in a cookie.

**Page header** *(Linear consistent header bar, 52px everywhere)*
- **Left:** breadcrumb or title (16/600).
- **Right:** the global filter bar, then a "…" overflow (Export, Copy link, Save view…).
- An optional tab row below uses compact pills: 28px high, 6px radius, active = `--fill-active` + ink.
- The demo banner becomes a dismissible pill in the header.
- A 2px `--accent` progress line runs along the bottom edge while a transition is pending.

**Filter bar** *(Stripe range + compare, Plausible chips, Metabase linked filters)*, in this fixed order:
1. **Date**: Today, Yesterday, 7d, 14d, 30d, 90d, MTD, Last month, QTD, YTD, Custom (using the `react-day-picker` already installed)
2. **Compare**: Previous period (default), Previous year, None, plus a "Match weekday" option
3. **Model**: segmented Last / First / Linear (more models later)
4. **Platform**: multi-select with logos
5. **+ Filter**: campaign, UTM, landing page, stage, segment
6. **Views ▾**

Active filters appear as removable chips, e.g. `Platform is Meta ×`. Everything lives in the URL. On phones it collapses to one "Last 30 days · vs prev · Linear ▾" button that opens a bottom drawer.

**KPI tile** *(Triple Whale tile + pin, Stripe prev value, Plausible click-to-chart, Looker/Databox goal progress)*

```
┌──────────────────────────────┐  124px high, 8px radius, 16px padding
│ ROAS  ⓘ               📌  ⋯ │  label 12/500 muted · ⓘ = metric definition · pin/menu on hover
│ 3.25×                        │  24/600 tabular (32 when hero)
│ ▲ 12.4%  was 2.89×           │  delta coloured by polarity + previous value
│ ╱╲_╱‾‾╲_╱‾ ‥‥‥‥              │  24×80 server-rendered SVG sparkline, dashed comparison
│ ▓▓▓▓▓▓▓░░ 72% of 4.5× target │  only when a target exists; stoplight dot at top-right
└──────────────────────────────┘
```

- Clicking the tile makes its metric the series of the Metric explorer chart. Clicking the label drills into the report.
- Sparklines are server-generated SVG paths, with no Recharts and no JavaScript.

**Chart card** *(Stripe fixed heights and states)*
- Header (48px): title 16/600, then the big value and delta, with a chart-type/interval/"⋯" menu on the right.
- Body: a fixed 280px plot on medium widgets and 320px on large or full width. The **same height in loading, empty, error and data states.**
- Behaviour:
  - Crosshair tooltip lists every series, the comparison value and Δ%.
  - `syncId` shares the crosshair across charts on a page.
  - Clicking a legend item toggles that series.
  - Drag across the chart to zoom, which sets the page date range.
  - The incomplete last day or week is drawn dashed.
  - A dashed, lower-opacity line of the same hue shows the comparison period.
  - Reference lines mark ROAS break-even (1.0×) and the target.
  - Annotation markers sit on the x-axis.
- Below-the-fold charts load with `next/dynamic`.

**Table** *(Attio table, Northbeam stoplights, PostHog cell deltas)*
- Sticky header and first column. Text left-aligned, numbers right-aligned and tabular. Header 12/500 muted in sentence case. No zebra stripes, only `divide-y` hairlines.
- Rows: hover `--fill`. Selected rows get `--accent-soft` plus a 2px inset accent on the left.
- Cells:
  - Small Δ% under the value when Compare is on
  - A 3px ROAS bar behind the number, scaled to the column max with a cap
  - Optional stoplight dot against the target
- A totals row is pinned at the bottom. The footer row can show calculations (Σ, avg, median).
- The **Display** popover holds the column picker (drag to reorder), density, group-by and column presets.
- Checkbox selection opens a floating **bulk bar docked at the bottom centre**.
- `content-visibility: auto` on rows. The table and its mobile-card version render from one component, not two DOM trees.

**Record page:** see §4.5. The same `<ContactPanel>` renders in the preview Sheet and as the full page.

**Empty, loading and error states** *(Linear/Notion empty states, Vercel skeleton timing)*
- **Empty:** icon (not an illustration) + one headline + one line of why + a primary and a secondary action + the relevant shortcut. Example: "No ad spend yet. Connect Meta or Google to see which ads make money. [Connect ads] [Load demo data]".
- **Filtered-empty:** shows the active chips and "Clear filters".
- **Loading:** skeletons only on a cold load. They appear after 200ms, stay at least 400ms, show real labels with blank values, and use a slow 1.6s low-contrast shimmer (off under reduced motion). Refetches dim the old content to 60% with `aria-busy`.
- **Errors:** inline in the card, with Retry. Toasts (sonner) only for async results and Undo. Mobile toasts sit bottom-centre above the tab bar.

---

## 3. Information architecture

### 3.1 Sidebar (new groups)

```
[Workspace switcher ▾]
[🔍 Search…        ⌘K]

  Overview                   G O
  Live            ● 3        G V   (pulse + visitors-now count)

ANALYZE
  Performance                G P   tabs: Campaigns · Ad sets · Ads · Creatives
  Attribution                G A   tabs: Models · Paths · Time to convert
  Customers                  G R   tabs: LTV & cohorts · New vs returning
  Insights        •          G I   tabs: Reports · Ask · Alerts

CRM
  Contacts                   G C
  Pipeline                   G D
  My tasks        2          G T   (overdue badge)

VIEWS                                 (saved views pinned by the user, max 8)
  ★ High-value customers
  ★ Meta · last 30d

──────────
  ◔ Setup 4/6                        (until complete)
  Settings                   G S
  Help & shortcuts           ?
  [avatar] You ▾
```

### 3.2 Page list and what moves where

| Route | Page | Change |
|---|---|---|
| `/` | Overview | Rebuilt as a widget board |
| `/live` | Live | **New** |
| `/performance` (+ `?level=`) | Performance | Redesigned. New `/performance/creatives` tab (Phase 5) |
| `/attribution` | Attribution | **Moved from** `/reports/models`, which permanently redirects |
| `/customers` | Customers | **Moved from** `/reports/ltv`, which redirects |
| `/insights` | Insights | Adds Ask and Alerts tabs |
| `/contacts`, `/contacts/[id]` | Contacts | Moves from "Reports" to "CRM" |
| `/pipeline` | Pipeline | **New** kanban |
| `/tasks` | My tasks | **New** |
| `/settings/*` | Settings | Regrouped (§4.7). Setup checklist moves to the sidebar progress ring and `/settings/setup` |
| `/share/[token]` | Shared view | **New** read-only client view (Phase 6) |

Mobile bottom tab bar (floating, translucent, hides on scroll down): **Overview · Performance · Live · Contacts · More**. More opens a drawer with everything else plus workspace switching. Search sits in the mobile header.

### 3.3 Command palette (⌘K / Ctrl K)

Built on Base UI Autocomplete inside a Base UI Dialog, following the official command-palette recipe in `@base-ui/react` 1.8. **No `cmdk`**: it would add a second dialog system. The palette is full-screen on phones.

Groups, reordered by the current page:
1. **Recent** (last 5 records and pages).
2. **Navigate:** every page, tab and settings section (fuzzy: "email templ", "pixel").
3. **Search:** contacts by name or email, campaigns, ad sets, ads and saved views, through `POST /api/v1/search`. The query goes in the body so emails never land in logs. The route is `guard`ed and scoped to the workspace.
4. **Actions:**
   - Date presets, Compare to…, Attribution model: Linear (typing "linear" finds it)
   - Switch workspace, Sync now, Copy pixel snippet
   - Export this view, Save view…
   - New note / task on the focused contact, Customize Overview
   - Toggle theme, Invite teammate
5. **Ask AI:** typing `?` sends the question to Insights → Ask. Typing `>` narrows to actions only.

Every row shows its shortcut on the right. When a table row is focused, ⌘K first shows that row's actions: Open, Open journey, Copy UTM, Open in Meta Ads, Add to segment.

### 3.4 Keyboard shortcuts

All shortcuts come from one registry in `src/lib/hotkeys.ts` (about 60 lines, no dependency). It ignores key presses inside inputs, supports two-key sequences within 1 second, and uses `event.key`. The `?` sheet is generated from the registry.

| Keys | Action |
|---|---|
| ⌘K / Ctrl K | Command palette |
| ? | Shortcut sheet |
| G then O / V / P / A / R / I / C / D / T / S | Overview / Live / Performance / Attribution / Customers / Insights / Contacts / Pipeline / Tasks / Settings |
| / | Focus table search |
| F | Add filter |
| D | Date picker |
| X (on a report page) | Toggle compare |
| Shift [ / Shift ] | Previous / next date range (report pages) |
| [ | Toggle sidebar |
| E | Edit layout (Overview) |
| J / K | Next / previous row (table) or record (record page) |
| Enter / O | Open row · Space: peek (preview sheet) |
| X (in a table) | Select row · Shift X: select range · Esc: clear or close |
| N / T | New note / task on the focused contact |
| ⌘1–9 | Switch workspace |

---

## 4. Page-by-page redesign

### 4.1 Overview: a customizable widget board

*Inspired by Triple Whale Summary (pinned strip, sections, pin on hover, edit mode), Shopify (library drawer, sections, per-user, reset), Stripe (add/edit widgets, compare dropdown, fixed heights), Plausible (click a tile to drive the chart), PostHog (tiles refresh independently).*

**Page anatomy (desktop):**
1. Page header + filter bar.
2. **Briefing line** (text-body, one sentence). It is filled from a template and `reports.ts` numbers, not by the LLM. Example: "*Meta · Spring Sale* made the most profit this week: ₹1.2L back on ₹30k spend. ROAS is up 12% vs last week." It links to the campaign.
3. **Pinned strip:** up to 6 KPI tiles in one row (`repeat(auto-fit, minmax(180px,1fr))`). The first pinned tile can be marked "hero" (32px value).
4. **Sections:** named, collapsible, reorderable groups such as "Acquisition", "Revenue", "CRM". Each is a 12-column CSS grid.

**Layout model.** CSS grid spans with fixed size presets, not free pixel positioning. It can't turn ugly, it has no absolute-positioning maths, and it works with server components.

```ts
// src/lib/dashboard/layout.ts (zod-validated on read; unknown types render a "Widget unavailable" card)
type Layout = {
  v: 1;
  pinned: WidgetInstance[];              // KPI widgets only, max 6
  sections: { id: string; title: string; collapsed: boolean; items: WidgetInstance[] }[];
};
type WidgetInstance = {
  id: string;
  type: WidgetType;                      // e.g. "kpi.roas", "chart.spendRevenue"
  size: "s" | "m" | "l" | "xl";          // s=3/12, m=6/12, l=8/12, xl=12/12
  settings?: {
    title?: string; metric?: MetricKey; variant?: "line" | "bar" | "table";
    range?: RangePreset;                 // tile override beats the page range (PostHog)
    compare?: boolean; platforms?: string[]; topN?: number;
  };
};
```

- **Breakpoints:** ≥1280 → 12 columns. 768–1279 → 6 columns (s becomes 3, m and l become 6, xl becomes 6). <768 → one column in order, with KPIs in a 2-up grid.
- **Heights per widget type:** KPI 124px. Standard card 380px (48 header + 300 body + padding). Tall card 520px (cohort grid, funnel). Rows align.
- **Allowed sizes per widget** come from the widget registry. KPIs are s only. Charts are m, l or xl. Lists are m or l.
- **Rendering:** every widget is its own async server component inside its own `<Suspense>`, with a skeleton of the same size. Shared inputs (session, period, campaign rows) come from `React.cache` helpers, so the KPIs paint first and a slow cohort query never blocks them.

**Widget registry** (`src/lib/widgets/registry.ts`): type → `{ title, category, description, allowedSizes, defaultSize, settingsSchema, component, availableFrom }`. The palette, the library drawer, presets and email digests all read from it.

**Metric registry** (`src/lib/metrics.ts`): one entry per metric with label, plain-language definition, format, polarity, SQL key and the `reports*.ts` function that computes it. It feeds the ⓘ popovers, KPI tiles, table columns, alert rules, Performance column presets and the MCP tool descriptions *(Triple Whale Metrics Library)*. The LLM never computes numbers.

**Edit mode** (the "Customize" button or `E`):
- A sticky toolbar: "Editing · Personal view" · + Add widget · Add section · Reset to ▾ (preset / workspace default) · Cancel · Save.
- Widgets show a drag handle, a size menu (only allowed sizes) and a ✕. Sections can be renamed, dragged and deleted.
- Reordering uses `@dnd-kit/sortable`, loaded only in edit mode. It is keyboard accessible: space to lift, arrows to move.
- **"+ Add widget" drawer** (right-hand Sheet, 400px): searchable, grouped (KPIs, Charts, Lists, CRM, Utility), with a preview thumbnail and one-line description. Widgets already on the board are greyed out, except multi-instance ones (Note, Metric explorer).
- Outside edit mode, the 📌 on a KPI tile pins it to or unpins it from the strip instantly (optimistic, with an Undo toast).
- On mobile, edit mode becomes a reorder list with ↑ / ↓ and a remove button. No resizing.

**Scope and persistence:**
- New table `dashboards(id, workspace_id, user_id null, name, preset, layout jsonb, version, updated_at)`, unique on `(workspace_id, user_id)`.
- `user_id null` is the **workspace default** (editable with `workspace.settings`). It is what new members, share links and digests see.
- Anyone can save a **personal override**, shown with a "Personal view · Reset to workspace default" badge.
- Filters are temporary until saved as a view *(Mixpanel)*. Changing the date never changes the layout.
- Server actions use `guard("dashboard.edit")` + `audit()`.

**Widget catalog (top 24).** "Source" is an existing function or **new SQL** in a `reports*.ts` file. "Phase" is when the widget first becomes available.

| # | Widget | Type · sizes | What it shows | Source | Phase |
|---|---|---|---|---|---|
| 1 | Revenue | KPI · s | Total or attributed (toggle), Δ, sparkline | `overview` + `timeseries` | 1 |
| 2 | Ad spend | KPI · s | Spend, neutral polarity | `overview` + `timeseries` | 1 |
| 3 | ROAS | KPI · s | Attributed ROAS, blended sub-line, target bar | `overview` | 1 |
| 4 | MER | KPI · s | All revenue ÷ all spend *(Triple Whale, Northbeam)* | `overview.blendedRoas` | 1 |
| 5 | Leads · CPL | KPI · s | Leads with cost per lead | `overview` | 1 |
| 6 | Customers · CAC | KPI · s | CAC: down is good | `overview` | 1 |
| 7 | Unattributed share | KPI · s | Revenue with no ad touch, with a "why" tooltip | `overview` | 1 |
| 8 | Metric explorer | Chart · l/xl | Big line driven by whichever KPI tile was clicked *(Plausible)* | `timeseries` (extended to all KPIs) | 1 |
| 9 | Spend vs revenue | Chart · m/l/xl | Spend bars + revenue line + dashed comparison, day/week/month | `timeseries` | 1 |
| 10 | Revenue by channel | Chart · m | Horizontal bars with spend and ROAS per channel, click to filter | `channels` | 1 |
| 11 | Top campaigns | List · m/l | Ranked by revenue / ROAS / profit / worst (toggle), capped ROAS bar, drill down | `performance` | 1 |
| 12 | Wasted spend | List · m | Spend with ROAS < 0.5, with "too early to judge" when the campaign is younger than the median time to convert | `wastedSpend` (derived from campaign rows) | 1 |
| 13 | Platform scorecard | List · m | Logo, spend, revenue, ROAS, Δ, share of spend | `platforms` | 1 |
| 14 | Recent leads & customers | CRM · m | Avatar, masked email, source badge, amount, time; opens the preview | `listContacts` | 1 |
| 15 | AI insight | Utility · m/l | Three highlight bullets with number chips, "Open report" | `ai_reports` | 1 |
| 16 | New-customer ROAS (NC-ROAS) | KPI · s | First-payment revenue ÷ spend *(Triple Whale)* | **new** | 2 |
| 17 | Profit | KPI · s | Revenue − refunds − spend (COGS later) | **new** | 2 |
| 18 | AOV | KPI · s | Revenue ÷ orders | **new** | 2 |
| 19 | Spend by platform | Chart · m/l | Stacked area over time | **new** (`timeseries` by platform) | 2 |
| 20 | Campaign quadrant | Chart · m/l | Scatter: x = spend, y = ROAS, size = revenue, split at target into Scale / Fix / Kill / Test | `performance` | 2 |
| 21 | Live now | Utility · m | Visitors in the last 5 minutes, conversions ticker, today's spend vs revenue | **new** `reports-live.ts` | 2 |
| 22 | Goals & pacing | Utility · m | MTD vs target and budget, projected month end, on-pace badge *(Polar, AgencyAnalytics)* | **new** `goals` | 2 |
| 23 | Funnel | Chart · l/xl | Visits → leads → customers → revenue, step %, comparison ghost bars; click a step to open Contacts *(PostHog funnels)* | **new** | 5 |
| 24 | Conversions heatmap | Chart · m | Weekday × hour of leads and payments, in workspace timezone | **new** | 5 |

Later catalog entries: Top creatives, LTV cohort mini, Time to convert, Top landing pages / UTM, Model disagreement, Data health, Note (markdown), Geography.

**Presets** (chosen in onboarding by business type, switchable any time):
- **Minimal** (default for fresh workspaces; avoids a wall of zeros)
  - Pinned: Revenue, Spend, ROAS, Customers·CAC
  - Sections: Spend vs revenue (xl), Top campaigns, AI insight
- **E-commerce**
  - Pinned: Revenue, Spend, MER, NC-ROAS, AOV, Profit
  - Sections: Metric explorer, Spend by platform, Campaign quadrant, Top campaigns, Wasted spend, Live now, AI insight
- **Lead gen / local business**
  - Pinned: Spend, Leads·CPL, Customers·CAC, Revenue
  - Sections: Funnel, Recent leads, Conversions heatmap, Top campaigns (sorted by CPL), Goals & pacing
- **SaaS**
  - Pinned: Spend, Leads·CPL, Customers·CAC, Revenue, ROAS
  - Sections: Funnel, Metric explorer, Revenue by channel, AI insight
- **Agency**
  - Pinned: Spend, Revenue, ROAS, Leads·CPL
  - Sections: Platform scorecard, Goals & pacing, Top campaigns, Wasted spend, Spend vs revenue
  - Plus "Copy layout to other workspaces"

**Mobile:**
- Briefing line, then the pinned strip as a 2-up grid of compact tiles (96px, no sparkline).
- Sections become accordions with only the first open.
- Charts use full width at 220px height, with tap-to-show tooltips.
- Pull to refresh in the installed PWA.
- Target: the first screen answers "how am I doing?" with no scrolling.

### 4.2 Live (new)

*Inspired by Plausible Realtime, Shopify Live View, AnyTrack live conversion feed. This is also the answer to "I want to see live changes happening in the browser".*

- **Transport:** `GET /api/v1/live` streams Server-Sent Events from the existing Node process.
  - `src/lib/live.ts` holds an in-memory per-workspace `EventEmitter`, fed by `processCollect`, the lead and revenue webhooks, and `jobs.ts` (sync finished, attribution done).
  - The browser uses its built-in `EventSource`, which reconnects automatically. The stream pauses when the tab is hidden.
  - Payloads carry counts, IDs, amounts and masked labels only, never raw email or phone.
  - Multi-instance fallback: Postgres `LISTEN/NOTIFY`. No new service, no new env var.
- **Page:**
  - Big counters: visitors now (5 min), visits today, leads today, revenue today (`<CountUp>`).
  - A 30-minute visitors sparkline refreshed by events.
  - **Live feed:** "Visitor from Google · Search–Brand landed on /pricing", "Lead a•••@gmail.com via Meta · UGC v3", "Payment ₹4,999 · Stripe · first touch Meta". New rows slide in over 200ms.
  - A top-pages-right-now list.
  - **Streamer mode** (masks amounts, *Shopify*).
- **Everywhere else:**
  - A pulse dot and today's revenue in the sidebar.
  - When the data version changes, Overview and Contacts show "3 new · refresh" pills, or refresh automatically (debounced to at most every 15s) when the user has turned on "Auto-refresh".
  - Optional toasts: "New sale ₹4,999 from Meta".
  - Milestone moments ("Best revenue day this month") go to the notify channels *(Triple Whale push milestones)*.
- **Mobile:** counters stack, then the feed. Installable PWA with a manifest shortcut to Live.

### 4.3 Performance (Ads)

*Inspired by Northbeam (stoplights vs targets, saved role views, overlay up to 6 ads), Cometly (one Ads-Manager-style table), Triple Whale Creative Cockpit, Hyros (LTV-inclusive columns, drill to journeys).*

- **Tabs:** Campaigns · Ad sets · Ads · Creatives. The breadcrumb drill-down stays. Clicking a row name drills down. **Space or the row's ⋯ opens a peek Sheet** with a mini chart, funnel, top contacts and "Open in Meta Ads". The URL gets `?peek=`, so Back closes it.
- **Column presets** in the Display popover *(Hyros, Polar templates)*:
  - **E-commerce:** Spend, Purchases, Revenue, ROAS, NC-ROAS, AOV
  - **Lead gen:** Spend, Leads, CPL, Qualified, Call booked, Customers, CAC
  - **Creative:** Spend, Impr, CPM, CTR, CPC, CVR, ROAS
  - **Full:** everything
  - Custom column sets save with the view.
- **New columns** (data already stored):
  - Status pill
  - Impressions, CPM, CPC, CTR (always available)
  - Lead → customer rate, AOV
  - Δ vs comparison under each value
  - 14-day SVG sparkline
  - **Platform-reported vs AdLedger conversions, with a gap %** ("Meta claims 94, we verified 41")
  - Click-to-visit match rate (tracking health)
  - First-touch vs last-touch revenue side by side
  - Cost per stage (Phase 4)
- **Stoplights** *(Northbeam)*: workspace targets for ROAS, CAC, CPL and MER (new `goals` table) colour a dot in each cell green, amber or red, with the label in a tooltip.
- **Honest formatting:** "—" instead of "0x", whole customer counts with decimals in the tooltip, and a ROAS bar capped at 2× the target.
- **Chart toggle** above the table: "Table · Quadrant · Trend". Trend overlays up to 6 selected rows on one line chart *(Northbeam)*.
- **Filters:** name, status, numeric (Spend > X, ROAS < 1), objective, ad account. Saved views are shared or personal and can be pinned to the sidebar.
- **Creatives tab** (Phase 5, needs thumbnails):
  - Card grid with thumbnail, name, spend, ROAS, CTR, CPM, hook rate for video, and a heat-scaled background on the sorted metric.
  - Card / Bar / Line views. Select up to 6 to overlay *(Triple Whale Creative Cockpit)*.
  - Until connectors supply thumbnails, the tab groups by ad name / `utm_content` with a platform-logo placeholder.
- **Mobile:** each row is a card (name, status, spend, revenue, ROAS, stoplight). Sort and filter live in a drawer, and a "Table view" toggle is there for power users.

### 4.4 Attribution (Models)

*Inspired by Northbeam (global model, window and accounting pickers, model comparison), Rockerbox (Marketing Paths), Wicked Reports (Sales Velocity), Triple Whale (models dropdown).*

- **Models tab:**
  - KPIs: "Credit that moves between models: ₹46.6K (37%)", Journey starters, Journey closers, Avg touches to convert. This replaces the uninformative "Linear ROAS = first = last" tile.
  - A **dumbbell chart** per campaign (one dot per model, the line shows the disagreement) above the existing wide table.
  - Role pills (Starter / Closer / Assist) stay. Adds ad set level.
- **Paths tab** (new): the most common channel sequences for new vs returning converters, with count, revenue, median days and touches.
- **Time to convert tab** (new):
  - Histograms of first touch → lead, lead → payment and first touch → payment, bucketed 0–1d, 1–7, 7–14, 14–30, 30+.
  - Touches-to-convert and cross-device share.
  - A **recommended attribution window** ("90% of customers buy within 21 days, your window is 7") with a one-click link to the setting.
- **Later (Phase 6+):** position-based (40/20/40) and time-decay models as extra `attribution_credits.model` values computed by the existing attribution job. A per-query window override stays out of scope until on-read attribution is designed.
- **Mobile:** the dumbbell list replaces the wide table. Paths show as stacked chip rows.

### 4.5 Customers (LTV & cohorts)

*Inspired by Triple Whale cohorts, Lifetimely CAC payback marker, SegMetrics LTV at fixed day marks, Northbeam new vs returning.*

- **KPIs:** New customers, Avg LTV, **LTV at 30/60/90/365 days**, Repeat rate, **CAC payback (months)**, Refund rate, Paid LTV:CAC.
- **Cohort heatmap:** rows are first-purchase month (or week for D2C). Columns are months since. A toggle switches between **Retention % / Cumulative LTV / Incremental revenue**. A **green marker where the cohort passes CAC** *(Lifetimely)*. Empty months show as empty rows instead of disappearing.
- **LTV curve chart** with cohorts overlaid and a CAC reference line.
- **New vs returning tab:** revenue and customers split by first vs repeat payment over time, NC-ROAS and nCAC.
- **LTV by acquisition:** LTV, payback, repeat rate and refund rate by first channel, platform, campaign, landing page and `utm_content`. Clicking a row opens Contacts filtered to that cohort.
- **Mobile:** the heatmap scrolls horizontally with a sticky first column. KPIs show 2-up.

### 4.6 CRM: Contacts, record page, Pipeline, Notes & Tasks

*Inspired by Attio (filters, split save button, Display, footer calculations, bottom bulk bar, record highlights, 2026 timeline), Close (smart views in the sidebar, j/k), Twenty (view picker, group-by), HubSpot (3-column record layout, preview sidebar), Pipedrive (rotting, weighted value), Folk (duplicates view).*

**Foundation (required for speed):**
- Fix `listContacts` to paginate IDs first and then enrich. It currently takes 14–34s.
- Add a `contact_stats` roll-up (revenue_minor, orders, refunds_minor, touches, first/last touch, last_seen_at, converted_at, days_to_convert, engagement score) kept up to date by the attribution job.
- Keyset paging on `(first_seen_at, id)`. Sorting and filtering by revenue stays index-backed at 100k contacts.

**Contacts table:**
- **View tabs** across the top. Starters:
  - All · New leads (7d) · Customers · High-value · Leads with no payment after 14d · Came from Meta · Refunded
  - "+ View" adds another.
  - A changed view shows a **split Save: Save for everyone / Save as new view / Discard** *(Attio)*. ★ pins a view to the sidebar *(Close/Twenty)*.
- **Filter chips:** attribute → operator → value, with AND/OR groups. Fields:
  - stage, lifecycle, tags, owner
  - first- and last-touch channel, platform, campaign, ad
  - attributed revenue (per model), has payment, has refund
  - lead form
  - first seen / converted (relative dates)
  - touches, days to convert
  - segment
- **Display popover:** columns (drag to reorder), density, group-by (for example by first-touch platform, with group subtotals, ≤15 groups).
- **Columns:**
  - Name + masked email, Stage, Tags, Owner
  - First touch (logo + campaign), Last touch, Touches, Days to convert
  - First seen, Last seen, Lead form
  - Net revenue, Orders, AOV, Refunds
  - Engagement (0–100 pill, with "heating up" when the 7-day score ≥ 2× the 30-day score)
- **Footer calculations** that respect the filter: Σ revenue, avg LTV, count, median days to convert. Computed by SQL in `reports-crm.ts`.
- **Bulk bar** (bottom centre on selection): "N selected · Stage ▾ · Tag · Owner · Add to segment · Export · More ▾ (Delete, with confirmation)".
- **Inline edit** of name, stage, tags and owner (Enter saves, arrow keys move), optimistic with Undo.
- **Live pill:** "3 new contacts ↑" appears when leads arrive.
- **Row behaviour:** clicking a row opens the **preview Sheet** (Space). Enter or O opens the full page, and J/K move between rows.

**Contact record page** (the same `<ContactPanel>` as the preview):

```
Contacts / High-value customers                       ‹ 12 of 340 ›   [Add note N] [Task T] [⋯]
[Avatar] Priya Sharma · p•••@gmail.com · [Stage: Qualified ▾] · #wholesale + · Owner: Ravi ▾
HIGHLIGHTS (6 tiles): Net revenue · Orders · First touch (Meta · Spring Sale) · Days to convert · Touches · Last seen
┌ PROPERTIES (inline edit) ┬ Activity | Journey | Attribution | Payments | Notes & tasks ──────────┐
│ Email, phone, stage,     │ Activity: unified timeline, filter chips [Ad clicks][Page views][Forms] │
│ owner, tags, first/last  │ [Payments][Refunds][Stage][Notes][Tasks]; sticky day headers; runs of  │
│ touch, UTMs, devices,    │ page views collapsed ("6 page views on /pricing ▸"); calls and         │
│ lead form, segments,     │ WhatsApp clicks from `events`. Chip choice remembered per user.        │
│ external IDs, company    │ Journey: first click → lead → customer path visual with ad names.      │
│ (from email domain)      │ Attribution: "Who gets the credit?" per model (exists).                │
│                          │ Payments: ledger with refunds netted.                                  │
└──────────────────────────┴────────────────────────────────────────────────────────────────────────┘
```

- On mobile: header, highlights in a 2×3 grid, tabs as a scrollable pill row, properties in a collapsible section, and the quick actions (note, task, stage) in a bottom action bar.

**Pipeline (justified: stages become conversion events in attribution):**
- Workspace-configurable stages replace the binary lifecycle. Default: *New lead → Qualified → Call booked → Proposal → Won → Lost*, each with a kind (open/won/lost), `rot_days` and win probability. `lifecycle` stays as a derived value for backwards compatibility.
- The first payment moves a contact to Won automatically.
- Every change writes `contact_stage_events` and goes through `audit()`.
- **Kanban** (`@dnd-kit`):
  - Column header shows count · Σ attributed revenue · weighted value · rotting count.
  - Cards show name, first-touch logo + campaign, value, and days in stage (red once past `rot_days`, *Pipedrive*).
  - Multi-select drag, collapsible stages, an optimistic drop with an Undo toast.
- **The payoff:** Performance gains **Cost per Qualified / per Call booked** columns per campaign, ad set and ad *(Hyros stages, Cometly cost per opportunity)*. Stage changes sent back to ad platforms as offline conversions are a future *write* action and default to off.
- **Mobile:** stages become a horizontal tab strip of lists. Moving a contact uses the stage pill instead of dragging.

**Notes & tasks:**
- `contact_notes` holds a markdown body, author and a pinned flag. `tasks` holds title, due date, assignee, contact and done_at.
- Both show inline in the Activity timeline. **My tasks** (`/tasks`) groups tasks as Overdue / Today / Upcoming / Done. The sidebar badge counts overdue tasks.
- N and T create a note or task from anywhere a contact is in focus.
- No email sending (out of scope per PRODUCT.md).

**Import & hygiene (Phase 4):**
- A 3-step CSV import: upload → map (auto-guess) → preview "124 new · 38 update · 3 invalid" → run as a job. Dedupe on `email_hash` / `phone_hash`.
- A **Duplicates** view. A side-by-side merge dialog re-points visitors, leads and revenue and then re-runs attribution.

**Segments:** a saved view marked "Use as segment". It becomes a Segment filter on Performance, Customers and Overview ("which campaigns bring high-LTV customers"), a hashed-email CSV export in Meta/Google audience format, and a read-only MCP tool `list_segment_members`.

### 4.7 Insights

*Inspired by Cometly (action-shaped recommendations), Triple Whale Moby and Attio Ask (chat with a model picker), Polar and Triple Whale Lighthouse (threshold and anomaly alerts).*

- **Reports tab:** the weekly report becomes a document with **number chips** that link to the exact row they cite, inline mini-charts from the widget registry, and a visible "All numbers verified" badge (verification already exists).
  - Top section: **3–5 action cards**, e.g. "Shift ₹5k/week from *Search – Generic* (ROAS 0.8×) to *Meta – UGC v3* (3.4×)", with the evidence numbers and a "View in Performance" link.
  - Cards are read-only recommendations. No write actions.
- **Ask tab:** chat with the BYO model. It calls the existing read-only report/MCP functions, and answers render tables and chips from `reports*.ts` output, so the LLM never produces a number itself. "Ask about this view" from ⌘K sends the current view's aggregates, never rows or PII.
- **Alerts tab:**
  - A rule builder: metric (from the metric registry) × condition × duration × scope, e.g. "CAC > ₹800 for 2 days on Meta".
  - Automatic z-score anomalies on the main KPIs.
  - An alert history feed.
  - Delivery through the existing notify channels. Evaluation runs in `jobs.ts`.
- **Mobile:** action cards stack. Ask opens as a full-screen drawer.

### 4.8 Settings

Keep every existing screen and regroup them under one left-hand settings nav (a horizontal scrolling pill row on mobile).

| Group | Items |
|---|---|
| Workspace | General (name, currency, timezone, attribution window) · **Targets & goals** (new) · **Pipeline stages** (new) · **Dashboard default** (new: preset, copy to other workspaces) |
| Data | Integrations · Tracking & pixel · Import · **Data health** (new: sync freshness per connection, `sync_runs` success, pixel events per hour, CAPI sent/failed, identity stitch rate) |
| Automation | Notifications · **Alerts** (links to Insights → Alerts) · **Scheduled reports** (new) |
| AI & API | AI model · API keys & MCP |
| Team | Members · Audit log |
| Organization | Organization settings, all-clients defaults |
| Account | Profile · **Appearance** (theme, density, reduce motion) · Sessions |

The Setup checklist becomes `/settings/setup` plus the sidebar progress ring. Onboarding adds the business-type preset picker (E-commerce / Lead gen / SaaS / Agency).

---

## 5. New functionality

Schema note: every new table carries `workspace_id`, which the existing test enforces. Money stays in `*_minor bigint` + currency. All numbers come from `reports*.ts`.

| Feature | User value | Effort | Schema changes | New deps | Phase |
|---|---|---|---|---|---|
| Quiet Ledger tokens, type, motion | Modern, premium look everywhere at once | M | none | none | 1 |
| App shell: dim sidebar, groups, switcher, page header, filter bar with date presets + compare | Consistent, calm navigation; "vs last year" | M | none | none | 1 |
| ⌘K palette + hotkeys + `?` sheet | Fast for power users, discoverable for everyone | M | none | none (Base UI Autocomplete) | 1 |
| Speed floor: `React.cache`, `dataBounds` rewrite, Overview dedupe, Suspense per widget, fixed contacts query | Pages paint in under a second; contacts page goes from 15s to under 1s | M | indexes: `contacts(workspace_id, first_seen_at desc, id)`, `touchpoints(visitor_id, occurred_at)` | none | 1 |
| Metric registry + ⓘ definitions | Plain-language trust | S | none | none | 1 |
| Customizable Overview (widget registry, presets, edit mode, pin) | "My five numbers first" | L | `dashboards` | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | 1 |
| Briefing sentence + KPI sparklines + previous values | The answer before the chart | S | none | none | 1 |
| Instant model toggle (all models in one query) | No 900ms wait per toggle | S | none | none | 1 |
| Live channel (SSE) + Live page + live pills + sale toasts | Watch money arrive in real time | M | none | none | 2 |
| New stats: NC-ROAS, MER, Profit, AOV, refunds, new vs returning, spend by platform | Competitor-grade efficiency metrics | M | optional `revenue_events.is_first_payment` | none | 2 |
| Targets & stoplights + Goals & pacing widget | Numbers become progress | M | `goals` | none | 2 |
| Performance v2: column presets and chooser, Δ, sparklines, status, CPM/CPC, platform-reported gap, peek sheet, quadrant/trend | One table answers most questions | L | none | none | 2 |
| Saved views (Performance, Contacts) + sidebar pins | Customisation without clutter | M | `saved_views` | none | 2 (tables); reused in 3 |
| Contacts v2: `contact_stats`, keyset, filter chips, Display, footer totals, bulk bar, group-by | CRM that doubles as a report | L | `contact_stats` | none | 3 |
| Record page v2 + preview Sheet + J/K + unified timeline with page views and events | The journey becomes the hero | M | none | none | 3 |
| Tags, owner, inline edit (optimistic + Undo) | Basic CRM hygiene | S | `contacts.tags text[]`, `contacts.owner_user_id` | none | 3 |
| Notes & tasks + My tasks | Closes the loop for closers | M | `contact_notes`, `tasks` | none | 3 |
| Engagement score (SQL) | Prioritise hot leads, no AI numbers | S | column on `contact_stats` | none | 3 |
| Pipeline stages + kanban + stage events | Stages become attributable conversions | L | `pipeline_stages`, `contact_stage_events`, `contacts.stage_id` | reuses `@dnd-kit` | 4 |
| Cost per stage in Performance | "Cost per booked call" per ad | M | none | none | 4 |
| CSV import + duplicates + merge with re-attribution | Easy onboarding; fixes split journeys | M | none (uses existing `leads.source='csv'`) | none | 4 |
| Segments in reports + hashed audience export | "Which ads bring high-LTV buyers" + lookalike seed | M | `saved_views.is_segment` | none | 4 |
| Attribution v2: dumbbell, Paths, Time to convert, window recommendation | Understand journeys in aggregate | M | none | none | 5 |
| Customers v2: retention %, payback, LTV at day marks, curves, LTV by acquisition | Know when ads pay back | M | none | none | 5 |
| Annotations (manual + auto from sync diffs) | "Why did revenue dip?" answered on the chart | M | `annotations` | none | 5 |
| Creative data + Creatives tab | See which creative wins | L | `ads.thumbnail_url`, `ads.creative_type`, `ads.headline` (connector + mock updates) | none | 5 |
| Funnel + conversions heatmap widgets | Where leads drop; when to staff calls | S | index on `events(workspace_id, name, occurred_at)` | none | 5 |
| Alert rules + anomaly detection | Hear about problems before Monday | M | `alert_rules`, `alert_events` | none | 6 |
| Scheduled dashboard digests (email/Slack) | Report comes to you | M | `report_schedules` | none | 6 |
| Share links (password or public, locked filters) | Agency client view | M | `share_links` | none | 6 |
| Insights v2: action cards, number chips, Ask chat | AI that points at evidence | M | none (existing `ai_reports`) | none | 6 |
| Agency all-clients roll-up | One screen across clients | M | none | none | 6 |
| PWA polish: install entry, manifest shortcuts, pull to refresh | Feels like an app on the phone | S | none | none | 2 |

**Dependencies, justified:** one new family, `@dnd-kit` (core + sortable + utilities, MIT, about 15 KB gz).
- It powers both the widget board and the kanban with accessible keyboard and touch dragging. Native HTML5 drag-and-drop fails on touch and on accessibility.
- It is loaded only in edit mode and on `/pipeline`.
- Explicitly rejected: `cmdk` and `vaul` (they duplicate Base UI Dialog/Drawer), `react-grid-layout` (absolute positioning, heavier), `framer-motion` (CSS and `<ViewTransition>` are enough), TanStack Table (our tables already sort and group).
- `@tanstack/react-virtual` is allowed later only if profiling shows more than 1,000 visible rows.

---

## 6. Phased delivery plan

Every phase can be shipped on its own, keeps `docker compose up -d` unchanged (no new container, no required env var, migrations run automatically), and ends with `pnpm lint`, `pnpm typecheck`, `pnpm test` green and docs updated (`ARCHITECTURE.md`, `ROADMAP.md`). The owner can watch each phase take shape in the browser as it is built: `pnpm dev` at http://localhost:3000 hot-reloads every change, and a phone on the same Wi-Fi can follow along.

**Conflict rules for parallel work:**
1. New report SQL goes in **new files** (`reports-live.ts`, `reports-metrics.ts`, `reports-crm.ts`, `reports-analysis.ts`). Only Phase 1 touches `reports.ts` and `reports-advanced.ts`.
2. Schema changes are serialized. A branch that changes `schema.ts` rebases on main and regenerates its migration just before merge, and only one schema-changing branch merges at a time.
3. `globals.css`, `components/ui/*` and the app shell belong to Phase 1 and are frozen afterwards except for additive changes.

### Phase 1: the new look, shell and Overview (the owner sees it first)

Shipped as three merges so the new look appears within days:
- **1a Tokens + shell:**
  - Quiet Ledger tokens mapped onto shadcn variables
  - Motion tokens
  - Sidebar regrouping (new routes as redirects or placeholders)
  - Workspace switcher, page header
  - Filter bar with date presets and compare
  - Mobile floating tab bar
  - Speed floor: `React.cache`, `dataBounds`, contacts query fix, indexes
- **1b ⌘K + hotkeys:** palette, `/api/v1/search`, hotkey registry, `?` sheet, `useLinkStatus` pending states, the dim-don't-blank refetch pattern.
- **1c Overview v2:**
  - Metric and widget registries
  - Widgets 1–15 in Suspense
  - Briefing line, KPI tiles with sparklines and previous values
  - Metric explorer, instant model toggle
  - Presets, edit mode with `@dnd-kit`, pinning, `dashboards` table (workspace default + personal)

Acceptance:
- Every existing page renders in the new tokens in light and dark with no regressions, and all text passes AA.
- Overview paints the header and KPIs before the slowest widget (verified with an artificial delay). A cold load is under 1s on PGlite with demo data. `/contacts` is under 1s.
- The owner can pick a preset, add, remove, resize and reorder widgets, pin a KPI, save, reload and see the same layout, and reset. Mobile shows the 2-up tile grid and accordions. Edit mode on mobile reorders with ↑/↓.
- ⌘K finds a contact by name, a campaign and a settings page. `G P` navigates, `?` lists all shortcuts.
- The date presets and Compare selector work and persist in the URL. Deltas respect polarity.
- Test: layout zod parsing degrades unknown widgets. Test: every new table has `workspace_id`.

### Phase 2: live and deeper performance

- **Live:** `live.ts` + SSE route + `/live` + sidebar pulse + live pills + sale toasts + streamer mode + PWA polish.
- **Metrics:** NC-ROAS, MER, Profit, AOV, refunds, new vs returning, spend by platform (widgets 16–22).
- **Targets:** `goals` table, targets settings, stoplights, Goals & pacing widget.
- **Performance v2:** column presets and chooser, new columns including the platform-reported gap, peek Sheet, Quadrant/Trend toggle.
- **Saved views:** `saved_views` + sidebar pins (Performance first).

Acceptance:
- A pixel hit or test payment in the demo appears on `/live` within 2s with no reload. Overview shows the "new data" pill.
- Payloads contain no raw email or phone (test).
- The stream pauses on a hidden tab and reconnects after a server restart.
- Performance can switch to the Lead gen preset, save it as a view, pin it and reopen it from the sidebar.
- Stoplights match the configured targets. The platform-reported gap shows in Meta mock mode.

### Phase 3: CRM foundation

- `contact_stats` roll-up + keyset paging.
- Contacts v2: views, chips, Display, footer, bulk bar, group-by.
- Preview Sheet + J/K. Record page v2 with highlights, properties and the unified timeline (page views and events included).
- Tags, owner, inline optimistic edit, notes, tasks, My tasks, engagement score.

Acceptance:
- Contacts with 100k seeded rows sort by revenue and filter by first-touch platform in under 500ms on real Postgres.
- Footer totals equal a direct SQL check (test).
- Editing a stage, tag or owner is instant, has Undo and writes `audit()`.
- The notes PII policy is applied (see §7).

### Phase 4: pipeline and data hygiene

- `pipeline_stages`, `contact_stage_events`, `stage_id`. Kanban with rotting and weighted totals.
- Cost-per-stage columns in Performance.
- CSV import, duplicates and merge with re-attribution.
- Segments + hashed audience export + MCP `list_segment_members`, `contact_stage_funnel`.

Acceptance:
- Moving a card updates the Performance "Cost per Call booked" for its first-touch campaign after the attribution job runs.
- A payment auto-moves the contact to Won.
- Import of a 5k-row CSV previews correct new/update/invalid counts.
- A merge re-points the journeys and changes attribution as expected (test).

### Phase 5: analysis depth

- Attribution v2 (dumbbell, Paths, Time to convert, window recommendation).
- Customers v2 (retention, payback, day-mark LTV, curves, LTV by acquisition).
- Annotations (manual + auto).
- Funnel + heatmap widgets.
- Creative sync (thumbnails in connectors and mock mode) + Creatives tab.

Acceptance:
- Every new number traces to a `reports-analysis.ts` function with a test on demo data.
- The creative grid shows mock-mode thumbnails.
- Auto-annotations appear for campaign pause and start events from sync diffs.

### Phase 6: automation, sharing, AI

- Alert rules + anomalies.
- Scheduled digests.
- Share links with locked filters (`/share/[token]`).
- Insights v2 (action cards, number chips, Ask chat).
- Agency roll-up.
- Optional extra attribution models.

Acceptance:
- A rule "CAC > X for 2 days" fires once through the notify channel in mock mode.
- A share link can't remove its locked platform filter and expires correctly.
- Ask answers "top campaign by ROAS last 30d" with a table that matches Performance exactly.

**Parallelism:**
- Phase 1 must merge first; it owns the tokens, shell and UI primitives.
- After that, **Phase 2 Live** (`live.ts`, `/api/v1/live`, `(app)/live`) and **Phase 3 CRM** (`contacts/**`, `reports-crm.ts`) can run in parallel without file conflicts.
- **Phase 2 Performance v2** (`performance/**`, `reports-metrics.ts`) runs in parallel with Phase 3 too.
- Phase 4 depends on Phase 3 (and touches Performance, so start it after Performance v2 merges).
- **Phase 5 Attribution/Customers** (`attribution/**`, `customers/**`, `reports-analysis.ts`) can start any time after Phase 1. Its Creatives part touches connectors and should not overlap with other connector work.
- Phase 6 depends on the metric registry (Phase 1) and saved views (Phase 2).

---

## 7. Risks and open questions for the owner

1. **One new library for drag-and-drop (`@dnd-kit`).** It is needed for the rearrangeable Overview and the pipeline board, and it works with keyboard and touch. **Recommended default: approve.** It loads only while editing or on the Pipeline page.
2. **Private notes on contacts can contain emails or phone numbers,** which bends the rule that raw PII lives only in `contacts`. **Recommended default:** treat notes as part of the contact record. They are deleted with the contact, never sent to AI or MCP unless you switch that on, and never exported.
3. **Primary buttons change from green to black (white in dark mode),** so green means only "money in". **Recommended default: yes.** It is the main thing that makes the UI look calm and premium.
4. **The Lead / Customer status becomes a configurable pipeline** (New lead → Qualified → Call booked → Proposal → Won → Lost). **Recommended default:** ship these six stages, let each workspace rename or reorder them, keep "customer" automatic on the first payment, and keep the old lead/customer filter working.
5. **Creative thumbnails come from Meta and Google image links that expire.** **Recommended default:** store only the link and refresh it on every sync, with no image storage on your server. Until connectors provide thumbnails, the Creatives tab groups by ad name.
