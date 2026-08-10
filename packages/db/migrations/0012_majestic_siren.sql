CREATE TYPE "public"."rate_type" AS ENUM('percentage', 'per_night_flat');--> statement-breakpoint
CREATE TYPE "public"."tax_type" AS ENUM('vat', 'tourist_tax', 'sales_tax');--> statement-breakpoint
CREATE TYPE "public"."deposit_claim_status" AS ENUM('pending', 'captured', 'released', 'disputed');--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"tax_type" "tax_type" NOT NULL,
	"rate_type" "rate_type" NOT NULL,
	"rate_value" numeric(10, 4) NOT NULL,
	"applies_to_unit_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"line_items" jsonb NOT NULL,
	"subtotal_in_cents" integer NOT NULL,
	"tax_in_cents" integer NOT NULL,
	"total_in_cents" integer NOT NULL,
	"pdf_url" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_account_invoice_number_unique" UNIQUE("account_id","invoice_number"),
	CONSTRAINT "invoices_reservation_unique" UNIQUE("reservation_id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deposit_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "deposit_claim_status" DEFAULT 'pending' NOT NULL,
	"evidence_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposit_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_applies_to_unit_id_units_id_fk" FOREIGN KEY ("applies_to_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_claims" ADD CONSTRAINT "deposit_claims_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_claims" ADD CONSTRAINT "deposit_claims_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_claims" ADD CONSTRAINT "deposit_claims_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "tax_rules" AS PERMISSIVE FOR ALL TO public USING ("tax_rules"."account_id"::text = current_setting('app.current_tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "invoices" AS PERMISSIVE FOR ALL TO public USING ("invoices"."account_id"::text = current_setting('app.current_tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "deposit_claims" AS PERMISSIVE FOR ALL TO public USING ("deposit_claims"."account_id"::text = current_setting('app.current_tenant_id', true));