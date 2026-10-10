-- Before the "one open chat per visitor" rule: end any extra open chats, keeping each visitor's newest.
UPDATE "conversations" c SET "status" = 'ended', "ended_at" = now()
WHERE c."status" IN ('waiting', 'active')
  AND EXISTS (
    SELECT 1 FROM "conversations" n
    WHERE n."visitor_id" = c."visitor_id" AND n."status" IN ('waiting', 'active') AND n."id" > c."id"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_one_open_per_visitor" ON "conversations" USING btree ("visitor_id") WHERE status in ('waiting', 'active');--> statement-breakpoint
CREATE INDEX "conversations_account_started_idx" ON "conversations" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE INDEX "offline_messages_visitor_idx" ON "offline_messages" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "visitors_account_seen_idx" ON "visitors" USING btree ("account_id","last_seen_at");