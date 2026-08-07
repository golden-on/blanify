CREATE TYPE "public"."nightly_availability_status" AS ENUM('available', 'booked', 'blocked');--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "nightly_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "nightly_availability_status" DEFAULT 'available' NOT NULL,
	"reservation_id" uuid,
	"price_in_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nightly_availability_unit_date_unique" UNIQUE("unit_id","date")
);
--> statement-breakpoint
ALTER TABLE "nightly_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nightly_availability" ADD CONSTRAINT "nightly_availability_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nightly_availability" ADD CONSTRAINT "nightly_availability_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nightly_availability" ADD CONSTRAINT "nightly_availability_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "reservations" AS PERMISSIVE FOR ALL TO public USING ("reservations"."account_id"::text = current_setting('app.current_tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "nightly_availability" AS PERMISSIVE FOR ALL TO public USING ("nightly_availability"."account_id"::text = current_setting('app.current_tenant_id', true));