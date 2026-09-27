CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"metric" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"value" numeric(20, 4),
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"delivered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text DEFAULT 'threshold' NOT NULL,
	"name" text NOT NULL,
	"metric" text NOT NULL,
	"comparator" text DEFAULT 'gt' NOT NULL,
	"threshold_minor" bigint,
	"threshold_value" numeric(14, 4),
	"window_days" integer DEFAULT 1 NOT NULL,
	"scope" text DEFAULT 'workspace' NOT NULL,
	"scope_id" text,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cooldown_hours" integer DEFAULT 24 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"state" text DEFAULT 'ok' NOT NULL,
	"last_value" numeric(20, 4),
	"last_evaluated_at" timestamp with time zone,
	"last_triggered_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unverified_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"page" text DEFAULT 'overview' NOT NULL,
	"filters" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_workspace_id_created_at_index" ON "alert_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_events_rule_id_index" ON "alert_events" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_rules_workspace_id_kind_index" ON "alert_rules" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "ask_messages_workspace_id_user_id_created_at_index" ON "ask_messages" USING btree ("workspace_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_uq" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_workspace_id_created_at_index" ON "share_links" USING btree ("workspace_id","created_at");