import './styles.css';
import { startMotion } from './motion';
import { startForms } from './forms';
import { API_URL, APP_URL, WIDGET_ACCOUNT, WIDGET_URL } from './config';

// Shared by every page: menu on phones, links to the agent app, our own chat widget.

for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-app-link]')) a.href = `${APP_URL}${a.dataset.appLink ?? ''}`;
for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(new Date().getFullYear());
for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-help-link]')) a.href = `${APP_URL}/help/${WIDGET_ACCOUNT}`;
// The page you're on, in the menu.
const here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-nav]')) {
  if (new URL(a.href).pathname === here) a.setAttribute('aria-current', 'page');
}
startMotion();
startForms();

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

