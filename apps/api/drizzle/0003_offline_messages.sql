CREATE TABLE "offline_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"department" text,
	"message" text NOT NULL,
	"page_url" text,
	"status" text DEFAULT 'new' NOT NULL,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offline_messages" ADD CONSTRAINT "offline_messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_messages" ADD CONSTRAINT "offline_messages_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_messages" ADD CONSTRAINT "offline_messages_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_messages_account_idx" ON "offline_messages" USING btree ("account_id","status","created_at");