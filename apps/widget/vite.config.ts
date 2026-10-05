import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// `vite` serves a demo store (index.html, pricing.html) with the widget embedded.
// `vite build` produces a single self-contained dist/widget.js for websites to embed.
export default defineConfig({
  build: {
    lib: { entry: resolve(__dirname, 'src/main.ts'), name: 'Replyfinch', formats: ['iife'], fileName: () => 'widget.js' },
    target: 'es2019',
    copyPublicDir: true,
  },
});
