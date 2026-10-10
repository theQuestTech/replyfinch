# Replyfinch

Live chat and helpdesk platform: a website chat widget, a real-time agent workspace, and the API behind them.

```
apps/
  api/      Fastify + Socket.IO server, Postgres (Drizzle), Redis presence   → Railway
  web/      Agent workspace (React + Vite + Tailwind)                         → Vercel
  widget/   Embeddable website chat widget (single widget.js, ~20 KB gzip)    → Vercel
packages/
  shared/   Types, socket event contracts and validation shared by all apps
e2e/        Playwright browser tests (Home queue, Visitors, chat windows, widget)
docs/
  PLAN.md   Product plan, phases and scaling decisions
```

## Run it locally

Requirements: Node 22, pnpm 10, Docker (for Postgres + Redis).

```bash
pnpm install
cp .env.example .env
docker compose up -d          # Postgres 16 + Redis 7
pnpm db:migrate               # create tables
pnpm db:seed                  # demo account "Acme Books"
pnpm dev                      # api :4000 · agent app :5173 · demo store + widget :5174
```

- Agent app: http://localhost:5173 — sign in as `maya@replyfinch.dev` / `replyfinch` (or `daniel@replyfinch.dev`).
- Demo store with the widget: http://localhost:5174 — open the chat bubble and start a chat; it appears on the agent Home page instantly.

### Tests

```bash
pnpm typecheck
pnpm --filter @replyfinch/api test   # needs Postgres + Redis running (uses replyfinch_test DB and Redis db 15)
pnpm build
```

Browser tests (agent app + widget, real API):

```bash
pnpm --filter @replyfinch/e2e exec playwright install chromium   # once
pnpm --filter @replyfinch/e2e test:e2e                           # starts the dev servers if not running
```

Create the test database once: `docker compose exec postgres createdb -U replyfinch replyfinch_test`.

## Deploy

### 1. API on Railway

1. Railway → **New project** → **Deploy from GitHub repo** → `theQuestTech/replyfinch`.
   Railway reads `railway.json` (Dockerfile build, migrations before each deploy, `/health` check). Keep the service's root directory as the repo root.
2. In the same project: **+ New → Database → PostgreSQL**, and **+ New → Database → Redis**.
3. API service → **Variables**:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` |
   | `JWT_SECRET` | a long random string (e.g. `openssl rand -hex 32`) |
   | `NODE_ENV` | `production` |
   | `CORS_ORIGINS` | the agent app URL, e.g. `https://app.replyfinch.com` (comma-separate several) |
   | `ADMIN_EMAIL` | your login email |
   | `ADMIN_PASSWORD` | at least 10 characters |
   | `ADMIN_NAME` | your name |
   | `ACCOUNT_NAME` | your company name |

4. **Settings → Networking → Generate domain** (or add `api.replyfinch.com`).
5. After the first deploy, the deploy logs print `widget account id: acc_…` — you need it for the widget snippet.
   The admin is created once; changing `ADMIN_PASSWORD` later does not change the password.

### 2. Agent app on Vercel

1. Vercel → **Add New → Project** → import `theQuestTech/replyfinch`.
2. **Root Directory:** `apps/web` (Vercel detects the pnpm workspace; `vercel.json` sets the build).
3. **Environment variable:** `VITE_API_URL` = the Railway API URL (e.g. `https://api.replyfinch.com`).
4. Deploy, then add the domain (e.g. `app.replyfinch.com`) and make sure it is in the API's `CORS_ORIGINS`.

### 3. Widget on Vercel

1. Import the same repo again as a second project, **Root Directory:** `apps/widget`.
2. Deploy and add a domain (e.g. `widget.replyfinch.com`).
3. Add this before `</body>` on any website:

```html
<script src="https://replyfinch.vercel.app/widget.js" data-account="acc_…" data-api="https://api.replyfinch.com" async></script>
```

## How the live chat works

- The widget gets a visitor token from `POST /widget/session`, then connects to the `/visitor` Socket.IO namespace and reports page views, activity and a heartbeat.
- Agents connect to `/agent` and receive the live visitor list, conversations, messages and typing in real time.
- Opening a chat only **views** it. The agent's first message **joins** it (they become the assignee if nobody is), which posts "… joined the chat" to the visitor. Agents can also message a browsing visitor first ("Start chat").
- When no agent is online (status "Online", not Away), the widget shows a **leave a message** form instead. Messages land in the agent app's **Inbox**; agents reply by email (the button opens their mail app with the reply drafted) and mark them handled. The widget switches between the two live, as agents come and go.
- **History** lists every chat, newest first, searchable by visitor name, email or anything said, and filterable by status, agent and period.
- **Transfer** hands an open chat to a teammate (they get it in their dock and join when they type) or back to the queue for a department, with an optional internal note.
- **Settings → Chat widget** sets the widget's theme color, bubble side, greetings, departments and whether to ask for an email, with a live preview.
- Presence lives in Redis and Socket.IO uses the Redis adapter, so you can run several API instances behind a load balancer. See `docs/PLAN.md` → *Scaling decisions*.
