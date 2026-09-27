CREATE TABLE "contact_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_stats" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revenue_minor" bigint DEFAULT 0 NOT NULL,
	"refunds_minor" bigint DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"touches" integer DEFAULT 0 NOT NULL,
	"first_touch_at" timestamp with time zone,
	"first_touch_channel" text,
	"first_touch_platform" text,
	"first_touch_campaign_id" uuid,
	"last_touch_at" timestamp with time zone,
	"last_touch_channel" text,
	"last_touch_platform" text,
	"last_touch_campaign_id" uuid,
	"first_lead_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"days_to_convert" integer,
	"last_seen_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"engagement" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"assignee_user_id" uuid,
	"created_by_user_id" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stats" ADD CONSTRAINT "contact_stats_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stats" ADD CONSTRAINT "contact_stats_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_views" ADD CONSTRAINT "contact_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_views" ADD CONSTRAINT "contact_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_notes_contact_id_created_at_index" ON "contact_notes" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_notes_workspace_id_index" ON "contact_notes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "contact_stats_workspace_id_revenue_minor_index" ON "contact_stats" USING btree ("workspace_id","revenue_minor");--> statement-breakpoint
CREATE INDEX "contact_stats_workspace_id_last_activity_at_index" ON "contact_stats" USING btree ("workspace_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "contact_stats_workspace_id_first_touch_platform_index" ON "contact_stats" USING btree ("workspace_id","first_touch_platform");--> statement-breakpoint
CREATE INDEX "contact_stats_workspace_id_first_touch_campaign_id_index" ON "contact_stats" USING btree ("workspace_id","first_touch_campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tags_uq" ON "contact_tags" USING btree ("contact_id","tag");--> statement-breakpoint
CREATE INDEX "contact_tags_workspace_id_tag_index" ON "contact_tags" USING btree ("workspace_id","tag");--> statement-breakpoint
CREATE INDEX "contact_views_workspace_id_user_id_index" ON "contact_views" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "tasks_workspace_id_assignee_user_id_done_at_due_at_index" ON "tasks" USING btree ("workspace_id","assignee_user_id","done_at","due_at");--> statement-breakpoint
CREATE INDEX "tasks_contact_id_index" ON "tasks" USING btree ("contact_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_workspace_id_first_seen_at_id_index" ON "contacts" USING btree ("workspace_id","first_seen_at","id");--> statement-breakpoint
CREATE INDEX "contacts_workspace_id_owner_user_id_index" ON "contacts" USING btree ("workspace_id","owner_user_id");