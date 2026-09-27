import { sql, type SQL } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { Platform } from "./db/schema";
import { defaultStage, listStages, type Stage } from "./pipeline";
import { maskEmail } from "./reports";
import type { Workspace } from "./settings";

// Pipeline numbers, all computed in SQL (the kanban board, the stage funnel and cost per stage).
// A contact with no stage_id sits in the workspace's first open stage (see lib/pipeline.ts).
//
// "Reached a stage": for open and won stages, the furthest non-lost stage a contact has been in
// (current stage or any history row) is at or past that stage's position. Everyone reached the
// first stage. Lost stages count the contacts currently in them.

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Card on the board. Carries a masked email only as a label fallback, never the raw address. */
export type PipelineCard = {
  id: string;
  label: string;
  stageId: string;
  /** Net revenue from this contact (reporting currency). */
  valueMinor: number;
  enteredAt: string;
  daysInStage: number;
  rotting: boolean;
  source: { platform: Platform | null; channel: string | null; campaign: string | null; ad: string | null } | null;
};

export type PipelineColumn = Stage & {
  count: number;
  valueMinor: number;
  weightedMinor: number;
  rotting: number;
  cards: PipelineCard[];
};

export type PipelineBoard = {
  currency: string;
  /** Average net revenue per paying contact: the value assumed for open contacts in the weighted total. */
  avgValueMinor: number;
  columns: PipelineColumn[];
};

export const CARDS_PER_STAGE = 50;

const effStage = (defId: string) => sql`coalesce(c.stage_id, ${defId}::uuid)`;
const enteredAt = sql`coalesce(c.stage_changed_at, c.first_seen_at)`;

/** Column totals for every stage (count, Σ value, weighted value, rotting). */
async function columnStats(db: DB, ws: Workspace, stages: Stage[]) {
  const def = defaultStage(stages);
  const r = rows<{ stage_id: string; cnt: string; value: string; weighted: string; rotting: string; avg_value: string }>(
    await db.execute(sql`
      with rev as (
        select contact_id, sum(amount_minor) net from revenue_events
        where workspace_id = ${ws.id} and currency = ${ws.reportingCurrency} and contact_id is not null
        group by contact_id
      ),
      avgv as (select coalesce(round(avg(net)), 0) v from rev where net > 0),
      c as (
        select ${effStage(def.id)} stage_id, ${enteredAt} entered_at, coalesce(rev.net, 0) net
        from contacts c left join rev on rev.contact_id = c.id
        where c.workspace_id = ${ws.id}
      )
      select s.id stage_id, count(c.stage_id) cnt, coalesce(sum(c.net), 0) value,
        coalesce(round(sum(case when c.stage_id is null then 0 when c.net > 0 then c.net else (select v from avgv) end * s.probability / 100.0)), 0) weighted,
        count(c.stage_id) filter (where s.kind = 'open' and s.rot_days is not null and c.entered_at < now() - make_interval(days => s.rot_days)) rotting,
        (select v from avgv) avg_value
      from pipeline_stages s left join c on c.stage_id = s.id
      where s.workspace_id = ${ws.id}
      group by s.id`),
  );
  return { byStage: new Map(r.map((x) => [x.stage_id, x])), avgValueMinor: n(r[0]?.avg_value) };
}

/** Cards, newest in stage first. With `stageId`, one page of that stage only (for "Show more"). */
export async function pipelineCards(
  db: DB,
  ws: Workspace,
  stages: Stage[],
  opts: { stageId?: string; offset?: number; limit?: number } = {},
): Promise<PipelineCard[]> {
  const def = defaultStage(stages);
  const limit = Math.min(Math.max(1, opts.limit ?? CARDS_PER_STAGE), 200);
  const offset = Math.max(0, opts.offset ?? 0);
  const byId = new Map(stages.map((s) => [s.id, s]));
  const r = rows<Record<string, string | null>>(
    await db.execute(sql`
      with ranked as (
        select c.id, c.name, c.email, ${effStage(def.id)} stage_id, ${enteredAt} entered_at,
          row_number() over (partition by ${effStage(def.id)} order by ${enteredAt} desc, c.id) rn
        from contacts c
        where c.workspace_id = ${ws.id} ${opts.stageId ? sql`and ${effStage(def.id)} = ${opts.stageId}::uuid` : sql``}
      )
      select r.id, r.name, r.email, r.stage_id, r.entered_at,
        floor(extract(epoch from (now() - r.entered_at)) / 86400)::int days,
        (select coalesce(sum(amount_minor), 0) from revenue_events re
          where re.workspace_id = ${ws.id} and re.contact_id = r.id and re.currency = ${ws.reportingCurrency}) net,
        ft.platform, ft.channel, ft.campaign, ft.ad
      from ranked r
      left join lateral (
        select t.platform, t.channel, cp.name campaign, a.name ad
        from touchpoints t join visitors v on v.id = t.visitor_id
        left join campaigns cp on cp.id = t.campaign_id left join ads a on a.id = t.ad_id
        where v.contact_id = r.id order by t.occurred_at, t.id limit 1
      ) ft on true
      where r.rn > ${offset} and r.rn <= ${offset + limit}
      order by r.stage_id, r.rn`),
  );
  return r.map((x) => {
    const stage = byId.get(x.stage_id!);
    const days = Math.max(0, n(x.days));
    return {
      id: x.id!,
      label: x.name?.trim() || maskEmail(x.email) || "Unnamed contact",
      stageId: x.stage_id!,
      valueMinor: n(x.net),
      enteredAt: new Date(x.entered_at!).toISOString(),
      daysInStage: days,
      rotting: Boolean(stage && stage.kind === "open" && stage.rotDays !== null && days > stage.rotDays),
      source: x.channel ? { platform: (x.platform as Platform | null) ?? null, channel: x.channel, campaign: x.campaign, ad: x.ad } : null,
    };
  });
}

/** Everything the kanban needs: stages in order with totals and the first cards of each. */
export async function pipelineBoard(db: DB, ws: Workspace, opts: { perStage?: number } = {}): Promise<PipelineBoard> {
  const stages = await listStages(db, ws.id);
  const [stats, cards] = await Promise.all([columnStats(db, ws, stages), pipelineCards(db, ws, stages, { limit: opts.perStage })]);
  const cardsOf = new Map<string, PipelineCard[]>();
  for (const c of cards) cardsOf.set(c.stageId, [...(cardsOf.get(c.stageId) ?? []), c]);
  return {
    currency: ws.reportingCurrency,
    avgValueMinor: stats.avgValueMinor,
    columns: stages.map((s) => {
      const st = stats.byStage.get(s.id);
      return { ...s, count: n(st?.cnt), valueMinor: n(st?.value), weightedMinor: n(st?.weighted), rotting: n(st?.rotting), cards: cardsOf.get(s.id) ?? [] };
    }),
  };
}

export type PipelineSummary = {
  open: number;
  openWeightedMinor: number;
  won: number;
  wonValueMinor: number;
  lost: number;
  rotting: number;
};

/** Board-wide totals, summed from the SQL column totals (open stages, won stages, lost stages). */
export function pipelineSummary(board: Pick<PipelineBoard, "columns">): PipelineSummary {
  const s: PipelineSummary = { open: 0, openWeightedMinor: 0, won: 0, wonValueMinor: 0, lost: 0, rotting: 0 };
  for (const c of board.columns) {
    if (c.kind === "open") {
      s.open += c.count;
      s.openWeightedMinor += c.weightedMinor;
      s.rotting += c.rotting;
    } else if (c.kind === "won") {
      s.won += c.count;
      s.wonValueMinor += c.valueMinor;
    } else {
      s.lost += c.count;
    }
  }
  return s;
}

// ---------------------------------------------------------------- funnel + cost per stage

export type FunnelParams = { start?: string; end?: string };

/** Contacts first seen in [start, end] (workspace-local dates, inclusive), or all contacts. */
function cohortFilter(ws: Workspace, p: FunnelParams): SQL {
  const parts: SQL[] = [];
  if (p.start) parts.push(sql`and c.first_seen_at >= (${p.start}::date)::timestamp at time zone ${ws.timezone}`);
  if (p.end) parts.push(sql`and c.first_seen_at < ((${p.end}::date + 1))::timestamp at time zone ${ws.timezone}`);
  return sql.join(parts, sql` `);
}

/** Per contact: current stage and the furthest non-lost stage position reached. */
function reachCte(ws: Workspace, def: Stage, p: FunnelParams, extraSelect: SQL = sql``, extraJoin: SQL = sql``): SQL {
  return sql`
    st as (select id, position, kind from pipeline_stages where workspace_id = ${ws.id}),
    first_pos as (select coalesce(min(position), 0) p from st where kind <> 'lost'),
    reach as (
      select c.id, ${effStage(def.id)} cur ${extraSelect},
        greatest(
          (select p from first_pos),
          coalesce((select max(s.position) from contact_stage_events e join st s on s.id = e.to_stage_id
                    where e.contact_id = c.id and s.kind <> 'lost'), -1),
          coalesce((select s.position from st s where s.id = ${effStage(def.id)} and s.kind <> 'lost'), -1)
        ) reach_pos
      from contacts c ${extraJoin}
      where c.workspace_id = ${ws.id} ${cohortFilter(ws, p)}
    )`;
}

export type FunnelStep = {
  stageId: string;
  name: string;
  kind: Stage["kind"];
  color: Stage["color"];
  reached: number;
  /** Share of the previous open/won step that reached this one (null for the first and lost stages). */
  conversion: number | null;
  /** Share of the cohort that reached this stage. */
  ofTotal: number | null;
  /** Contacts with a paid first touch that reached this stage. */
  paidReached: number;
  /** Ad spend in the period ÷ paid contacts that reached this stage (null when none). */
  costMinor: number | null;
};

export type StageFunnel = { currency: string; start: string | null; end: string | null; total: number; spendMinor: number; steps: FunnelStep[] };

/** How far contacts got through the pipeline, with cost per stage across all paid campaigns. */
export async function stageFunnel(db: DB, ws: Workspace, p: FunnelParams = {}): Promise<StageFunnel> {
  const stages = await listStages(db, ws.id);
  const def = defaultStage(stages);
  const r = rows<{ id: string; reached: string; paid_reached: string; total: string }>(
    await db.execute(sql`
      with ${reachCte(
        ws,
        def,
        p,
        sql`, ft.campaign_id`,
        sql`left join lateral (
          select t.campaign_id from touchpoints t join visitors v on v.id = t.visitor_id
          where v.contact_id = c.id order by t.occurred_at, t.id limit 1
        ) ft on true`,
      )}
      select s.id,
        count(r.id) filter (where case when s.kind = 'lost' then r.cur = s.id else r.reach_pos >= s.position end) reached,
        count(r.id) filter (where r.campaign_id is not null and case when s.kind = 'lost' then r.cur = s.id else r.reach_pos >= s.position end) paid_reached,
        (select count(*) from reach) total
      from st s left join reach r on true
      group by s.id`),
  );
  const spendMinor = await periodSpend(db, ws, p);
  const byId = new Map(r.map((x) => [x.id, x]));
  const total = n(r[0]?.total);
  let prev: number | null = null;
  const steps = stages.map((s): FunnelStep => {
    const x = byId.get(s.id);
    const reached = n(x?.reached);
    const paidReached = n(x?.paid_reached);
    const step: FunnelStep = {
      stageId: s.id,
      name: s.name,
      kind: s.kind,
      color: s.color,
      reached,
      conversion: s.kind === "lost" || prev === null ? null : prev > 0 ? reached / prev : null,
      ofTotal: total > 0 ? reached / total : null,
      paidReached,
      costMinor: paidReached > 0 && spendMinor > 0 ? Math.round(spendMinor / paidReached) : null,
    };
    if (s.kind !== "lost") prev = reached;
    return step;
  });
  return { currency: ws.reportingCurrency, start: p.start ?? null, end: p.end ?? null, total, spendMinor, steps };
}

async function periodSpend(db: DB, ws: Workspace, p: FunnelParams) {
  const [x] = rows<{ spend: string }>(
    await db.execute(sql`
      select coalesce(sum(spend_minor), 0) spend from ad_insights_daily
      where workspace_id = ${ws.id} and currency = ${ws.reportingCurrency}
        ${p.start ? sql`and date >= ${p.start}::date` : sql``} ${p.end ? sql`and date <= ${p.end}::date` : sql``}`),
  );
  return n(x?.spend);
}

export type CostPerStageLevel = "campaign" | "ad_group" | "ad";
export type CostPerStageRow = {
  id: string;
  name: string;
  /** The campaign of an ad set, or the ad set of an ad (null for campaigns). */
  parentName: string | null;
  platform: Platform;
  spendMinor: number;
  stages: { stageId: string; reached: number; costMinor: number | null }[];
};

const LEVEL = {
  campaign: { col: "campaign_id", table: "campaigns", parent: null },
  ad_group: { col: "ad_group_id", table: "ad_groups", parent: { table: "campaigns", col: "campaign_id" } },
  ad: { col: "ad_id", table: "ads", parent: { table: "ad_groups", col: "ad_group_id" } },
} as const;

/**
 * Cost per stage per campaign / ad set / ad: spend in the period ÷ contacts (first seen in the
 * period, first touch on that entity) that reached each stage. For Performance's
 * "Cost per Qualified / Call booked" columns. Lost stages are left out.
 */
export async function costPerStage(
  db: DB,
  ws: Workspace,
  p: { start: string; end: string; level?: CostPerStageLevel; platform?: Platform },
): Promise<{ currency: string; stages: Stage[]; rows: CostPerStageRow[] }> {
  const stages = await listStages(db, ws.id);
  const def = defaultStage(stages);
  const lv = LEVEL[p.level ?? "campaign"];
  const col = sql.raw(lv.col);
  const table = sql.raw(lv.table);
  const parentJoin = lv.parent ? sql`left join ${sql.raw(lv.parent.table)} pc on pc.id = x.${sql.raw(lv.parent.col)}` : sql``;
  const parentName = lv.parent ? sql`pc.name` : sql`null::text`;
  const r = rows<{ id: string; name: string; parent: string | null; platform: Platform; spend: string; stage_id: string; reached: string }>(
    await db.execute(sql`
      with ${reachCte(
        ws,
        def,
        p,
        sql`, ft.entity_id`,
        sql`left join lateral (
          select t.${col} entity_id from touchpoints t join visitors v on v.id = t.visitor_id
          where v.contact_id = c.id order by t.occurred_at, t.id limit 1
        ) ft on true`,
      )},
      spend as (
        select ${col} entity_id, sum(spend_minor) spend from ad_insights_daily
        where workspace_id = ${ws.id} and currency = ${ws.reportingCurrency}
          and date between ${p.start}::date and ${p.end}::date
          ${p.platform ? sql`and platform = ${p.platform}` : sql``}
        group by 1
      ),
      reached as (
        select r.entity_id, s.id stage_id, count(*) n
        from reach r join st s on s.kind <> 'lost' and r.reach_pos >= s.position
        where r.entity_id is not null
        group by 1, 2
      ),
      entities as (
        select entity_id from spend union select entity_id from reach where entity_id is not null
      )
      select e.entity_id id, x.name, ${parentName} parent, x.platform, coalesce(sp.spend, 0) spend, s.id stage_id, coalesce(rc.n, 0) reached
      from entities e
      join ${table} x on x.id = e.entity_id and x.workspace_id = ${ws.id}
      ${parentJoin}
      left join spend sp on sp.entity_id = e.entity_id
      cross join st s
      left join reached rc on rc.entity_id = e.entity_id and rc.stage_id = s.id
      where s.kind <> 'lost' ${p.platform ? sql`and x.platform = ${p.platform}` : sql``}
      order by coalesce(sp.spend, 0) desc, x.name, x.id, s.position`),
  );
  const out = new Map<string, CostPerStageRow>();
  for (const x of r) {
    let row = out.get(x.id);
    if (!row) {
      row = { id: x.id, name: x.name, parentName: x.parent, platform: x.platform, spendMinor: n(x.spend), stages: [] };
      out.set(x.id, row);
    }
    const reached = n(x.reached);
    row.stages.push({ stageId: x.stage_id, reached, costMinor: reached > 0 && row.spendMinor > 0 ? Math.round(row.spendMinor / reached) : null });
  }
  return { currency: ws.reportingCurrency, stages: stages.filter((s) => s.kind !== "lost"), rows: [...out.values()] };
}
