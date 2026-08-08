CREATE TABLE "hosted_websites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"subdomain" text NOT NULL,
	"custom_domain" text,
	"theme_config" jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hosted_websites_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "hosted_websites_custom_domain_unique" UNIQUE("custom_domain")
);
--> statement-breakpoint
ALTER TABLE "hosted_websites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "website_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"website_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"layout_schema" jsonb NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "website_pages_website_id_slug_unique" UNIQUE("website_id","slug")
);
--> statement-breakpoint
ALTER TABLE "website_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hosted_websites" ADD CONSTRAINT "hosted_websites_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_website_id_hosted_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."hosted_websites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "hosted_websites" AS PERMISSIVE FOR ALL TO public USING ("hosted_websites"."account_id"::text = current_setting('app.current_tenant_id', true));--> statement-breakpoint
CREATE POLICY "public_read_published_policy" ON "hosted_websites" AS PERMISSIVE FOR SELECT TO public USING ("hosted_websites"."is_published" = true);--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "website_pages" AS PERMISSIVE FOR ALL TO public USING ("website_pages"."account_id"::text = current_setting('app.current_tenant_id', true));--> statement-breakpoint
CREATE POLICY "public_read_published_policy" ON "website_pages" AS PERMISSIVE FOR SELECT TO public USING ("website_pages"."is_published" = true);