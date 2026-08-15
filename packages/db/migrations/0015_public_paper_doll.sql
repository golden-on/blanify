ALTER TYPE "public"."channel_type" ADD VALUE 'google_vacation_rentals';--> statement-breakpoint
ALTER TABLE "hosted_websites" ADD CONSTRAINT "hosted_websites_account_id_unique" UNIQUE("account_id");