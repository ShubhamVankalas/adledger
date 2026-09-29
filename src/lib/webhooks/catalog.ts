import type { WebhookEventType } from "../db/schema";

// Outbound webhooks: the event catalogue, payload shapes and sample events. Plain module (no
// server imports) so the Developers pages, the docs generator and tests can all use it.

export type { WebhookEventType };

export type WebhookEventMeta = { type: WebhookEventType; label: string; description: string };

export const WEBHOOK_EVENTS: WebhookEventMeta[] = [
  {
    type: "lead.created",
    label: "Lead created",
    description: "A form fill, lead-ads lead, WhatsApp chat or API lead was recorded. CSV imports don't fire it.",
  },
  {
    type: "contact.created",
    label: "Contact created",
    description: "A person appeared for the first time: from a lead, a payment or a pixel identify.",
  },
  {
    type: "contact.updated",
    label: "Contact stage changed",
    description: "A contact moved to another pipeline stage: dragged on the board, won by a payment, or undone.",
  },
  {
    type: "payment.succeeded",
    label: "Payment succeeded",
    description: "A new payment from Stripe, Shopify, Paddle and the other revenue sources, or the conversions API.",
  },
  {
    type: "payment.refunded",
    label: "Payment refunded",
    description: "A new refund was recorded against a payment.",
  },
];

export const WEBHOOK_EVENT_TYPES = WEBHOOK_EVENTS.map((e) => e.type);

export const isWebhookEvent = (v: unknown): v is WebhookEventType => typeof v === "string" && (WEBHOOK_EVENT_TYPES as string[]).includes(v);

export const webhookEventLabel = (t: string) => WEBHOOK_EVENTS.find((e) => e.type === t)?.label ?? t;

/** Header carrying `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. */
export const SIGNATURE_HEADER = "AdLedger-Signature";
/** Reject signatures older than this (replay protection) when verifying. */
export const SIGNATURE_TOLERANCE_SEC = 300;
/** Payload format version, sent as `api_version` in every event. */
export const WEBHOOK_API_VERSION = "2026-09-29";

/** Delivery policy (shown in the UI and docs). Delays between attempts; one more attempt than delays. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const DELIVERY_TIMEOUT_MS = 10_000;
export const DELIVERY_RETENTION_DAYS = 30;

// ---------------------------------------------------------------- payload shapes

export type WebhookStage = { id: string; name: string; kind: "open" | "won" | "lost" };

/**
 * A contact as sent in events. `email` / `phone` are raw only for endpoints with "Include
 * personal data" on; otherwise null, with the masked email and SHA-256 hashes (lowercased,
 * trimmed email; digits-only phone) for matching.
 */
export type WebhookContact = {
  id: string;
  name: string | null;
  email: string | null;
  email_masked: string | null;
  email_sha256: string | null;
  phone: string | null;
  phone_sha256: string | null;
  lifecycle: "lead" | "customer";
  stage: WebhookStage | null;
  first_seen_at: string;
  url: string | null;
};

export type WebhookLead = { id: string; source: "pixel" | "webhook" | "api" | "csv"; form_name: string | null; occurred_at: string };

export type WebhookPayment = {
  id: string;
  source: string;
  external_id: string;
  /** Always positive, in minor units (cents). */
  amount_minor: number;
  currency: string;
  occurred_at: string;
};

export type WebhookRefund = WebhookPayment & { related_external_id: string | null };

export type WebhookEventData = {
  "lead.created": { lead: WebhookLead; contact: WebhookContact };
  "contact.created": { contact: WebhookContact };
  "contact.updated": {
    contact: WebhookContact;
    changes: { stage: { from: WebhookStage | null; to: WebhookStage; source: "manual" | "payment" | "system" | "undo" } };
  };
  "payment.succeeded": { payment: WebhookPayment; contact: WebhookContact | null };
  "payment.refunded": { refund: WebhookRefund; contact: WebhookContact | null };
};

export type WebhookEnvelope<T extends WebhookEventType = WebhookEventType> = {
  id: string;
  type: T;
  api_version: string;
  created_at: string;
  workspace_id: string;
  /** true for "Send test event" (sample data, nothing happened). */
  test: boolean;
  data: WebhookEventData[T];
};

// ---------------------------------------------------------------- samples

const SAMPLE_CONTACT_ID = "5b1f3a9e-2c4d-4e8f-9a1b-3c5d7e9f1a2b";

function sampleContact(pii: boolean, stage: WebhookStage = { id: "7d2e4f6a-8b0c-4d1e-a2f3-b4c5d6e7f809", name: "New lead", kind: "open" }): WebhookContact {
  return {
    id: SAMPLE_CONTACT_ID,
    name: "Priya Shah",
    email: pii ? "priya@example.com" : null,
    email_masked: "p•••••@example.com",
    // sha256("priya@example.com") and sha256("14155550142"), so receivers can test their matching.
    email_sha256: "6bdb7e961d54ddc243ec721e6e211ac0a179b19a9ce2ad52a418198e146e69fe",
    phone: pii ? "+1 415 555 0142" : null,
    phone_sha256: "61c16289716534ac3a5992f613d7a9fefa5e9c12b8fd27f187387da9efeafd8c",
    lifecycle: "lead",
    stage,
    first_seen_at: "2026-09-29T09:41:12.000Z",
    url: null,
  };
}

/** A realistic example of each event (for "Send test event", the docs and the reference page). */
export function sampleEvent<T extends WebhookEventType>(type: T, opts: { workspaceId?: string; pii?: boolean; id?: string; now?: Date; test?: boolean } = {}): WebhookEnvelope<T> {
  const pii = opts.pii ?? false;
  const now = (opts.now ?? new Date("2026-09-29T09:41:13.000Z")).toISOString();
  const won: WebhookStage = { id: "0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b", name: "Won", kind: "won" };
  const payment: WebhookPayment = { id: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f2a3b4c5d", source: "stripe", external_id: "pi_3Q0aBcDeFgHiJkLm", amount_minor: 14900, currency: "USD", occurred_at: now };
  const data = {
    "lead.created": {
      lead: { id: "c4d5e6f7-a8b9-4c0d-8e1f-2a3b4c5d6e7f", source: "webhook", form_name: "Book a demo", occurred_at: now },
      contact: sampleContact(pii),
    },
    "contact.created": { contact: sampleContact(pii) },
    "contact.updated": {
      contact: sampleContact(pii, { id: "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b", name: "Call booked", kind: "open" }),
      changes: {
        stage: {
          from: { id: "7d2e4f6a-8b0c-4d1e-a2f3-b4c5d6e7f809", name: "New lead", kind: "open" },
          to: { id: "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b", name: "Call booked", kind: "open" },
          source: "manual",
        },
      },
    },
    "payment.succeeded": { payment, contact: { ...sampleContact(pii, won), lifecycle: "customer" } },
    "payment.refunded": {
      refund: { ...payment, id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", external_id: "re_3Q0aBcDeFgHiJkLm", related_external_id: "pi_3Q0aBcDeFgHiJkLm" },
      contact: { ...sampleContact(pii, won), lifecycle: "customer" },
    },
  } satisfies WebhookEventData;
  return {
    id: opts.id ?? "evt_8f14e45fceea4b1c9d3a0b7e6c2d1f90",
    type,
    api_version: WEBHOOK_API_VERSION,
    created_at: now,
    workspace_id: opts.workspaceId ?? "00000000-0000-4000-8000-000000000000",
    test: opts.test ?? false,
    data: data[type] as WebhookEventData[T],
  };
}
