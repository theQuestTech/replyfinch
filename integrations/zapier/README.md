# Replyfinch for Zapier

Lets anyone connect Replyfinch to thousands of apps with Zapier — no code.

**Triggers (instant):** New Chat · Chat Ended (with the transcript) · Chat Rated · New Offline Message · New Ticket · Ticket Status Changed · Customer Replied to Ticket
**Action:** Create Ticket

It signs in with a Replyfinch API key (Settings → Integrations → API keys) and uses REST hooks: when a Zap is turned on, Zapier subscribes through `POST /v1/hooks`; when it's turned off, `DELETE /v1/hooks/:id`.

## Publish it (one time, about 15 minutes)

You need a free Zapier account. Everything below runs on your own computer, in this folder.

1. Install Node.js 18 or newer from nodejs.org, then the Zapier tool:
   `npm install -g zapier-platform-cli`
2. Sign in to Zapier: `zapier login`
3. In this folder: `npm install`, then `npm test` (should say “pass 7”).
4. Create the app on Zapier and upload it:
   `zapier register "Replyfinch"` then `zapier push`
5. Try it: go to zapier.com → Create Zap → search “Replyfinch”. It's private to you for now.
   Connect it with an API key from Replyfinch → Settings → Integrations.
6. When you're happy, share it with others from developer.zapier.com → your app → Sharing,
   or submit it for the public Zapier directory (Zapier reviews it; they ask for a few live Zaps first).

After changing the code: bump `version` in package.json, then `zapier push` again.

If the Replyfinch API ever moves, set its address without changing code:
`zapier env:set 1.0.0 REPLYFINCH_API_URL=https://your-api.example.com`
