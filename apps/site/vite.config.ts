import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = import.meta.dirname;
const PAGES = ['index', 'features', 'pricing', 'compare', 'about', 'contact', 'early-access', 'privacy'];

/** <!-- include:header --> → partials/header.html, so every page shares one header and footer. */
function partials(): Plugin {
  // "/features" → features.html, as Vercel does (cleanUrls), also in development.
  const cleanUrls = (req: { url?: string }, _res: unknown, next: () => void) => {
    const path = req.url?.split('?')[0] ?? '';
    if (/^\/[\w-]+$/.test(path) && existsSync(resolve(root, `${path.slice(1)}.html`))) req.url = `${path}.html${req.url!.slice(path.length)}`;
    next();
  };
  return {
    name: 'replyfinch-partials',
    configureServer: (server) => void server.middlewares.use(cleanUrls),
    configurePreviewServer: (server) => void server.middlewares.use(cleanUrls),
    // "pre": before Vite reads the page's scripts and styles (the head partial brings them in).
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(/<!--\s*include:([\w-]+)\s*-->/g, (_, name: string) => readFileSync(resolve(root, 'partials', `${name}.html`), 'utf8')),
    },
  };
}

// A plain multi-page site: real HTML pages (good for search engines), a little TypeScript.
export default defineConfig({
  appType: 'mpa',
  plugins: [partials(), tailwindcss()],
  build: {
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((p) => [p, resolve(root, `${p}.html`)])),
    },
  },
});
