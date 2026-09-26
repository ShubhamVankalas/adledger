import { eq, sql } from "drizzle-orm";
import { rows, schema, type DB } from "../db";
import type { AttributionModel, Channel, ConversionType, Platform } from "../db/schema";
import { allocate } from "../money";

export const MODELS: AttributionModel[] = ["first_touch", "last_touch", "linear"];

export type Touch = {
  id: string;
  occurredAt: Date;
  channel: Channel;
  platform: Platform | null;
  campaignId: string | null;
  adGroupId: string | null;
  adId: string | null;
};

export type Conversion = {
  id: string;
  type: ConversionType;
  contactId: string | null;
  at: Date; // when the conversion is reported
  anchor: Date; // the moment the lookback window ends (original payment time for refunds)
  amountMinor: number;
  currency: string | null;
};

/** Pick touches and weights for one conversion under one model. */
export function selectTouches(model: AttributionModel, eligible: Touch[]): { touch: Touch; weight: number }[] {
  if (eligible.length === 0) return [];
  const sorted = [...eligible].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  if (model === "first_touch") return [{ touch: sorted[0], weight: 1 }];
  if (model === "last_touch") {
    const nonDirect = sorted.filter((t) => t.channel !== "direct");
    const pick = (nonDirect.length ? nonDirect : sorted).at(-1)!;
    return [{ touch: pick, weight: 1 }];
  }
  return sorted.map((touch) => ({ touch, weight: 1 }));
}

export function eligibleTouches(touches: Touch[], anchor: Date, windowDays: number): Touch[] {
  const from = anchor.getTime() - windowDays * 86_400_000;
  return touches.filter((t) => t.occurredAt.getTime() <= anchor.getTime() && t.occurredAt.getTime() >= from);
}

type CreditRow = typeof schema.attributionCredits.$inferInsert;

export function creditsFor(
  workspaceId: string,
  model: AttributionModel,
  conv: Conversion,
  eligible: Touch[],
): CreditRow[] {
  const picks = selectTouches(model, eligible);
  const base = {
    workspaceId,
    model,
    conversionType: conv.type,
    conversionId: conv.id,
    conversionAt: conv.at,
    contactId: conv.contactId,
    currency: conv.currency,
  };
  if (picks.length === 0) {
    return [{ ...base, touchpointId: null, credit: "1", revenueMinor: conv.amountMinor }];
  }
  const weights = picks.map((p) => p.weight);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const revenue = allocate(conv.amountMinor, weights);
  return picks.map((p, i) => ({
    ...base,
    touchpointId: p.touch.id,
    channel: p.touch.channel,
    platform: p.touch.platform,
    campaignId: p.touch.campaignId,
    adGroupId: p.touch.adGroupId,
    adId: p.touch.adId,
    credit: (weights[i] / wSum).toFixed(6),
    revenueMinor: revenue[i],
  }));
}

/**
 * Full recompute of attribution credits for a workspace (fine for v0.1 volumes).
 * Conversions: first lead per contact, first payment per contact ("customer"),
 * and every revenue event (payments and refunds). Repeat payments are credited to the
 * touchpoints before the customer's first payment.
 */
export async function recomputeAttribution(db: DB, workspaceId: string): Promise<{ credits: number }> {
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return { credits: 0 };
  const windowDays = ws.attributionWindowDays;

  const leadRows = rows<{ id: string; contact_id: string; occurred_at: string | Date }>(
    await db.execute(sql`
      select distinct on (contact_id) id, contact_id, occurred_at
      from leads where workspace_id = ${workspaceId}
      order by contact_id, occurred_at, id`),
  );
  const customerRows = rows<{ id: string; contact_id: string; occurred_at: string | Date }>(
    await db.execute(sql`
      select distinct on (contact_id) id, contact_id, occurred_at
      from revenue_events where workspace_id = ${workspaceId} and type = 'payment' and contact_id is not null
      order by contact_id, occurred_at, id`),
  );
  const revenueRows = rows<{
    id: string;
    contact_id: string | null;
    occurred_at: string | Date;
    amount_minor: string | number;
    currency: string;
    anchor_at: string | Date | null;
  }>(
    await db.execute(sql`
      select r.id, r.contact_id, r.occurred_at, r.amount_minor, r.currency, p.occurred_at as anchor_at
      from revenue_events r
      left join revenue_events p on r.type = 'refund' and p.workspace_id = r.workspace_id
        and p.source = r.source and p.external_id = r.related_external_id
      where r.workspace_id = ${workspaceId}`),
  );
  const touchRows = rows<{
    id: string;
    contact_id: string;
    occurred_at: string | Date;
    channel: Channel;
    platform: Platform | null;
    campaign_id: string | null;
    ad_group_id: string | null;
    ad_id: string | null;
  }>(
    await db.execute(sql`
      select t.id, v.contact_id, t.occurred_at, t.channel, t.platform, t.campaign_id, t.ad_group_id, t.ad_id
      from touchpoints t join visitors v on v.id = t.visitor_id
      where t.workspace_id = ${workspaceId} and v.contact_id is not null`),
  );

  const touchesByContact = new Map<string, Touch[]>();
  for (const r of touchRows) {
    const list = touchesByContact.get(r.contact_id) ?? [];
    list.push({
      id: r.id,
      occurredAt: new Date(r.occurred_at),
      channel: r.channel,
      platform: r.platform,
      campaignId: r.campaign_id,
      adGroupId: r.ad_group_id,
      adId: r.ad_id,
    });
    touchesByContact.set(r.contact_id, list);
  }

  // Repeat payments (renewals, upsells) inherit the journey that acquired the customer:
  // their lookback window ends at the contact's first payment (LTV attribution).
  const firstPaymentAt = new Map(customerRows.map((r) => [r.contact_id, new Date(r.occurred_at)]));

  const conversions: Conversion[] = [
    ...leadRows.map((r) => ({
      id: r.id,
      type: "lead" as const,
      contactId: r.contact_id,
      at: new Date(r.occurred_at),
      anchor: new Date(r.occurred_at),
      amountMinor: 0,
      currency: null,
    })),
    ...customerRows.map((r) => ({
      id: r.id,
      type: "customer" as const,
      contactId: r.contact_id,
      at: new Date(r.occurred_at),
      anchor: new Date(r.occurred_at),
      amountMinor: 0,
      currency: null,
    })),
    ...revenueRows.map((r) => ({
      id: r.id,
      type: "revenue" as const,
      contactId: r.contact_id,
      at: new Date(r.occurred_at),
      anchor: new Date(
        Math.min(
          new Date(r.anchor_at ?? r.occurred_at).getTime(),
          (r.contact_id && firstPaymentAt.get(r.contact_id)?.getTime()) || Infinity,
        ),
      ),
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
    })),
  ];

  const credits: CreditRow[] = [];
  for (const conv of conversions) {
    const touches = conv.contactId ? (touchesByContact.get(conv.contactId) ?? []) : [];
    const eligible = eligibleTouches(touches, conv.anchor, windowDays);
    for (const model of MODELS) credits.push(...creditsFor(workspaceId, model, conv, eligible));
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"attr:" + workspaceId}))`);
    await tx.delete(schema.attributionCredits).where(eq(schema.attributionCredits.workspaceId, workspaceId));
    for (let i = 0; i < credits.length; i += 1000) {
      await tx.insert(schema.attributionCredits).values(credits.slice(i, i + 1000));
    }
  });
  return { credits: credits.length };
}
