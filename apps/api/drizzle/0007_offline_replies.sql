CREATE TABLE "offline_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"offline_message_id" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"to_email" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offline_replies" ADD CONSTRAINT "offline_replies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_replies" ADD CONSTRAINT "offline_replies_offline_message_id_offline_messages_id_fk" FOREIGN KEY ("offline_message_id") REFERENCES "public"."offline_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_replies" ADD CONSTRAINT "offline_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_replies_message_idx" ON "offline_replies" USING btree ("offline_message_id","created_at");