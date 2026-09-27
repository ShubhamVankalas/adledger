ALTER TABLE "contacts" ADD COLUMN "ads_consent" text;--> statement-breakpoint
ALTER TABLE "conversion_uploads" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "conversion_uploads" ADD COLUMN "consent_mode" text;--> statement-breakpoint
ALTER TABLE "pixel_sites" ADD COLUMN "consent_mode" text DEFAULT 'optout' NOT NULL;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "consent" text;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "gpc" boolean DEFAULT false NOT NULL;