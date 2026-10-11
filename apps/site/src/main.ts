import './styles.css';

// Shared by every page: menu on phones, links to the agent app, our own chat widget.

const APP_URL = (import.meta.env.VITE_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const WIDGET_URL = (import.meta.env.VITE_WIDGET_URL ?? 'http://localhost:5174').replace(/\/$/, '');
const WIDGET_ACCOUNT = import.meta.env.VITE_WIDGET_ACCOUNT ?? 'acc_demo';

for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-app-link]')) a.href = `${APP_URL}${a.dataset.appLink ?? ''}`;
for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(new Date().getFullYear());

const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const menu = document.querySelector<HTMLElement>('[data-menu]');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  menu?.classList.toggle('hidden', !open);
});
menu?.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('a')) {
    toggle?.setAttribute('aria-expanded', 'false');
    menu.classList.add('hidden');
  }
});

/** "Copy" next to the install snippet. */
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  btn.addEventListener('click', () => {
    const text = document.querySelector(btn.dataset.copy!)?.textContent ?? '';
    void navigator.clipboard?.writeText(text.trim()).then(() => {
      const label = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = label), 1500);
    });
  });
}

// Replyfinch on Replyfinch: visitors chat with the team through the real widget.
const s = document.createElement('script');
s.src = import.meta.env.DEV ? `${WIDGET_URL}/src/main.ts` : `${WIDGET_URL}/widget.js`;
if (import.meta.env.DEV) s.type = 'module';
s.async = true;
s.dataset.account = WIDGET_ACCOUNT;
s.dataset.api = API_URL;
document.body.appendChild(s);

export { API_URL };
