import { createHash } from "node:crypto";
import { schema, type DB } from "../../db";
import { matchTouchpoints } from "../../matching";
import { nudgeLive } from "../../live";
import { recordLead, upsertContact } from "../../tracking/identity";
import type { LeadConnector, NativeLeadInput } from "./types";

/**
 * Each native lead gets its own synthetic visitor (`lead:<provider>:<lead id>`), linked to the
 * contact. That visitor doubles as the idempotency key: a retried webhook finds it already there
 * and stores nothing. Returns the lead ids that were stored.
 */
export function syntheticVisitorId(provider: string, externalLeadId: string): string {
  const id = `lead:${provider}:${externalLeadId}`;
  return id.length <= 64 ? id : `lead:${provider}:${createHash("sha256").update(externalLeadId).digest("hex").slice(0, 32)}`.slice(0, 64);
}

export type IngestLeadsResult = { stored: number; duplicates: number; skipped: number; leadIds: string[] };

export async function ingestNativeLeads(db: DB, workspaceId: string, connector: LeadConnector, leads: NativeLeadInput[]): Promise<IngestLeadsResult> {
  const provider = connector.meta.provider;
  const result: IngestLeadsResult = { stored: 0, duplicates: 0, skipped: 0, leadIds: [] };
  const touchpointIds: string[] = [];
  for (const l of leads) {
    const outcome = await db.transaction(async (tx) => {
      const contact = await upsertContact(tx, workspaceId, { email: l.email, phone: l.phone, name: l.name }, l.occurredAt);
      if (!contact) return "skipped" as const;
      const [visitor] = await tx
        .insert(schema.visitors)
        .values({
          workspaceId,
          anonymousId: syntheticVisitorId(provider, l.externalLeadId),
          firstSeenAt: l.occurredAt,
          lastSeenAt: l.occurredAt,
          contactId: contact.id,
        })
        .onConflictDoNothing()
        .returning({ id: schema.visitors.id });
      if (!visitor) return "duplicate" as const;
      const lead = await recordLead(tx, {
        workspaceId,
        contactId: contact.id,
        source: "webhook",
        formName: l.formName,
        occurredAt: l.occurredAt,
        raw: { provider, externalLeadId: l.externalLeadId, campaignId: l.campaignExternalId, adGroupId: l.adGroupExternalId, adId: l.adExternalId, ...l.details },
        phone: l.phone,
      });
      const paid = !l.organic && Boolean(l.campaignExternalId || l.adGroupExternalId || l.adExternalId);
      if (paid) {
        // IDs go in the UTM columns so matchTouchpoints resolves them now, or after the next
        // spend sync if the ad isn't imported yet.
        const [tp] = await tx
          .insert(schema.touchpoints)
          .values({
            workspaceId,
            visitorId: visitor.id,
            occurredAt: l.occurredAt,
            utmSource: connector.utmSource,
            utmMedium: "lead_form",
            utmCampaign: l.campaignExternalId,
            utmTerm: l.adGroupExternalId,
            utmContent: l.adExternalId,
            clickIdType: l.clickId?.type ?? null,
            clickId: l.clickId?.id ?? null,
            channel: connector.channel,
            platform: connector.platform,
          })
          .returning({ id: schema.touchpoints.id });
        touchpointIds.push(tp.id);
      }
      return lead.id;
    });
    if (outcome === "skipped") result.skipped++;
    else if (outcome === "duplicate") result.duplicates++;
    else {
      result.stored++;
      result.leadIds.push(outcome);
    }
  }
  if (touchpointIds.length) await matchTouchpoints(db, workspaceId, touchpointIds);
  if (result.stored > 0) nudgeLive(workspaceId);
  return result;
}
