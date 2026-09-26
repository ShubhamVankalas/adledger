import { sql, type SQL } from "drizzle-orm";
import type { DB } from "./db";

/**
 * Match touchpoints to synced ads/ad groups/campaigns.
 * Priority: IDs in UTMs (recommended templates) -> names (case-insensitive exact) -> unmatched.
 *   utm_content = ad id / name, utm_term = ad group id / name, utm_campaign = campaign id / name
 * Only fills columns that are still null, so it is safe to re-run after every sync.
 */
export async function matchTouchpoints(db: DB, workspaceId: string, touchpointIds?: string[]) {
  if (touchpointIds && touchpointIds.length === 0) return;
  const scope: SQL = touchpointIds
    ? sql`and t.id in (${sql.join(touchpointIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``;
  const platformOk = (alias: string) =>
    sql.raw(`(t.platform is null or t.platform = ${alias}.platform)`);

  for (const byName of [false, true]) {
    const eqExpr = (col: string, utm: string) =>
      sql.raw(byName ? `lower(${col}) = lower(t.${utm})` : `${col} = t.${utm}`);

    await db.execute(sql`
      update touchpoints t set ad_id = a.id, ad_group_id = a.ad_group_id, campaign_id = a.campaign_id,
        platform = a.platform
      from ads a
      where t.workspace_id = ${workspaceId} and a.workspace_id = t.workspace_id
        and t.ad_id is null and t.utm_content is not null
        and ${eqExpr("a.external_id", "utm_content")} ${byName ? sql.raw("and a.name <> ''") : sql``}
        and ${platformOk("a")} ${scope}`);
    await db.execute(sql`
      update touchpoints t set ad_group_id = g.id, campaign_id = g.campaign_id, platform = g.platform
      from ad_groups g
      where t.workspace_id = ${workspaceId} and g.workspace_id = t.workspace_id
        and t.ad_group_id is null and t.utm_term is not null
        and ${eqExpr("g.external_id", "utm_term")}
        and ${platformOk("g")} ${scope}`);
    await db.execute(sql`
      update touchpoints t set campaign_id = c.id, platform = c.platform
      from campaigns c
      where t.workspace_id = ${workspaceId} and c.workspace_id = t.workspace_id
        and t.campaign_id is null and t.utm_campaign is not null
        and ${eqExpr("c.external_id", "utm_campaign")}
        and ${platformOk("c")} ${scope}`);
  }
}
