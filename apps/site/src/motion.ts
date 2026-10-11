// Motion for the website. Everything here is decoration: with reduced motion (or no JavaScript) the page is complete and still.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fade/slide elements in as they scroll into view. Children of [data-stagger] follow one another. */
function reveals() {
  for (const group of document.querySelectorAll<HTMLElement>('[data-stagger]')) {
    const step = Number(group.dataset.stagger) || 90;
    [...group.children].forEach((child, i) => {
      if (!(child instanceof HTMLElement)) return;
      if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', '');
      child.style.setProperty('--reveal-delay', `${i * step}ms`);
    });
  }
  const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (reduce || !('IntersectionObserver' in window)) {
    for (const el of items) el.classList.add('is-visible');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-visible');
        e.target.dispatchEvent(new CustomEvent('rf:visible'));
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  for (const el of items) io.observe(el);
}

/** The big product screenshot leans back and straightens as you scroll to it. */
function tilt() {
  const els = [...document.querySelectorAll<HTMLElement>('[data-tilt]')];
  if (reduce || !els.length) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      // 0 when the top is at the bottom of the screen, 1 when it's 30% from the top.
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.7)));
      el.style.setProperty('--tilt', `${(1 - p) * 14}deg`);
      el.style.setProperty('--tilt-scale', String(0.94 + p * 0.06));
    }
  };
  const onScroll = () => {
    if (!ticking) requestAnimationFrame(update);
    ticking = true;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

/** Code that types itself out when it comes into view. */
function typing() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-type]')) {
    const full = el.textContent ?? '';
    if (reduce) continue;
    el.style.minHeight = `${el.offsetHeight}px`;
    el.textContent = '';
    el.classList.add('typing-caret');
    const start = () => {
      let i = 0;
      const tick = () => {
        i = Math.min(full.length, i + (full[i] === ' ' ? 2 : 1));
        el.textContent = full.slice(0, i);
        if (i < full.length) setTimeout(tick, 16 + Math.random() * 22);
        else setTimeout(() => el.classList.remove('typing-caret'), 1200);
      };
      tick();
    };
    const host = el.closest<HTMLElement>('[data-reveal]') ?? el;
    if (host.classList.contains('is-visible')) start();
    else host.addEventListener('rf:visible', start, { once: true });
  }
}

/** Numbers that count up when shown: <span data-count="70" data-suffix="%">. */
function counters() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
    const target = Number(el.dataset.count);
    const fmt = (n: number) => `${el.dataset.prefix ?? ''}${Math.round(n).toLocaleString()}${el.dataset.suffix ?? ''}`;
    if (reduce) {
      el.textContent = fmt(target);
      continue;
    }
    el.textContent = fmt(0);
    const host = el.closest<HTMLElement>('[data-reveal]') ?? el;
    const run = () => {
      const t0 = performance.now();
      const dur = 1200;
      const frame = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        el.textContent = fmt(target * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    if (host.classList.contains('is-visible')) run();
    else host.addEventListener('rf:visible', run, { once: true });
  }
}

/** A shadow under the header once the page scrolls. */
function header() {
  const h = document.querySelector('.site-header');
  if (!h) return;
  const on = () => h.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', on, { passive: true });
  on();
}

type DemoLine = { from: 'visitor' | 'agent' | 'system'; text: string };
const DEMO: DemoLine[] = [
  { from: 'visitor', text: 'Hi! Do you ship to Canada? 🇨🇦' },
  { from: 'system', text: 'Maya joined the chat' },
  { from: 'agent', text: 'Hi Emma! We do — it takes 5–8 working days. 📦' },
  { from: 'visitor', text: 'Perfect. Could you gift wrap it?' },
  { from: 'agent', text: 'Of course! Add a gift note at checkout and we’ll wrap it for free. 🎁' },
  { from: 'visitor', text: 'Amazing, thank you!' },
];

/** A chat window that plays a conversation, typing dots and all, again and again. */
function chatDemo() {
  for (const host of document.querySelectorAll<HTMLElement>('[data-chat-demo]')) {
    const list = host.querySelector<HTMLElement>('[data-chat-lines]')!;
    const render = (line: DemoLine, animate: boolean) => {
      const el = document.createElement('div');
      el.className = `demo-line demo-${line.from}${animate ? ' demo-in' : ''}`;
      el.textContent = line.text;
      list.append(el);
      list.scrollTop = list.scrollHeight;
      return el;
    };
    if (reduce) {
      for (const l of DEMO) render(l, false);
      continue;
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let running = false;
    const play = async () => {
      if (running) return;
      running = true;
      for (;;) {
        list.innerHTML = '';
        await wait(500);
        for (const line of DEMO) {
          if (line.from !== 'system') {
            const dots = document.createElement('div');
            dots.className = `demo-line demo-${line.from} demo-typing demo-in`;
            dots.innerHTML = '<i></i><i></i><i></i>';
            dots.setAttribute('aria-hidden', 'true');
            list.append(dots);
            list.scrollTop = list.scrollHeight;
            await wait(line.from === 'agent' ? 1300 : 900);
            dots.remove();
          }
          render(line, true);
          await wait(line.from === 'system' ? 600 : 1100);
        }
        await wait(3500);
      }
    };
    const watch = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void play());
    watch.observe(host);
  }
}

export function startMotion() {
  reveals();
  tilt();
  typing();
  counters();
  header();
  chatDemo();
}
