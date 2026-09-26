CREATE TABLE "conversion_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"conversion_type" text NOT NULL,
	"conversion_id" uuid NOT NULL,
	"conversion_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mock" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversion_uploads" ADD CONSTRAINT "conversion_uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_uploads_uq" ON "conversion_uploads" USING btree ("workspace_id","platform","conversion_type","conversion_id");--> statement-breakpoint
CREATE INDEX "conversion_uploads_workspace_id_status_next_attempt_at_index" ON "conversion_uploads" USING btree ("workspace_id","status","next_attempt_at");