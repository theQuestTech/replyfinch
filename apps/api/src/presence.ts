import type { Redis } from 'ioredis';
import {
  deriveVisitorState,
  type AgentStatus,
  type ConversationStatus,
  type LiveVisitor,
  type PageVisit,
} from '@replyfinch/shared';

// Live presence lives in Redis, never in process memory, so any API instance can
// serve any socket (stateless servers — see docs/PLAN.md "Scaling decisions").

export interface VisitorRecord extends Omit<LiveVisitor, 'state'> {
  conversationStatus: ConversationStatus | null;
  /** Last state broadcast to agents — used to detect browsing→idle transitions. */
  lastState: LiveVisitor['state'] | null;
}

export interface AgentPresence {
  status: AgentStatus;
  conns: number;
  lastSeenAt: number;
}

const PATH_LIMIT = 25;
const k = {
  visitors: (acc: string) => `rf:${acc}:visitors`,
  visitorConns: (vid: string) => `rf:visitor:${vid}:conns`,
  agents: (acc: string) => `rf:${acc}:agents`,
  liveAccounts: 'rf:accounts:live',
};

export function toLiveVisitor(r: VisitorRecord, now = Date.now()): LiveVisitor {
  const { conversationStatus, lastState: _ls, ...rest } = r;
  return { ...rest, state: deriveVisitorState(r, conversationStatus, now) };
}

export function createPresence(redis: Redis) {
  return {
    async getVisitor(acc: string, vid: string): Promise<VisitorRecord | null> {
      const raw = await redis.hget(k.visitors(acc), vid);
      return raw ? (JSON.parse(raw) as VisitorRecord) : null;
    },

    async putVisitor(r: VisitorRecord) {
      await redis.multi().hset(k.visitors(r.accountId), r.id, JSON.stringify(r)).sadd(k.liveAccounts, r.accountId).exec();
    },

    async updateVisitor(acc: string, vid: string, fn: (r: VisitorRecord) => void): Promise<VisitorRecord | null> {
      const r = await this.getVisitor(acc, vid);
      if (!r) return null;
      fn(r);
      await this.putVisitor(r);
      return r;
    },

    async removeVisitor(acc: string, vid: string) {
      await redis.multi().hdel(k.visitors(acc), vid).del(k.visitorConns(vid)).exec();
    },

    async listVisitors(acc: string): Promise<VisitorRecord[]> {
      const all = await redis.hvals(k.visitors(acc));
      return all.map((s) => JSON.parse(s) as VisitorRecord);
    },

    async liveAccounts(): Promise<string[]> {
      return redis.smembers(k.liveAccounts);
    },

    async incrVisitorConns(vid: string) {
      return redis.incr(k.visitorConns(vid));
    },
    async decrVisitorConns(vid: string) {
      const n = await redis.decr(k.visitorConns(vid));
      if (n < 0) await redis.set(k.visitorConns(vid), 0);
      return Math.max(n, 0);
    },
    async visitorConns(vid: string) {
      return Number((await redis.get(k.visitorConns(vid))) ?? 0);
    },

    // ---------- agents ----------
    async getAgent(acc: string, uid: string): Promise<AgentPresence | null> {
      const raw = await redis.hget(k.agents(acc), uid);
      return raw ? (JSON.parse(raw) as AgentPresence) : null;
    },
    async putAgent(acc: string, uid: string, p: AgentPresence) {
      await redis.hset(k.agents(acc), uid, JSON.stringify(p));
    },
    async listAgents(acc: string): Promise<Record<string, AgentPresence>> {
      const all = await redis.hgetall(k.agents(acc));
      return Object.fromEntries(Object.entries(all).map(([id, s]) => [id, JSON.parse(s) as AgentPresence]));
    },

    /** Run fn on at most one API instance per interval (simple Redis lock). */
    async withLock(name: string, ttlMs: number, fn: () => Promise<void>) {
      const ok = await redis.set(`rf:lock:${name}`, '1', 'PX', ttlMs, 'NX');
      if (ok) await fn();
    },
  };
}
export type Presence = ReturnType<typeof createPresence>;

export function pushPage(r: VisitorRecord, page: PageVisit) {
  r.currentPage = page;
  r.path = [...r.path, page].slice(-PATH_LIMIT);
  r.lastActivityAt = page.at;
  r.lastSeenAt = page.at;
}
