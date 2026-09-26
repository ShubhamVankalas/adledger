import type { UploadConversionType, UploadPlatform } from "../db/schema";

export type { UploadConversionType, UploadPlatform };

export type GoogleClickId = { type: "gclid" | "gbraid" | "wbraid"; id: string };

/** Everything a payload builder needs about one conversion (loaded in one SQL query). */
export type ConversionContext = {
  id: string; // leads.id or revenue_events.id
  type: UploadConversionType;
  occurredAt: Date;
  amountMinor: number | null; // purchases only
  currency: string | null;
  contactId: string | null;
  email: string | null; // raw, from contacts — hashed before it leaves this process
  emailHash: string | null; // sha256(lowercased, trimmed)
  phoneHash: string | null; // sha256(digits incl. country code)
  ip: string | null; // truncated IP as stored on events
  userAgent: string | null;
  sourceUrl: string | null;
  fbc: string | null;
  fbp: string | null;
  googleClick: GoogleClickId | null;
};

/** Outcome of one upload attempt for one conversion. */
export type SendOutcome =
  | { ok: true; mock?: boolean }
  | { ok: false; retryable: boolean; error: string };

export type Built<T> = { payload: T } | { skip: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
