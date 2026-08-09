CREATE TYPE "public"."smart_lock_status" AS ENUM('online', 'offline', 'error');--> statement-breakpoint
CREATE TYPE "public"."access_code_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."pricing_provider" AS ENUM('pricelabs', 'beyond');--> statement-breakpoint
CREATE TABLE "smart_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_device_id" text NOT NULL,
	"device_name" text NOT NULL,
	"status" "smart_lock_status" DEFAULT 'offline' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "smart_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "access_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"smart_lock_id" uuid NOT NULL,
	"code" text NOT NULL,
	"external_access_code_id" text,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" "access_code_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "access_codes_reservation_smart_lock_unique" UNIQUE("reservation_id","smart_lock_id")
);
--> statement-breakpoint
ALTER TABLE "access_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pricing_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" "pricing_provider" NOT NULL,
	"api_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_integrations_account_provider_unique" UNIQUE("account_id","provider")
);
--> statement-breakpoint
ALTER TABLE "pricing_integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "smart_locks" ADD CONSTRAINT "smart_locks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_locks" ADD CONSTRAINT "smart_locks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_smart_lock_id_smart_locks_id_fk" FOREIGN KEY ("smart_lock_id") REFERENCES "public"."smart_locks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_integrations" ADD CONSTRAINT "pricing_integrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "smart_locks" AS PERMISSIVE FOR ALL TO public USING ("smart_locks"."account_id"::text = current_setting('app.current_tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "access_codes" AS PERMISSIVE FOR ALL TO public USING ("access_codes"."account_id"::text = current_setting('app.current_tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "pricing_integrations" AS PERMISSIVE FOR ALL TO public USING ("pricing_integrations"."account_id"::text = current_setting('app.current_tenant_id', true));