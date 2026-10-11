import { API_URL } from './config';

// The website's forms (early access, contact): each message becomes a ticket for the Replyfinch team.

const ENDPOINT: Record<string, string> = { 'early-access': '/widget/site/early-access', contact: '/widget/site/contact' };
const BUTTON: Record<string, string> = { 'early-access': 'Request early access', contact: 'Send message' };

export function startForms() {
  for (const form of document.querySelectorAll<HTMLFormElement>('[data-site-form]')) {
    const kind = form.dataset.siteForm!;
    const box = form.parentElement!;
    const error = box.querySelector<HTMLElement>('[data-error]');
    const done = box.querySelector<HTMLElement>('[data-done]');
    const showError = (text: string) => {
      if (!error) return;
      error.textContent = text;
      error.classList.remove('hidden');
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error?.classList.add('hidden');
      const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (!data.name?.trim()) return showError('Please add your name.');
      if (!/^\S+@\S+\.\S+$/.test(data.email ?? '')) return showError('Please check your email address.');
      if (kind === 'contact' && !data.message?.trim()) return showError('Please write a message.');
      if (!data.fax) delete data.fax;
      const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      button.disabled = true;
      button.textContent = 'Sending…';
      try {
        const res = await fetch(`${API_URL}${ENDPOINT[kind]}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.status === 429) return showError('Thanks — we’ve already got a few messages from you. We’ll be in touch soon.');
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          return showError(res.status === 400 && body.error && body.error !== 'invalid_input' ? `${body.error}.` : 'Something went wrong. Please try again, or ask us in the chat.');
        }
        form.hidden = true;
        const email = done?.querySelector('[data-done-email]');
        if (email) email.textContent = data.email!;
        if (done) done.hidden = false;
      } catch {
        showError('Couldn’t reach us. Please check your connection and try again.');
      } finally {
        button.disabled = false;
        button.textContent = BUTTON[kind] ?? 'Send';
      }
    });
  }
}
