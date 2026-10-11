// Matching saved replies (shortcuts) to text: used by the composer's "/" picker and by
// free-mode AI suggest on the server.
import type { Shortcut } from '@replyfinch/shared';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Close enough to count as the same word: allows one typo (two for longer words). */
function similar(token: string, word: string): boolean {
  if (token.length < 3 || word.length < 3) return false;
  const limit = token.length >= 6 ? 2 : 1;
  if (levenshtein(token, word) <= limit) return true;
  // "shiping" → "shipping…", "refnd" → "refund": typo inside a prefix of a longer word
  return token.length >= 4 && levenshtein(token, word.slice(0, token.length)) <= 1;
}

function tokenScore(t: string, s: Shortcut): number {
  const name = norm(s.name);
  const nameParts = words(s.name);
  const tags = s.tags.flatMap(words);
  const msg = words(s.message);
  if (name === t) return 100;
  if (name.startsWith(t)) return 80;
  if (nameParts.some((p) => p.startsWith(t)) || name.includes(t)) return 60;
  if (tags.some((g) => g === t)) return 55;
  if (tags.some((g) => g.startsWith(t))) return 45;
  if (msg.some((w) => w.startsWith(t))) return 30;
  if (nameParts.some((p) => similar(t, p))) return 25;
  if (tags.some((g) => similar(t, g))) return 20;
  if (msg.some((w) => similar(t, w))) return 10;
  return 0;
}

/**
 * Rank shortcuts for a query typed after "/". Every word of the query must match the
 * shortcut's name, tags or message — exactly, as a prefix, or with a small typo.
 */
export function searchShortcuts(list: Shortcut[], query: string): Shortcut[] {
  const tokens = words(query);
  if (!tokens.length) return [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list
    .map((s) => {
      let total = 0;
      for (const t of tokens) {
        const sc = tokenScore(t, s);
        if (!sc) return null;
        total += sc;
      }
      return { s, total };
    })
    .filter((x): x is { s: Shortcut; total: number } => x !== null)
    .sort((a, b) => b.total - a.total || a.s.name.localeCompare(b.s.name))
    .map((x) => x.s);
}

/** The "/query" being typed right before the caret, if any. */
export function slashQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)\/([\w-]*)$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[2]!.length - 1, query: m[2]! };
}

/**
 * Suggest a shortcut while typing normally (no "/"): when the last word typed is a
 * shortcut's name or tag — or very close to it — offer it, e.g. "refund" → /refund.
 */
export function inlineSuggestion(list: Shortcut[], text: string, caret: number): { shortcut: Shortcut; start: number } | null {
  const before = text.slice(0, caret);
  if (/\/[\w-]*$/.test(before)) return null;
  const m = /([A-Za-z0-9][\w-]{2,})$/.exec(before);
  if (!m) return null;
  const word = norm(m[1]!);
  const best = list
    .map((s) => ({ s, score: tokenScore(word, s) }))
    .filter((x) => x.score >= 45 || (x.score >= 20 && word.length >= 5))
    .sort((a, b) => b.score - a.score)[0];
  return best ? { shortcut: best.s, start: before.length - m[1]!.length } : null;
}

// Common words that say nothing about the topic.
const STOP = new Set(
  'the and for you your are was were with this that have has had not but can could would should will just what when where which who how why our out all any get got does did its it\'s from about there their they them then than too very also into been being able please thanks thank hello hi hey dear'.split(' '),
);

/**
 * The saved reply that best answers a customer's message (free-mode AI suggest):
 * scores each shortcut on how many of the message's meaningful words it matches.
 */
export function bestShortcutFor(list: Shortcut[], message: string): Shortcut | null {
  const tokens = [...new Set(words(message).filter((w) => w.length >= 3 && !STOP.has(w)))];
  if (!tokens.length) return null;
  let best: { s: Shortcut; score: number } | null = null;
  for (const s of list) {
    let score = 0;
    for (const t of tokens) score += tokenScore(t, s);
    if (score > (best?.score ?? 0)) best = { s, score };
  }
  // Needs at least one solid match (a tag, a name, or several message words).
  return best && best.score >= 45 ? best.s : null;
}

/** Fill {{visitor.name}} / {{agent.name}} placeholders. */
export function fillShortcut(message: string, ctx: { visitorName: string | null; agentName: string }): string {
  const first = (n: string | null | undefined) => n?.trim().split(/\s+/)[0] ?? '';
  return message
    .replace(/\{\{\s*visitor\.name\s*\}\}/g, first(ctx.visitorName) || 'there')
    .replace(/\{\{\s*agent\.name\s*\}\}/g, first(ctx.agentName));
}
