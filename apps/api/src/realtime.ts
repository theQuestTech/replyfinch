import type { Server as HttpServer } from 'node:http';
import { Server, type Namespace, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import {
  chatInitiateSchema,
  chatRateSchema,
  transcriptRequestSchema,
  chatStartSchema,
  chatTransferSchema,
  messageSendSchema,
  offlineMessageSchema,
  OFFLINE_AFTER_MS,
  pageSchema,
  type Ack,
  type AgentClientEvents,
  type AgentServerEvents,
  type AgentStatus,
  type Conversation,
  type VisitorClientEvents,
  type VisitorServerEvents,
} from '@replyfinch/shared';
import type { Auth, AgentClaims, VisitorClaims } from './auth';
import type { Db } from './db/client';
import { pageViews } from './db/schema';
import { newId } from './ids';
import { pushPage, toLiveVisitor, type Presence, type VisitorRecord } from './presence';
import { ConversationEndedError, isUniqueViolation, type ConversationService } from './services/conversations';
import type { OfflineService } from './services/offline';
import type { MailActions } from './services/mail-actions';
import { EmailError } from './email';
import type { StatsService } from './services/stats';
import type { VisitorService } from './services/visitors';

// Rooms:
//   acc:<accountId>  every agent socket of an account
//   vis:<visitorId>  every widget socket (tab) of one visitor
//   vacc:<accountId> every widget socket of an account (agent availability)
// A visitor reloading or navigating disconnects briefly; we wait this long before
// declaring them gone.
const DEFAULT_LEAVE_GRACE_MS = 8000;
const SWEEP_INTERVAL_MS = 10_000;
/** A visitor can ask for this many transcripts per hour. */
const TRANSCRIPTS_PER_HOUR = 3;
/** A visitor can leave this many offline messages per hour. */
const OFFLINE_MESSAGES_PER_HOUR = 5;

type VisitorSocket = Socket<VisitorClientEvents, VisitorServerEvents, Record<string, never>, { claims: VisitorClaims }>;
type AgentSocket = Socket<AgentClientEvents, AgentServerEvents, Record<string, never>, { claims: AgentClaims }>;

interface Deps {
  httpServer: HttpServer;
  redis: Redis;
  db: Db;
  auth: Auth;
  presence: Presence;
  conversations: ConversationService;
  offline: OfflineService;
  mail: MailActions;
  visitors: VisitorService;
  stats: StatsService;
  corsOrigins: string[];
  leaveGraceMs?: number;
  isActiveAgent: (userId: string, iat?: number) => Promise<boolean>;
  widgetSettings: { get: (acc: string) => Promise<{ ratings: boolean }> };
}

/**
 * Register a handler that waits for the connection setup to finish (so events sent
 * right after connecting are not lost) and never lets an error crash the process.
 */
function handle<A extends unknown[]>(
  socket: Socket,
  event: string,
  ready: Promise<unknown>,
  ctx: { isClosing: () => boolean; inflight: Set<Promise<unknown>> },
  fn: (...args: A) => Promise<unknown> | unknown,
) {
  socket.on(event, (...args: unknown[]) => {
    if (ctx.isClosing()) return;
    const p = run(args).finally(() => ctx.inflight.delete(p));
    ctx.inflight.add(p);
  });
  async function run(args: unknown[]) {
    try {
      await ready;
      await fn(...(args as A));
    } catch (err) {
      const ack = args[args.length - 1];
      if (err instanceof ConversationEndedError) return fail(ack, 'conversation_ended');
      console.error(`[realtime] ${event} failed`, err);
      if (typeof ack === 'function') fail(ack, 'internal_error');
    }
  }
}

function fail(ack: unknown, error: string) {
  if (typeof ack === 'function') (ack as Ack<never>)({ ok: false, error });
}

export function createRealtime(d: Deps) {
  const io = new Server(d.httpServer, {
    cors: { origin: true, credentials: false }, // widget runs on customers' sites; auth is token-based
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  const pub = d.redis.duplicate();
  const sub = d.redis.duplicate();
  io.adapter(createAdapter(pub, sub));

  const agentsNs: Namespace<AgentClientEvents, AgentServerEvents> = io.of('/agent');
  const visitorsNs: Namespace<VisitorClientEvents, VisitorServerEvents> = io.of('/visitor');
  const leaveTimers = new Map<string, NodeJS.Timeout>();
  let closing = false;
  const ctx = { isClosing: () => closing, inflight: new Set<Promise<unknown>>() };

  /** Fixed-window counter in Redis: false once `key` was used more than `max` times in `windowSec`. */
  async function allow(key: string, max: number, windowSec: number) {
    const n = await d.redis.incr(`limit:${key}`);
    if (n === 1) await d.redis.expire(`limit:${key}`, windowSec);
    return n <= max;
  }

  const toAgents = (acc: string) => agentsNs.to(`acc:${acc}`);
  const toVisitor = (vid: string) => visitorsNs.to(`vis:${vid}`);

  async function broadcastVisitor(r: VisitorRecord) {
    const live = toLiveVisitor(r);
    if (r.lastState !== live.state) {
      r.lastState = live.state;
      await d.presence.putVisitor(r);
    }
    toAgents(r.accountId).emit('visitor:update', live);
  }

  async function broadcastTeam(acc: string) {
    const team = await d.stats.team(acc);
    toAgents(acc).emit('team:update', team);
    // Tell widgets when the account goes from "someone online" to "nobody online" or back.
    const online = team.some((t) => t.status === 'online');
    const prev = await d.redis.getset(`avail:${acc}`, online ? '1' : '0');
    if (prev !== (online ? '1' : '0')) visitorsNs.to(`vacc:${acc}`).emit('agents:availability', { online });
  }

  async function syncVisitorConversation(conv: Conversation) {
    const r = await d.presence.updateVisitor(conv.accountId, conv.visitorId, (rec) => {
      const open = conv.status !== 'ended';
      rec.conversationId = open ? conv.id : null;
      rec.conversationStatus = open ? conv.status : null;
      if (conv.visitorName) rec.name = conv.visitorName;
    });
    if (r) await broadcastVisitor(r);
  }

  async function removeVisitor(acc: string, vid: string) {
    const record = await d.presence.getVisitor(acc, vid);
    await d.presence.removeVisitor(acc, vid);
    toAgents(acc).emit('visitor:remove', { id: vid });
    // Like Zendesk: a chat ends when the visitor leaves the website.
    const open = await d.conversations.openForVisitor(vid);
    if (open) {
      const name = record?.name ?? 'The visitor';
      const ended = await d.conversations.end(open, { name, id: vid }, `${name} left the website`);
      if (!ended) return; // someone else ended it first
      toAgents(acc).emit('message:new', ended.message);
      toAgents(acc).emit('conversation:update', await d.conversations.dto(ended.conversation));
      await broadcastTeam(acc);
    }
  }

  async function setupVisitor(socket: VisitorSocket, vid: string, acc: string) {
    const pending = leaveTimers.get(vid);
    if (pending) {
      clearTimeout(pending);
      leaveTimers.delete(vid);
    }
    await d.presence.incrVisitorConns(vid);

    let record = await d.presence.getVisitor(acc, vid);
    const open = await d.conversations.openForVisitor(vid);
    if (!record) {
      const row = await d.visitors.get(acc, vid);
      if (!row) throw new Error(`unknown visitor ${vid}`);
      record = d.visitors.toRecord(row, {
        pastChats: await d.visitors.pastChats(vid),
        conversationId: open?.id ?? null,
        conversationStatus: open?.status ?? null,
        now: Date.now(),
      });
    }
    record.lastSeenAt = Date.now();
    await d.presence.putVisitor(record);
    await broadcastVisitor(record);

    socket.emit('chat:state', { openConversationId: open?.id ?? null });
    // Catch up on availability changes missed while disconnected.
    const avail = await d.redis.get(`avail:${acc}`);
    if (avail !== null) socket.emit('agents:availability', { online: avail === '1' });

    if (open) {
      socket.emit('chat:resume', {
        conversation: await d.conversations.dto(open),
        messages: await d.conversations.listMessages(open.id, { includeInternal: false }),
      });
    }
  }

  /**
   * How many tabs an agent really has open, across every API instance (via the Redis adapter).
   * Counting the live sockets — instead of +1/−1 — can't drift after a crash or a race.
   */
  async function agentConns(uid: string, fallback: number) {
    try {
      return (await agentsNs.in(`agent:${uid}`).fetchSockets()).length;
    } catch {
      return fallback;
    }
  }

  async function setupAgent(socket: AgentSocket, uid: string, acc: string) {
    const prev = await d.presence.getAgent(acc, uid);
    const status: AgentStatus = prev && prev.status !== 'offline' ? prev.status : 'online';
    await d.presence.putAgent(acc, uid, { status, conns: await agentConns(uid, (prev?.conns ?? 0) + 1), lastSeenAt: Date.now() });
    const visitors = await d.presence.listVisitors(acc);
    socket.emit('visitors:snapshot', visitors.map((v) => toLiveVisitor(v)));
    await broadcastTeam(acc);
  }

  // ---------------------------------------------------------------- visitors
  visitorsNs.use((socket, next) => {
    const claims = d.auth.verifyVisitor(socket.handshake.auth?.token);
    if (!claims) return next(new Error('unauthorized'));
    socket.data.claims = claims;
    next();
  });

  visitorsNs.on('connection', (socket: VisitorSocket) => {
    const { sub: vid, acc } = socket.data.claims;
    socket.join([`vis:${vid}`, `vacc:${acc}`]);
    const ready = setupVisitor(socket, vid, acc).catch((err) => {
      console.error('[realtime] visitor setup failed', err);
      socket.disconnect(true);
    });
    const on = <A extends unknown[]>(event: string, fn: (...a: A) => unknown) => handle<A>(socket, event, ready, ctx, fn);


    on('visitor:page', async (p: Parameters<VisitorClientEvents['visitor:page']>[0]) => {
      const parsed = pageSchema.safeParse(p);
      if (!parsed.success) return;
      if (!(await allow(`page:${vid}`, 60, 60))) return;
      const now = Date.now();
      const r = await d.presence.updateVisitor(acc, vid, (rec) => {
        if (!rec.referrer && parsed.data.referrer) rec.referrer = parsed.data.referrer;
        pushPage(rec, { url: parsed.data.url, title: parsed.data.title || parsed.data.url, at: now });
      });
      await d.db.insert(pageViews).values({
        id: newId.pageView(),
        accountId: acc,
        visitorId: vid,
        url: parsed.data.url,
        title: parsed.data.title,
        referrer: parsed.data.referrer ?? null,
      });
      if (r) await broadcastVisitor(r);
    });

    on('visitor:activity', async () => {
      const r = await d.presence.updateVisitor(acc, vid, (rec) => {
        rec.lastActivityAt = rec.lastSeenAt = Date.now();
      });
      if (r && r.lastState === 'idle') await broadcastVisitor(r);
    });

    on('visitor:heartbeat', async () => {
      await d.presence.updateVisitor(acc, vid, (rec) => {
        rec.lastSeenAt = Date.now();
      });
    });

    on('chat:start', async (...[p, ack]: Parameters<VisitorClientEvents['chat:start']>) => {
      const parsed = chatStartSchema.safeParse(p);
      if (!parsed.success) return fail(ack, 'invalid_input');
      if (!(await allow(`start:${vid}`, 10, 3600))) return fail(ack, 'rate_limited');
      const existing = await d.conversations.openForVisitor(vid);
      if (existing) {
        return ack({
          ok: true,
          data: {
            conversation: await d.conversations.dto(existing),
            messages: await d.conversations.listMessages(existing.id, { includeInternal: false }),
          },
        });
      }
      let started: Awaited<ReturnType<ConversationService['start']>>;
      try {
        started = await d.conversations.start(acc, vid, parsed.data);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Another tab started a chat at the same moment: use that one.
        const other = await d.conversations.openForVisitor(vid);
        if (!other) throw err;
        return ack({
          ok: true,
          data: { conversation: await d.conversations.dto(other), messages: await d.conversations.listMessages(other.id, { includeInternal: false }) },
        });
      }
      const conv = await d.conversations.dto(started.conversation);
      await d.presence.updateVisitor(acc, vid, (rec) => {
        rec.name = parsed.data.name;
        if (parsed.data.email) rec.email = parsed.data.email;
        if (parsed.data.phone) rec.phone = parsed.data.phone;
        rec.pastChats += 1;
        rec.lastActivityAt = Date.now();
      });
      ack({ ok: true, data: { conversation: conv, messages: started.messages } });
      // other tabs of the same visitor
      socket.to(`vis:${vid}`).emit('chat:resume', { conversation: conv, messages: started.messages });
      toAgents(acc).emit('conversation:update', conv);
      for (const m of started.messages) toAgents(acc).emit('message:new', m);
      await syncVisitorConversation(conv);
    });

    on('chat:transcript', async (...[p, ack]: Parameters<VisitorClientEvents['chat:transcript']>) => {
      const parsed = transcriptRequestSchema.safeParse(p);
      if (!parsed.success) return fail(ack, 'invalid_input');
      const conv = await d.conversations.get(acc, parsed.data.conversationId);
      if (!conv || conv.visitorId !== vid) return fail(ack, 'not_found');
      if (conv.status !== 'ended') return fail(ack, 'not_ended');
      // Only real conversations (an agent replied), so this can't be used to send spam from the
      // customer's domain; plus a cap per visitor and per account.
      if (!conv.firstReplyAt || conv.initiatedBy === 'agent' && conv.participantIds.length === 0) return fail(ack, 'not_allowed');
      if (!(await allow(`transcript:${vid}`, TRANSCRIPTS_PER_HOUR, 3600))) return fail(ack, 'rate_limited');
      if (!(await allow(`transcript-acc:${acc}`, 200, 3600))) return fail(ack, 'rate_limited');
      const v = await d.visitors.get(acc, vid);
      if (v && !v.email) await d.visitors.patch(acc, vid, { email: parsed.data.email });
      try {
        const note = await d.mail.sendTranscript(acc, conv, parsed.data.email, v?.name ?? null, { id: vid, name: v?.name ?? 'Visitor' });
        ack({ ok: true, data: { to: parsed.data.email } });
        toAgents(acc).emit('message:new', note);
      } catch (err) {
        if (!(err instanceof EmailError)) throw err;
        console.error('[email] transcript failed:', err.message);
        fail(ack, 'email_failed');
      }
    });

    on('chat:rate', async (...[p, ack]: Parameters<VisitorClientEvents['chat:rate']>) => {
      const parsed = chatRateSchema.safeParse(p);
      if (!parsed.success) return fail(ack, 'invalid_input');
      if (!(await d.widgetSettings.get(acc)).ratings) return fail(ack, 'disabled');
      if (!(await allow(`rate:${vid}`, 10, 3600))) return fail(ack, 'rate_limited');
      const conv = await d.conversations.get(acc, parsed.data.conversationId);
      if (!conv || conv.visitorId !== vid) return fail(ack, 'not_found');
      if (conv.status !== 'ended') return fail(ack, 'not_ended');
      const record = await d.presence.getVisitor(acc, vid);
      const name = record?.name ?? (await d.visitors.get(acc, vid))?.name ?? 'The visitor';
      const res = await d.conversations.rate(conv, name, parsed.data.rating, parsed.data.comment);
      ack({ ok: true, data: { ok: true } });
      toAgents(acc).emit('message:new', res.message);
      toAgents(acc).emit('conversation:update', await d.conversations.dto(res.conversation));
    });

    on('offline:send', async (...[p, ack]: Parameters<VisitorClientEvents['offline:send']>) => {
      const parsed = offlineMessageSchema.safeParse(p);
      if (!parsed.success) return fail(ack, 'invalid_input');
      const key = `offline-rate:${vid}`;
      const sent = await d.redis.incr(key);
      if (sent === 1) await d.redis.expire(key, 3600);
      if (sent > OFFLINE_MESSAGES_PER_HOUR) return fail(ack, 'rate_limited');
      const msg = await d.offline.create(acc, vid, parsed.data);
      ack({ ok: true, data: { id: msg.id } });
      toAgents(acc).emit('offline:new', msg);
      const r = await d.presence.updateVisitor(acc, vid, (rec) => {
        rec.name = parsed.data.name;
        rec.email = parsed.data.email;
        if (parsed.data.phone) rec.phone = parsed.data.phone;
        rec.lastActivityAt = Date.now();
      });
      if (r) await broadcastVisitor(r);
    });

    on('message:send', async (...[p, ack]: Parameters<VisitorClientEvents['message:send']>) => {
      const parsed = messageSendSchema.safeParse(p);
      if (!parsed.success) return fail(ack, 'invalid_input');
      if (!(await allow(`msg:${vid}`, 40, 60))) return fail(ack, 'rate_limited');
      const conv = await d.conversations.get(acc, parsed.data.conversationId);
      if (!conv || conv.visitorId !== vid) return fail(ack, 'not_found');
      if (conv.status === 'ended') return fail(ack, 'conversation_ended');
      const record = await d.presence.getVisitor(acc, vid);
      const name = record?.name ?? 'Visitor';
      const res = await d.conversations.addMessage(conv, { type: 'visitor', id: vid, name }, parsed.data.body, parsed.data.clientId);
      const msg = res.messages[res.messages.length - 1]!;
      ack({ ok: true, data: msg });
      socket.to(`vis:${vid}`).emit('message:new', msg);
      toAgents(acc).emit('message:new', msg);
      toAgents(acc).emit('conversation:update', await d.conversations.dto(res.conversation));
      await d.presence.updateVisitor(acc, vid, (rec) => {
        rec.lastActivityAt = Date.now();
      });
    });

    on('typing', async (...[p]: Parameters<VisitorClientEvents['typing']>) => {
      if (!p || typeof p.conversationId !== 'string') return;
      const conv = await d.conversations.get(acc, p.conversationId);
      if (!conv || conv.visitorId !== vid) return;
      const record = await d.presence.getVisitor(acc, vid);
      toAgents(acc).emit('typing', {
        conversationId: p.conversationId,
        authorType: 'visitor',
        name: record?.name ?? 'Visitor',
        isTyping: !!p.isTyping,
      });
    });

    on('chat:end', async (...[p]: Parameters<VisitorClientEvents['chat:end']>) => {
      const conv = p && (await d.conversations.get(acc, p.conversationId));
      if (!conv || conv.visitorId !== vid || conv.status === 'ended') return;
      const record = await d.presence.getVisitor(acc, vid);
      const ended = await d.conversations.end(conv, { name: record?.name ?? 'Visitor', id: vid });
      if (!ended) return; // someone else ended it first
      const dto = await d.conversations.dto(ended.conversation);
      toVisitor(vid).emit('message:new', ended.message);
      toVisitor(vid).emit('chat:ended', { conversationId: conv.id });
      toAgents(acc).emit('message:new', ended.message);
      toAgents(acc).emit('conversation:update', dto);
      await syncVisitorConversation(dto);
      await broadcastTeam(acc);
    });

    on('disconnect', async () => {
      const left = await d.presence.decrVisitorConns(vid);
      await d.presence.updateVisitor(acc, vid, (rec) => {
        rec.lastSeenAt = Date.now();
      });
      if (left > 0) return;
      leaveTimers.set(
        vid,
        setTimeout(async () => {
          leaveTimers.delete(vid);
          try {
            if ((await d.presence.visitorConns(vid)) === 0) await removeVisitor(acc, vid);
          } catch (err) {
            // A database or Redis hiccup must never take the server down; the sweeper retries.
            console.error('[realtime] visitor leave failed', err);
          }
        }, d.leaveGraceMs ?? DEFAULT_LEAVE_GRACE_MS),
      );
    });
  });

  // ---------------------------------------------------------------- agents
  agentsNs.use((socket, next) => {
    const claims = d.auth.verifyAgent(socket.handshake.auth?.token);
    if (!claims) return next(new Error('unauthorized'));
    d.isActiveAgent(claims.sub, claims.iat)
      .then((ok) => {
        if (!ok) return next(new Error('unauthorized'));
        socket.data.claims = claims;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  agentsNs.on('connection', (socket: AgentSocket) => {
    const { sub: uid, acc, name } = socket.data.claims;
    socket.join(`acc:${acc}`);
    socket.join(`agent:${uid}`);
    const ready = setupAgent(socket, uid, acc).catch((err) => {
      console.error('[realtime] agent setup failed', err);
      socket.disconnect(true);
    });
    const on = <A extends unknown[]>(event: string, fn: (...a: A) => unknown) => handle<A>(socket, event, ready, ctx, fn);

    on('conversation:watch', async (...[p, ack]: Parameters<AgentClientEvents['conversation:watch']>) => {
      const conv = p && (await d.conversations.get(acc, p.conversationId));
      if (!conv) return fail(ack, 'not_found');
      ack({
        ok: true,
        data: {
          conversation: await d.conversations.dto(conv),
          messages: await d.conversations.listMessages(conv.id, { includeInternal: true }),
        },
      });
    });

    on('conversation:unwatch', () => {});

    on('message:send', async (...[p, ack]: Parameters<AgentClientEvents['message:send']>) => {
      const parsed = messageSendSchema.safeParse(p);
      if (!parsed.success) return fail(ack, 'invalid_input');
      const conv = await d.conversations.get(acc, parsed.data.conversationId);
      if (!conv) return fail(ack, 'not_found');
      if (conv.status === 'ended') return fail(ack, 'conversation_ended');
      const internal = !!parsed.data.internal;
      const res = await d.conversations.addMessage(
        conv,
        { type: 'agent', id: uid, name },
        parsed.data.body,
        parsed.data.clientId,
        internal,
      );
      const msg = res.messages[res.messages.length - 1]!;
      ack({ ok: true, data: msg });
      for (const m of res.messages) {
        toAgents(acc).emit('message:new', m);
        if (!m.internal) toVisitor(conv.visitorId).emit('message:new', m);
      }
      const dto = await d.conversations.dto(res.conversation);
      toAgents(acc).emit('conversation:update', dto);
      if (res.joined) {
        await syncVisitorConversation(dto);
        await broadcastTeam(acc);
      }
    });

    on('chat:initiate', async (...[p, ack]: Parameters<AgentClientEvents['chat:initiate']>) => {
      const parsed = chatInitiateSchema.safeParse(p);
      if (!parsed.success) return fail(ack, 'invalid_input');
      const visitor = await d.visitors.get(acc, parsed.data.visitorId);
      if (!visitor) return fail(ack, 'not_found');
      if (await d.conversations.openForVisitor(visitor.id)) return fail(ack, 'already_chatting');
      let started: Awaited<ReturnType<ConversationService['startByAgent']>>;
      try {
        started = await d.conversations.startByAgent(acc, visitor.id, { id: uid, name }, parsed.data.body, parsed.data.clientId);
      } catch (err) {
        if (isUniqueViolation(err)) return fail(ack, 'already_chatting'); // the visitor (or a colleague) just started one
        throw err;
      }
      const conv = await d.conversations.dto(started.conversation);
      await d.presence.updateVisitor(acc, visitor.id, (rec) => {
        rec.pastChats += 1;
      });
      ack({ ok: true, data: { conversation: conv, messages: started.messages } });
      toVisitor(visitor.id).emit('chat:resume', { conversation: conv, messages: started.messages, proactive: true });
      toAgents(acc).emit('conversation:update', conv);
      for (const m of started.messages) toAgents(acc).emit('message:new', m);
      await syncVisitorConversation(conv);
      await broadcastTeam(acc);
    });

    on('chat:transfer', async (...[p, ack]: Parameters<AgentClientEvents['chat:transfer']>) => {
      const parsed = chatTransferSchema.safeParse(p);
      if (!parsed.success) return fail(ack, 'invalid_input');
      const conv = await d.conversations.get(acc, parsed.data.conversationId);
      if (!conv) return fail(ack, 'not_found');
      if (conv.status === 'ended') return fail(ack, 'conversation_ended');
      let target: { agent: { id: string; name: string } } | { department: string };
      if (parsed.data.toAgentId) {
        if (parsed.data.toAgentId === uid) return fail(ack, 'invalid_input');
        const member = (await d.stats.team(acc)).find((t) => t.id === parsed.data.toAgentId);
        if (!member) return fail(ack, 'not_found');
        if (member.status === 'offline') return fail(ack, 'agent_offline');
        target = { agent: { id: member.id, name: member.name } };
      } else {
        target = { department: parsed.data.department! };
      }
      const res = await d.conversations.transfer(conv, { id: uid, name }, target, parsed.data.note || undefined);
      if (!res) return fail(ack, 'conversation_ended');
      const dto = await d.conversations.dto(res.conversation);
      ack({ ok: true, data: dto });
      for (const m of res.messages) {
        toAgents(acc).emit('message:new', m);
        if (!m.internal) toVisitor(conv.visitorId).emit('message:new', m);
      }
      toAgents(acc).emit('conversation:update', dto);
      if ('agent' in target) {
        agentsNs.to(`agent:${target.agent.id}`).emit('chat:transferred', { conversation: dto, fromName: name, note: parsed.data.note || null });
      }
      await syncVisitorConversation(dto);
      await broadcastTeam(acc);
    });

    on('typing', async (...[p]: Parameters<AgentClientEvents['typing']>) => {
      const conv = p && (await d.conversations.get(acc, p.conversationId));
      if (!conv) return;
      const payload = { conversationId: conv.id, authorType: 'agent' as const, name, isTyping: !!p.isTyping };
      // Visitors only see typing from agents who already joined the chat.
      if (conv.participantIds.includes(uid)) toVisitor(conv.visitorId).emit('typing', payload);
      socket.to(`acc:${acc}`).emit('typing', payload);
    });

    on('chat:end', async (...[p]: Parameters<AgentClientEvents['chat:end']>) => {
      const conv = p && (await d.conversations.get(acc, p.conversationId));
      if (!conv || conv.status === 'ended') return;
      const ended = await d.conversations.end(conv, { name, id: uid });
      if (!ended) return; // someone else ended it first
      const dto = await d.conversations.dto(ended.conversation);
      toVisitor(conv.visitorId).emit('message:new', ended.message);
      toVisitor(conv.visitorId).emit('chat:ended', { conversationId: conv.id });
      toAgents(acc).emit('message:new', ended.message);
      toAgents(acc).emit('conversation:update', dto);
      await syncVisitorConversation(dto);
      await broadcastTeam(acc);
    });

    on('agent:status', async (...[p]: Parameters<AgentClientEvents['agent:status']>) => {
      if (!p || !['online', 'away'].includes(p.status)) return;
      const cur = await d.presence.getAgent(acc, uid);
      await d.presence.putAgent(acc, uid, { status: p.status, conns: await agentConns(uid, cur?.conns ?? 1), lastSeenAt: Date.now() });
      await broadcastTeam(acc);
    });

    on('disconnect', async () => {
      const cur = await d.presence.getAgent(acc, uid);
      const conns = await agentConns(uid, Math.max((cur?.conns ?? 1) - 1, 0));
      await d.presence.putAgent(acc, uid, { status: cur?.status ?? 'online', conns, lastSeenAt: Date.now() });
      await broadcastTeam(acc);
    });
  });

  // ---------------------------------------------------------------- sweeper
  // Drops visitors whose widget stopped sending heartbeats (e.g. a crashed API
  // instance never saw their disconnect) and announces browsing → idle changes.
  async function sweep(now = Date.now()) {
    for (const acc of await d.presence.liveAccounts()) {
      // One account's trouble must not stop the others from being swept.
      try {
        await sweepAccount(acc, now);
      } catch (err) {
        console.error(`[realtime] sweep of ${acc} failed`, err);
      }
    }
  }

  async function sweepAccount(acc: string, now: number) {
    const visitors = await d.presence.listVisitors(acc);
    // Chats whose visitor is gone (e.g. an API instance died before seeing the disconnect).
    const online = new Set(visitors.map((r) => r.id));
    const open = await d.conversations.listOpenRows(acc);
    for (const conv of open) {
      if (online.has(conv.visitorId) || now - conv.lastMessageAt.getTime() < OFFLINE_AFTER_MS) continue;
      const name = (await d.visitors.get(acc, conv.visitorId))?.name ?? 'The visitor';
      const ended = await d.conversations.end(conv, { name, id: conv.visitorId }, `${name} left the website`);
      if (!ended) continue; // someone else ended it first
      toAgents(acc).emit('message:new', ended.message);
      toAgents(acc).emit('conversation:update', await d.conversations.dto(ended.conversation));
    }
    for (const r of visitors) {
      if (now - r.lastSeenAt > OFFLINE_AFTER_MS) {
        await removeVisitor(acc, r.id);
      } else if (toLiveVisitor(r, now).state !== r.lastState) {
        await broadcastVisitor(r);
      }
    }
    // Agents still counted as connected after a crash: recount their real sockets.
    let teamChanged = false;
    let agentsOnline = 0;
    for (const [uid, a] of Object.entries(await d.presence.listAgents(acc))) {
      if (a.conns <= 0) continue;
      const conns = await agentConns(uid, a.conns);
      if (conns !== a.conns) {
        await d.presence.putAgent(acc, uid, { ...a, conns });
        teamChanged = true;
      }
      if (conns > 0) agentsOnline++;
    }
    if (teamChanged) await broadcastTeam(acc);
    if (visitors.length === 0 && agentsOnline === 0 && open.length === 0) await d.presence.dropLiveAccount(acc);
  }

  const sweeper = setInterval(() => {
    d.presence.withLock('sweep', SWEEP_INTERVAL_MS - 1000, () => sweep()).catch((err) => console.error('[realtime] sweep failed', err));
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  return {
    io,
    sweep,
    async close() {
      clearInterval(sweeper);
      for (const t of leaveTimers.values()) clearTimeout(t);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      // Let disconnect handlers triggered by io.close() finish before the DB closes.
      closing = true;
      await Promise.allSettled([...ctx.inflight]);
      pub.disconnect();
      sub.disconnect();
    },
    /** Re-broadcast the team list after profile or team changes. */
    teamChanged: (acc: string) => broadcastTeam(acc),
    /** Sign out a removed agent everywhere, immediately. */
    async disconnectAgent(uid: string) {
      agentsNs.in(`agent:${uid}`).disconnectSockets(true);
    },
    /** Show a new message (e.g. an agents-only note) to the account's agents. */
    announce: (acc: string, m: Parameters<AgentServerEvents['message:new']>[0]) => toAgents(acc).emit('message:new', m),
    /** An agent marked an offline message handled (or reopened it). */
    offlineChanged: (acc: string, m: Parameters<AgentServerEvents['offline:update']>[0]) => toAgents(acc).emit('offline:update', m),
    /** Push profile edits made over REST to everyone watching. */
    async visitorChanged(acc: string, vid: string, patch: Partial<VisitorRecord>) {
      const r = await d.presence.updateVisitor(acc, vid, (rec) => Object.assign(rec, patch));
      if (r) await broadcastVisitor(r);
    },
  };
}
export type Realtime = ReturnType<typeof createRealtime>;
