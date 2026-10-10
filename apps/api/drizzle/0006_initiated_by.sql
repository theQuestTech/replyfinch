ALTER TABLE "conversations" ADD COLUMN "initiated_by" text DEFAULT 'visitor' NOT NULL;--> statement-breakpoint
-- Chats agents started before this column existed open with a "<name> started the chat" note.
UPDATE "conversations" c SET "initiated_by" = 'agent'
WHERE EXISTS (
  SELECT 1 FROM "messages" m
  WHERE m."conversation_id" = c."id" AND m."author_type" = 'system' AND m."body" LIKE '% started the chat'
);
