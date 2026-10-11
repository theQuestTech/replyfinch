import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// A plain multi-page site: real HTML pages (good for search engines), a little TypeScript.
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        earlyAccess: resolve(import.meta.dirname, 'early-access.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
      },
    },
  },
});
