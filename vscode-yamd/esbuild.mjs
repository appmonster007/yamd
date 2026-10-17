import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

// sql.js loads its WebAssembly binary from next to the worker.
mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/sql-wasm.wasm');

// KaTeX's stylesheet and fonts for rendered math. Webviews support woff2, so the other formats
// listed in the stylesheet are left out.
mkdirSync('dist/katex/fonts', { recursive: true });
copyFileSync('node_modules/katex/dist/katex.min.css', 'dist/katex/katex.min.css');
for (const font of readdirSync('node_modules/katex/dist/fonts').filter((f) => f.endsWith('.woff2'))) {
  copyFileSync(`node_modules/katex/dist/fonts/${font}`, `dist/katex/fonts/${font}`);
}

const contexts = await Promise.all([
  esbuild.context({
    ...shared,
    entryPoints: ['src/extension/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  }),
  esbuild.context({
    ...shared,
    entryPoints: ['src/preview/main.ts'],
    outfile: 'dist/preview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  }),
  esbuild.context({
    ...shared,
    entryPoints: ['src/extension/dbWorker.ts'],
    outfile: 'dist/dbWorker.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
  }),
  esbuild.context({
    ...shared,
    entryPoints: ['src/graph/main.ts'],
    outfile: 'dist/graph.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  }),
  // Scripts for the sidebar webviews.
  esbuild.context({
    ...shared,
    entryPoints: { properties: 'src/sidebar/properties.ts', console: 'src/sidebar/console.ts' },
    outdir: 'dist',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  }),
]);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
