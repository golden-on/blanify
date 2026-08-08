CREATE TYPE "public"."ical_sync_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "unit_ical_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"last_synced_at" timestamp,
	"sync_status" "ical_sync_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit_ical_feeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unit_ical_feeds" ADD CONSTRAINT "unit_ical_feeds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_ical_feeds" ADD CONSTRAINT "unit_ical_feeds_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "unit_ical_feeds" AS PERMISSIVE FOR ALL TO public USING ("unit_ical_feeds"."account_id"::text = current_setting('app.current_tenant_id', true));