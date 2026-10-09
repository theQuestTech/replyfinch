-- One-time: give accounts created before shortcuts existed the starter set.
INSERT INTO "shortcuts" ("id", "account_id", "name", "message", "tags")
SELECT 'sc_' || replace(gen_random_uuid()::text, '-', ''), a.id, d.name, d.message, d.tags
FROM "accounts" a
CROSS JOIN (VALUES
  ('hi', 'Hi {{visitor.name}}, thanks for reaching out! How can I help you today?', ARRAY['greeting','hello','welcome']),
  ('one-moment', 'Thanks for waiting — let me look into that for you. It’ll just take a moment.', ARRAY['wait','checking','hold']),
  ('refund', 'I’m sorry about that! I’ve started a refund for you. You’ll see it on your original payment method within 5–7 business days.', ARRAY['money','return','charge']),
  ('shipping', 'Orders usually ship within 1–2 business days, and delivery takes 3–5 business days. You’ll get a tracking link by email as soon as it ships.', ARRAY['delivery','tracking','order']),
  ('thanks', 'You’re welcome, {{visitor.name}}! Is there anything else I can help you with today?', ARRAY['bye','closing','thank you'])
) AS d(name, message, tags)
ON CONFLICT ("account_id", "name") DO NOTHING;
