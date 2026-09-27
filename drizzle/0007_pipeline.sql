CREATE TABLE "contact_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid,
	"from_name" text,
	"to_name" text NOT NULL,
	"source" text NOT NULL,
	"user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text DEFAULT 'open' NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"rot_days" integer,
	"probability" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "stage_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_stage_events" ADD CONSTRAINT "contact_stage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stage_events" ADD CONSTRAINT "contact_stage_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stage_events" ADD CONSTRAINT "contact_stage_events_from_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stage_events" ADD CONSTRAINT "contact_stage_events_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stage_events" ADD CONSTRAINT "contact_stage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_stage_events_contact_id_occurred_at_index" ON "contact_stage_events" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "contact_stage_events_workspace_id_to_stage_id_index" ON "contact_stage_events" USING btree ("workspace_id","to_stage_id");--> statement-breakpoint
CREATE INDEX "pipeline_stages_workspace_id_position_index" ON "pipeline_stages" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_name_uq" ON "pipeline_stages" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_workspace_id_stage_id_index" ON "contacts" USING btree ("workspace_id","stage_id");--> statement-breakpoint
-- Backfill: the six default stages for every existing workspace (new workspaces get them lazily, see lib/pipeline.ts).
INSERT INTO "pipeline_stages" ("workspace_id", "name", "position", "kind", "color", "rot_days", "probability")
SELECT w."id", s."name", s."position", s."kind", s."color", s."rot_days", s."probability"
FROM "workspaces" w
CROSS JOIN (VALUES
	('New lead', 0, 'open', 'slate', 7, 10),
	('Qualified', 1, 'open', 'blue', 7, 25),
	('Call booked', 2, 'open', 'violet', 5, 50),
	('Proposal', 3, 'open', 'amber', 10, 70),
	('Won', 4, 'won', 'emerald', NULL::integer, 100),
	('Lost', 5, 'lost', 'rose', NULL::integer, 0)
) AS s("name", "position", "kind", "color", "rot_days", "probability")
WHERE NOT EXISTS (SELECT 1 FROM "pipeline_stages" p WHERE p."workspace_id" = w."id");--> statement-breakpoint
-- Existing customers start in Won (since their first payment), everyone else in New lead.
UPDATE "contacts" c
SET "stage_id" = p."id",
	"stage_changed_at" = CASE WHEN c."lifecycle" = 'customer'
		THEN coalesce((SELECT min(r."occurred_at") FROM "revenue_events" r WHERE r."contact_id" = c."id" AND r."type" = 'payment'), c."first_seen_at")
		ELSE c."first_seen_at" END
FROM "pipeline_stages" p
WHERE p."workspace_id" = c."workspace_id" AND c."stage_id" IS NULL
	AND p."position" = CASE WHEN c."lifecycle" = 'customer' THEN 4 ELSE 0 END;