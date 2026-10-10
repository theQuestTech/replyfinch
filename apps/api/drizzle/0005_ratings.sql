ALTER TABLE "conversations" ADD COLUMN "rating" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "rating_comment" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "rated_at" timestamp with time zone;