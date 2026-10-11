import { API_URL } from './main';

const form = document.querySelector<HTMLFormElement>('#early-access');
const error = document.querySelector<HTMLElement>('[data-error]');
const done = document.querySelector<HTMLElement>('[data-done]');

function showError(text: string) {
  if (!error) return;
  error.textContent = text;
  error.classList.remove('hidden');
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  error?.classList.add('hidden');
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  if (!data.name?.trim()) return showError('Please add your name.');
  if (!/^\S+@\S+\.\S+$/.test(data.email ?? '')) return showError('Please check your email address.');
  if (!data.fax) delete data.fax;
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const res = await fetch(`${API_URL}/widget/site/early-access`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 429) return showError('Thanks — we’ve already got a few requests from you. We’ll be in touch soon.');
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
    button.textContent = 'Request early access';
  }
});
