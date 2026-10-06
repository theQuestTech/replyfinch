# Replyfinch — product plan

A live chat and helpdesk platform with Zendesk-level features under our own brand.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0. Foundations | Monorepo, CI, auth, account separation, design tokens, deploy config | ✅ done |
| 1. Chat MVP | Widget, live visitors, chat (view → type to join), agent-started chats, agent Home page | 🔨 in progress — Home page done; Visitors and chat windows built, being polished |
| 2. Tickets and workflow | Ticket statuses, tags, custom fields, macros, transfer, email channel, search | ⏳ |
| 3. Automation and SLAs | Triggers, automations, business hours, SLA policies, CSAT, webhooks, public REST API | ⏳ |
| 4. Help center and AI | Articles, public help center, AI answer bot, reply suggestions, summaries | ⏳ |
| 5. Reporting | Live dashboard, historical reports, CSV export (ClickHouse when volume needs it) | ⏳ |
| 6. More channels and mobile | WhatsApp, Messenger, Instagram, SMS, iOS/Android SDKs, agent mobile app | ⏳ |
| 7. Enterprise | SAML/SCIM, data residency, audit log, SOC 2, billing | ⏳ |

## Hosting

- **Now:** agent app and widget on Vercel; API, Postgres and Redis on Railway.
- **Later (≈100k users or enterprise requirements):** move the API, workers and databases to AWS (ECS or Kubernetes). The frontend can stay on Vercel. Because everything is a plain Docker image with standard Postgres/Redis, this is a redeploy, not a rewrite.

## Scaling decisions (made on day one)

These cost almost nothing now and keep the path to millions of users open:

1. **Docker everywhere.** The API ships as `apps/api/Dockerfile`; any host that runs containers can run it.
2. **Stateless servers.** Visitor and agent presence live in Redis (`apps/api/src/presence.ts`), never in process memory. Socket.IO uses the Redis adapter, so any instance can serve any socket and we can add instances freely. A Redis lock makes background sweeps run on one instance at a time.
3. **`account_id` on every tenant table.** Customers can later be split across database clusters ("cells") without a schema rewrite.
4. **Time-sortable, globally unique IDs.** Prefixed ULIDs (`acc_…`, `cnv_…`, `msg_…`) can be generated on any server or shard without coordination.
5. **Idempotent message sends.** Every message carries a client-generated `clientId`; retries are de-duplicated by a unique index, so at-least-once delivery never duplicates messages.
6. **Event-shaped realtime contracts.** All realtime traffic is defined in `packages/shared/src/events.ts`; swapping Redis pub/sub for Kafka/NATS later changes the transport, not the contracts.
7. **Standard infrastructure only.** Plain Postgres, Redis and S3-compatible storage — no vendor-only features.

## What breaks first, and the fix

| Bottleneck | Fix |
|---|---|
| WebSocket connections per instance | More gateway instances (already supported); later a dedicated Go/Elixir gateway |
| Postgres writes (messages) | Partition `messages` by time; then split accounts across databases by `account_id` |
| Postgres reads (inbox, reports) | Read replicas; reports to ClickHouse |
| Search | OpenSearch fed from the event stream |
| Background jobs | Dedicated workers per job type; Kafka |
| One very large customer | Per-account rate limits; dedicated cell |
