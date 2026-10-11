CREATE TABLE "ai_usage" (
	"account_id" text NOT NULL,
	"month" text NOT NULL,
	"suggestions" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_account_id_month_pk" PRIMARY KEY("account_id","month")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ai_settings" jsonb;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;