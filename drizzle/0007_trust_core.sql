ALTER TABLE "api_keys" ADD COLUMN "scopes" text[] DEFAULT '{reports:read}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_ip_trunc" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ip_trunc" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "refs" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "seq" bigint;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "security" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_trunc" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "auth_method" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_org_seq_uq" ON "audit_log" USING btree ("organization_id","seq");--> statement-breakpoint
-- Keys created before scopes existed keep what they could do, except raw contact PII (docs/SECURITY.md).
UPDATE "api_keys" SET "scopes" = '{reports:read,contacts:read,ingest:write,mcp}'::text[];