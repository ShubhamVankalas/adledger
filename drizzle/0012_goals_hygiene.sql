ALTER TABLE "ad_insights_daily" ADD COLUMN "platform_conversion_value_minor" bigint;--> statement-breakpoint
CREATE TABLE "contact_duplicate_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_a_id" uuid NOT NULL,
	"contact_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"period" text DEFAULT 'month' NOT NULL,
	"target_minor" bigint,
	"target_value" numeric(14, 4),
	"budget_minor" bigint,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_duplicate_dismissals" ADD CONSTRAINT "contact_duplicate_dismissals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_duplicate_dismissals" ADD CONSTRAINT "contact_duplicate_dismissals_contact_a_id_contacts_id_fk" FOREIGN KEY ("contact_a_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_duplicate_dismissals" ADD CONSTRAINT "contact_duplicate_dismissals_contact_b_id_contacts_id_fk" FOREIGN KEY ("contact_b_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_dup_dismissals_uq" ON "contact_duplicate_dismissals" USING btree ("workspace_id","contact_a_id","contact_b_id");
--> statement-breakpoint
CREATE INDEX "contact_duplicate_dismissals_contact_b_id_index" ON "contact_duplicate_dismissals" USING btree ("contact_b_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "goals_metric_uq" ON "goals" USING btree ("workspace_id","metric");
