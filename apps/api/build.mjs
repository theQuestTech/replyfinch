// Bundles the API (including the workspace @replyfinch/shared package, which ships
// TypeScript source) into dist/. Third-party packages stay external.
import { build } from 'esbuild';
await build({
  entryPoints: ['src/index.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [{
    name: 'externalize-deps',
    setup(b) {
      b.onResolve({ filter: /^[^./]/ }, (args) =>
        args.path.startsWith('@replyfinch/') ? undefined : { path: args.path, external: true });
    },
  }],
});
