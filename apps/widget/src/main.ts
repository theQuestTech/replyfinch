// Replyfinch website widget.
// Embed:  <script src="https://<widget-host>/widget.js" data-account="acc_…" data-api="https://<api-host>" async></script>
import { io, type Socket } from 'socket.io-client';
// Import shared code by subpath so the validation library (zod) stays out of the bundle.
import { HEARTBEAT_INTERVAL_MS } from '@replyfinch/shared/visitor-state';
import { DEFAULT_WIDGET_SETTINGS, type Conversation, type Message, type WidgetConfig } from '@replyfinch/shared/types';
import type { VisitorClientEvents, VisitorServerEvents } from '@replyfinch/shared/events';
import { styles } from './styles';

type Sock = Socket<VisitorServerEvents, VisitorClientEvents>;

const BIRD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#14213D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/></svg>';
const CHAT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
const CLOSE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const POPOUT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const SEND =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

function newSessionFlag(): boolean {
  try {
    if (sessionStorage.getItem('rf_session')) return false;
    sessionStorage.setItem('rf_session', '1');
    return true;
  } catch {
    return false;
  }
}

/** Dark text on light theme colors, white text on dark ones. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#121826' : '#FFFFFF';
}

const cid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html?: string) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html !== undefined) e.innerHTML = html;
  return e;
}

class ReplyfinchWidget {
  private socket: Sock | null = null;
  private config: WidgetConfig | null = null;
  private visitorName: string | null = null;
  private visitorEmail: string | null = null;
  private conversation: Conversation | null = null;
  private messages: Message[] = [];
  private pending = new Map<string, Message>();
  private unread = 0;
  private open = false;
  private agentTyping: string | null = null;
  private typingTimer: number | undefined;
  private isTyping = false;

  private root!: ShadowRoot;
  private wrap!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private body!: HTMLDivElement;
  private badge!: HTMLSpanElement;
  private typingEl!: HTMLDivElement;
  private composer!: HTMLDivElement;
  private subtitle!: HTMLDivElement;

  private token: string | null = null;
  private popup: Window | null = null;
  /** Any agent online? When not, the widget offers "leave a message" instead of a chat. */
  private agentsOnline = true;
  private offlineTimer: number | undefined;
  /** The visitor has typed into the pre-chat / leave-a-message form: don't swap it under them. */
  private formDirty = false;
  /** Rating an ended chat: which chat, and how far the visitor got. */
  private rating: { conversationId: string; value: 'good' | 'bad'; step: 'comment' | 'done' } | null = null;
  /** Set after a message was left: { name, email } for the thank-you note. */
  private offlineSent: { name: string; email: string } | null = null;

  constructor(
    private accountId: string,
    private api: string,
    /** popupUrl: where the pop-out chat page lives. popupToken: set when running inside that page. */
    private opts: { popupUrl?: string; popupToken?: string } = {},
  ) {}

  private get isPopup() {
    return !!this.opts.popupToken;
  }

  async start() {
    this.mount();
    const res = await fetch(`${this.api}/widget/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: this.accountId,
        visitorToken: this.opts.popupToken ?? store.get(`rf_token_${this.accountId}`) ?? undefined,
        newSession: this.isPopup ? false : newSessionFlag(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (!res.ok) throw new Error(`Replyfinch: session failed (${res.status})`);
    const s = (await res.json()) as {
      visitorToken: string;
      name: string | null;
      email: string | null;
      config: WidgetConfig;
    };
    this.token = s.visitorToken;
    if (!this.isPopup) store.set(`rf_token_${this.accountId}`, s.visitorToken);
    // Defaults first, so an older API (mid-deploy) still gives a complete config.
    this.config = { ...DEFAULT_WIDGET_SETTINGS, ...s.config };
    this.agentsOnline = s.config.agentsOnline > 0;
    this.applyTheme(this.config);
    this.visitorName = s.name;
    this.visitorEmail = s.email;
    this.renderHeader();
    this.render();
    this.connect(s.visitorToken);
    // The pop-out window isn't a page of the website, so it doesn't report page views.
    if (!this.isPopup) this.trackActivity();
    else document.title = `Chat with ${s.config.accountName}`;
  }

  // ------------------------------------------------------------- realtime
  private connect(token: string) {
    const socket: Sock = io(`${this.api}/visitor`, { auth: { token }, transports: ['websocket', 'polling'] });
    this.socket = socket;
    socket.on('connect', () => {
      if (!this.isPopup) this.sendPage();
    });
    socket.on('chat:resume', ({ conversation, messages, proactive }) => {
      this.conversation = conversation;
      this.messages = messages;
      this.render();
      if (proactive && !this.open && !this.popup) {
        this.toggle(true);
      }
    });
    socket.on('message:new', (m) => {
      if (!this.conversation || m.conversationId !== this.conversation.id) return;
      this.addMessage(m);
      if (m.authorType !== 'visitor') {
        this.agentTyping = null;
        if (!this.open && !this.popup) this.setUnread(this.unread + 1);
      }
    });
    socket.on('typing', (t) => {
      if (!this.conversation || t.conversationId !== this.conversation.id) return;
      this.agentTyping = t.isTyping ? t.name : null;
      this.renderTyping();
    });
    socket.on('agents:availability', ({ online }) => {
      window.clearTimeout(this.offlineTimer);
      if (online) return this.setAvailability(true);
      // An agent reloading their page drops offline for a moment; don't flip the widget for that.
      this.offlineTimer = window.setTimeout(() => this.setAvailability(false), 10_000);
    });
    socket.on('chat:ended', () => {
      if (this.conversation) this.conversation = { ...this.conversation, status: 'ended' };
      this.agentTyping = null;
      this.render();
    });
    setInterval(() => socket.connected && socket.emit('visitor:heartbeat'), HEARTBEAT_INTERVAL_MS);
  }

  private setAvailability(online: boolean) {
    if (online === this.agentsOnline) return;
    this.agentsOnline = online;
    this.renderHeader();
    // Only swap the start screen if the visitor hasn't started filling it in.
    if (!this.conversation && !this.formDirty && !this.offlineSent) this.render();
  }

  private sendPage() {
    this.socket?.emit('visitor:page', { url: location.href, title: document.title, referrer: document.referrer || null });
  }

  private trackActivity() {
    // Single-page apps: report client-side navigations too.
    for (const fn of ['pushState', 'replaceState'] as const) {
      const orig = history[fn];
      history[fn] = function (this: History, ...args: Parameters<typeof orig>) {
        const r = orig.apply(this, args);
        queueMicrotask(() => window.dispatchEvent(new Event('rf:navigate')));
        return r;
      };
    }
    let lastUrl = location.href;
    const onNav = () => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      setTimeout(() => this.sendPage(), 50); // let the app update document.title
    };
    window.addEventListener('rf:navigate', onNav);
    window.addEventListener('popstate', onNav);

    let last = 0;
    const ping = () => {
      const now = Date.now();
      if (now - last < 30_000) return;
      last = now;
      this.socket?.emit('visitor:activity');
    };
    for (const ev of ['mousemove', 'keydown', 'scroll', 'click', 'touchstart']) {
      window.addEventListener(ev, ping, { passive: true });
    }
  }

  // ------------------------------------------------------------- UI
  private mount() {
    const host = el('div', { id: 'replyfinch-widget' });
    document.body.appendChild(host);
    this.root = host.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = styles;
    const wrap = el('div', { class: this.isPopup ? 'rf popup' : 'rf' }) as HTMLDivElement;
    this.wrap = wrap;
    this.panel = el('div', { class: 'panel', hidden: '', role: 'dialog', 'aria-label': 'Chat' }) as HTMLDivElement;
    const header = el('div', { class: 'header' });
    header.append(el('div', { class: 'logo' }, BIRD));
    const titles = el('div');
    titles.append(el('div', { class: 'title', 'data-rf': 'title' }, 'Chat with us'));
    this.subtitle = el('div', { class: 'subtitle' }) as HTMLDivElement;
    titles.append(this.subtitle);
    header.append(titles);
    if (this.opts.popupUrl && !this.isPopup) {
      const pop = el('button', { class: 'close popout', 'aria-label': 'Open chat in a new window', title: 'Open in a new window' }, POPOUT);
      pop.addEventListener('click', () => this.popOut());
      header.append(pop);
    }
    const close = el('button', { class: 'close', 'aria-label': 'Close chat' }, CLOSE);
    if (this.isPopup) close.style.marginLeft = 'auto';
    close.addEventListener('click', () => (this.isPopup ? window.close() : this.toggle(false)));
    header.append(close);
    this.body = el('div', { class: 'body' }) as HTMLDivElement;
    this.typingEl = el('div', { class: 'typing' }) as HTMLDivElement;
    this.composer = el('div') as HTMLDivElement;
    this.panel.append(header, this.body, this.typingEl, this.composer);

    const launcher = el('button', { class: 'launcher', 'aria-label': 'Open chat' }, CHAT);
    this.badge = el('span', { class: 'badge', hidden: '' }) as HTMLSpanElement;
    launcher.append(this.badge);
    launcher.addEventListener('click', () => this.toggle());
    wrap.append(this.panel, launcher);
    this.root.append(style, wrap);
    if (this.isPopup) this.toggle(true);
  }

  /** The account's theme color and bubble position (Settings → Chat widget). */
  private applyTheme(c: WidgetConfig) {
    if (c.position === 'left') this.wrap.classList.add('left');
    if (!c.color) return;
    const on = textOn(c.color);
    for (const [k, v] of Object.entries({
      '--brand': c.color,
      '--on-brand': on,
      '--on-brand-2': on === '#FFFFFF' ? 'rgba(255,255,255,.78)' : 'rgba(18,24,38,.72)',
      '--launcher-icon': on,
      '--primary': c.color,
      '--on-primary': on,
      '--primary-subtle': `${c.color}33`,
    })) {
      this.wrap.style.setProperty(k, v);
    }
  }

  /** Move the chat into its own small window that stays open while the visitor browses. */
  private popOut() {
    if (!this.opts.popupUrl || !this.token) return;
    if (this.popup && !this.popup.closed) return this.popup.focus();
    const url = new URL(this.opts.popupUrl);
    url.searchParams.set('account', this.accountId);
    url.searchParams.set('api', this.api);
    // The token goes in the #fragment, which browsers never send to servers or in referrers.
    url.hash = `t=${encodeURIComponent(this.token)}`;
    const w = window.open(url.toString(), `replyfinch_${this.accountId}`, 'width=400,height=640,resizable=yes,scrollbars=no');
    if (!w) return; // blocked by the browser — keep chatting here
    this.popup = w;
    this.render();
    const timer = window.setInterval(() => {
      if (this.popup && !this.popup.closed) return;
      window.clearInterval(timer);
      this.popup = null;
      this.render();
    }, 800);
  }

  private toggle(force?: boolean) {
    // While popped out, the bubble brings the chat window to the front instead.
    if (this.popup && !this.popup.closed && force !== false) {
      this.popup.focus();
      if (!this.open) return;
    }
    this.open = force ?? !this.open;
    this.panel.hidden = !this.open;
    if (this.open) {
      this.setUnread(0);
      this.scrollDown();
      (this.root.querySelector('textarea, input') as HTMLElement | null)?.focus();
    }
  }

  private setUnread(n: number) {
    this.unread = n;
    this.badge.textContent = String(n);
    this.badge.hidden = n === 0;
  }

  private renderHeader() {
    const title = this.root.querySelector('[data-rf=title]');
    if (title && this.config) title.textContent = this.config.accountName;
    const online = this.agentsOnline;
    this.subtitle.innerHTML = `<span class="dot ${online ? '' : 'off'}"></span>${
      online ? 'We typically reply in a few minutes' : "We're away — leave a message and we'll reply by email"
    }`;
  }

  private render() {
    this.body.innerHTML = '';
    this.composer.innerHTML = '';
    if (this.popup && !this.popup.closed) return this.renderPoppedOut();
    if (!this.conversation) return this.agentsOnline ? this.renderPrechat() : this.renderOffline();
    for (const m of this.messages) this.body.append(this.messageEl(m));
    for (const m of this.pending.values()) this.body.append(this.messageEl(m, true));
    this.renderTyping();
    if (this.conversation.status === 'ended') this.renderEnded();
    else this.renderComposer();
    this.scrollDown();
  }

  private renderPoppedOut() {
    this.typingEl.textContent = '';
    const box = el('div', { class: 'popped', 'data-rf': 'popped' });
    box.append(el('div', { class: 'popped-title' }, 'Your chat is open in a separate window'));
    box.append(el('div', { class: 'popped-text' }, 'Keep browsing — the chat window stays open.'));
    const show = el('button', { class: 'btn' }, 'Show chat window');
    show.addEventListener('click', () => this.popup?.focus());
    const back = el('button', { class: 'btn ghost' }, 'Continue chatting here');
    back.addEventListener('click', () => {
      this.popup?.close();
      this.popup = null;
      this.render();
    });
    box.append(show, back);
    this.body.append(box);
  }

  private renderPrechat() {
    this.typingEl.textContent = '';
    const f = el('form', { class: 'prechat' }) as HTMLFormElement;
    const cfg = this.config;
    f.append(el('div', { class: 'intro' }, escapeHtml(cfg?.greeting ?? '')));
    const name = el('input', { name: 'name', required: '', placeholder: 'Your name', autocomplete: 'name' }) as HTMLInputElement;
    if (this.visitorName) name.value = this.visitorName;
    const emailAttrs: Record<string, string> = { name: 'email', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' };
    if (cfg?.emailField === 'required') emailAttrs.required = '';
    const email = el('input', emailAttrs) as HTMLInputElement;
    if (this.visitorEmail) email.value = this.visitorEmail;
    const dept = el('select', { name: 'department' }) as HTMLSelectElement;
    for (const d of cfg?.departments ?? []) dept.append(el('option', { value: d }, escapeHtml(d)));
    const message = el('textarea', { name: 'message', required: '', rows: '3', placeholder: 'How can we help?' }) as HTMLTextAreaElement;
    const label = (t: string, input: HTMLElement) => {
      const l = el('label');
      l.append(t, input);
      return l;
    };
    const err = el('div', { class: 'error' });
    const submit = el('button', { class: 'btn', type: 'submit' }, 'Start chat') as HTMLButtonElement;
    f.append(label('Name', name));
    if (cfg?.emailField !== 'hidden') f.append(label('Email', email));
    if (cfg?.departments.length) f.append(label('Department', dept));
    f.append(label('Message', message), err, submit);
    f.addEventListener('input', () => (this.formDirty = true));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.socket) return;
      submit.disabled = true;
      err.textContent = '';
      const res = await this.socket.timeout(10_000).emitWithAck('chat:start', {
        name: name.value.trim(),
        email: email.value.trim() || undefined,
        department: dept.value || undefined,
        message: message.value.trim(),
        clientId: cid(),
      }).catch(() => ({ ok: false as const, error: 'timeout' }));
      submit.disabled = false;
      if (!res.ok) {
        err.textContent = 'Something went wrong. Please try again.';
        return;
      }
      this.visitorName = name.value.trim();
      this.formDirty = false;
      this.conversation = res.data.conversation;
      this.messages = res.data.messages;
      this.render();
    });
    this.body.append(f);
  }

  /** Nobody online: collect a message and an email address to reply to. */
  private renderOffline() {
    this.typingEl.textContent = '';
    if (this.offlineSent) {
      const { name, email } = this.offlineSent;
      const box = el('div', { class: 'popped', 'data-rf': 'offline-sent' });
      box.append(el('div', { class: 'popped-title' }, `Thanks, ${escapeHtml(name.split(' ')[0] ?? name)}!`));
      const text = el('div', { class: 'popped-text' });
      text.append("We've got your message and will reply to ", el('b', {}, escapeHtml(email)), ' as soon as we can.');
      box.append(text);
      const again = el('button', { class: 'btn ghost' }, 'Send another message');
      again.addEventListener('click', () => {
        this.offlineSent = null;
        this.render();
      });
      box.append(again);
      this.body.append(box);
      return;
    }
    const f = el('form', { class: 'prechat', 'data-rf': 'offline' }) as HTMLFormElement;
    f.append(el('div', { class: 'intro' }, escapeHtml(this.config?.offlineGreeting ?? '')));
    const name = el('input', { name: 'name', required: '', placeholder: 'Your name', autocomplete: 'name' }) as HTMLInputElement;
    if (this.visitorName) name.value = this.visitorName;
    const email = el('input', { name: 'email', type: 'email', required: '', placeholder: 'you@example.com', autocomplete: 'email' }) as HTMLInputElement;
    if (this.visitorEmail) email.value = this.visitorEmail;
    const dept = el('select', { name: 'department' }) as HTMLSelectElement;
    for (const d of this.config?.departments ?? []) dept.append(el('option', { value: d }, escapeHtml(d)));
    const message = el('textarea', { name: 'message', required: '', rows: '4', placeholder: 'How can we help?' }) as HTMLTextAreaElement;
    const label = (t: string, input: HTMLElement) => {
      const l = el('label');
      l.append(t, input);
      return l;
    };
    const err = el('div', { class: 'error' });
    const submit = el('button', { class: 'btn', type: 'submit' }, 'Send message') as HTMLButtonElement;
    f.append(label('Name', name), label('Email', email));
    if (this.config?.departments.length) f.append(label('Department', dept));
    f.append(label('Message', message), err, submit);
    f.addEventListener('input', () => (this.formDirty = true));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.socket) return;
      submit.disabled = true;
      err.textContent = '';
      const sent = { name: name.value.trim(), email: email.value.trim() };
      const res = await this.socket
        .timeout(10_000)
        .emitWithAck('offline:send', {
          ...sent,
          department: dept.value || undefined,
          message: message.value.trim(),
          pageUrl: this.isPopup ? undefined : location.href,
        })
        .catch(() => ({ ok: false as const, error: 'timeout' }));
      submit.disabled = false;
      if (!res.ok) {
        err.textContent =
          res.error === 'rate_limited'
            ? "You've sent several messages already — we'll be in touch soon."
            : res.error === 'invalid_input'
              ? 'Please check your email address.'
              : 'Something went wrong. Please try again.';
        return;
      }
      this.visitorName = sent.name;
      this.visitorEmail = sent.email;
      this.offlineSent = sent;
      this.formDirty = false;
      this.render();
    });
    this.body.append(f);
  }

  private renderComposer() {
    const c = el('div', { class: 'composer' });
    const ta = el('textarea', { rows: '1', placeholder: 'Type a message…', 'aria-label': 'Message' }) as HTMLTextAreaElement;
    const send = el('button', { class: 'send', 'aria-label': 'Send' }, SEND) as HTMLButtonElement;
    const submit = () => {
      const body = ta.value.trim();
      if (!body) return;
      ta.value = '';
      this.setTyping(false);
      this.send(body);
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
      this.setTyping(ta.value.length > 0);
    });
    send.addEventListener('click', submit);
    c.append(ta, send);
    const footer = el('div', { class: 'footer' });
    footer.innerHTML = '<span>Powered by <b>Replyfinch</b></span>';
    const end = el('button', { class: 'btn ghost' }, 'End chat');
    end.addEventListener('click', () => this.conversation && this.socket?.emit('chat:end', { conversationId: this.conversation.id }));
    footer.append(end);
    this.composer.append(c, footer);
  }

  /** "How was your chat?" with thumbs up / down, then an optional comment. */
  private renderRating() {
    const conv = this.conversation;
    if (!conv || !this.config?.ratings || !this.socket) return;
    const r = this.rating?.conversationId === conv.id ? this.rating : null;
    const box = el('div', { class: 'rate', 'data-rf': 'rating' });
    const send = (value: 'good' | 'bad', comment?: string) =>
      this.socket!.timeout(8000)
        .emitWithAck('chat:rate', { conversationId: conv.id, rating: value, comment })
        .catch(() => ({ ok: false as const, error: 'timeout' }));

    if (!r) {
      box.append(el('div', { class: 'rate-title' }, 'How was your chat?'));
      const row = el('div', { class: 'rate-row' });
      for (const [value, label, emoji] of [
        ['good', 'Good', '👍'],
        ['bad', 'Bad', '👎'],
      ] as const) {
        const b = el('button', { class: 'rate-btn', 'aria-label': `Rate ${label}` }, `<span>${emoji}</span>${label}`);
        b.addEventListener('click', async () => {
          this.rating = { conversationId: conv.id, value, step: 'comment' };
          this.render();
          await send(value);
        });
        row.append(b);
      }
      box.append(row);
    } else if (r.step === 'comment') {
      box.append(el('div', { class: 'rate-title' }, r.value === 'good' ? 'Glad to hear it! Anything to add?' : "Sorry about that. What could we do better?"));
      const ta = el('textarea', { rows: '2', placeholder: 'Your comment (optional)', 'aria-label': 'Comment', maxlength: '1000' }) as HTMLTextAreaElement;
      const row = el('div', { class: 'rate-row' });
      const submit = el('button', { class: 'btn' }, 'Send') as HTMLButtonElement;
      submit.addEventListener('click', async () => {
        const comment = ta.value.trim();
        submit.disabled = true;
        if (comment) await send(r.value, comment);
        this.rating = { ...r, step: 'done' };
        this.render();
      });
      const skip = el('button', { class: 'btn ghost' }, 'Skip');
      skip.addEventListener('click', () => {
        this.rating = { ...r, step: 'done' };
        this.render();
      });
      row.append(submit, skip);
      box.append(ta, row);
    } else {
      box.append(el('div', { class: 'rate-title' }, 'Thanks for your feedback!'));
    }
    this.body.append(box);
  }

  private renderEnded() {
    this.renderRating();
    const c = el('div', { class: 'composer' });
    const again = el('button', { class: 'btn', style: 'width:100%' }, 'Start a new chat');
    again.addEventListener('click', () => {
      this.conversation = null;
      this.messages = [];
      this.render();
    });
    c.append(again);
    this.composer.append(c);
  }

  private renderTyping() {
    this.typingEl.textContent = this.agentTyping ? `${this.agentTyping} is typing…` : '';
  }

  private messageEl(m: Message, pending = false) {
    if (m.authorType === 'system') return el('div', { class: 'system' }, escapeHtml(m.body));
    const d = el('div', { class: `msg ${m.authorType}${pending ? ' pending' : ''}` });
    if (m.authorType !== 'visitor') d.append(el('div', { class: 'meta' }, escapeHtml(m.authorName)));
    const b = el('div', { class: 'bubble' });
    b.textContent = m.body;
    d.append(b);
    return d;
  }

  private addMessage(m: Message) {
    if (this.messages.some((x) => x.id === m.id)) return;
    if (m.clientId) this.pending.delete(m.clientId);
    this.messages.push(m);
    this.render();
  }

  private async send(body: string) {
    if (!this.socket || !this.conversation) return;
    const clientId = cid();
    const optimistic: Message = {
      id: `tmp_${clientId}`,
      conversationId: this.conversation.id,
      authorType: 'visitor',
      authorId: null,
      authorName: this.visitorName ?? 'You',
      body,
      internal: false,
      clientId,
      createdAt: Date.now(),
    };
    this.pending.set(clientId, optimistic);
    this.render();
    // Retries reuse the clientId, so the server stores the message once.
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.socket
        .timeout(8000)
        .emitWithAck('message:send', { conversationId: this.conversation.id, body, clientId })
        .catch(() => null);
      if (res?.ok) return this.addMessage(res.data);
      if (res && !res.ok) break;
    }
    this.pending.delete(clientId);
    this.render();
    this.body.append(el('div', { class: 'system' }, 'Message not sent — please try again.'));
  }

  private setTyping(on: boolean) {
    if (!this.socket || !this.conversation) return;
    window.clearTimeout(this.typingTimer);
    if (on) this.typingTimer = window.setTimeout(() => this.setTyping(false), 4000);
    if (on === this.isTyping) return;
    this.isTyping = on;
    this.socket.emit('typing', { conversationId: this.conversation.id, isTyping: on });
  }

  private scrollDown() {
    requestAnimationFrame(() => (this.body.scrollTop = this.body.scrollHeight));
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function boot() {
  // Inside the pop-out chat page (chat.html): settings come from the URL.
  if (document.querySelector('meta[name="replyfinch-popup"]')) {
    const q = new URLSearchParams(location.search);
    const token = new URLSearchParams(location.hash.slice(1)).get('t');
    const account = q.get('account');
    const api = (q.get('api') ?? import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    if (!account || !token) return console.warn('Replyfinch: pop-out window opened without a chat');
    history.replaceState(null, '', location.pathname + location.search); // hide the token from the address bar
    const w = new ReplyfinchWidget(account, api, { popupToken: token });
    const go = () => w.start().catch((e) => console.error(e));
    return document.body ? go() : document.addEventListener('DOMContentLoaded', go);
  }

  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-account]');
  const accountId = script?.dataset.account;
  if (!accountId) return console.warn('Replyfinch: missing data-account on the widget script tag');
  const api = (script?.dataset.api ?? import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  // chat.html sits next to widget.js (src/chat.html during development).
  const popupUrl = script?.src ? new URL('chat.html', script.src).toString() : undefined;
  const w = new ReplyfinchWidget(accountId, api, { popupUrl });
  const go = () => w.start().catch((e) => console.error(e));
  if (document.body) go();
  else document.addEventListener('DOMContentLoaded', go);
}

boot();
