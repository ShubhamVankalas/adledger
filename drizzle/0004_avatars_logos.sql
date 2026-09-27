ALTER TABLE "organizations" ADD COLUMN "logo" bytea;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_type" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar" bytea;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" timestamp with time zone;