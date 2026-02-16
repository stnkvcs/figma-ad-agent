import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const watch = process.argv.includes('--watch');

// Build code.js (Figma main thread)
const codeContext = await esbuild.context({
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2017',
  format: 'cjs',
  platform: 'neutral',
  logLevel: 'info',
});

// Build ui.js (browser context)
const uiJsContext = await esbuild.context({
  entryPoints: ['src/ui.ts'],
  bundle: true,
  outfile: 'dist/ui.bundle.js',
  target: 'es2020',
  format: 'iife',
  platform: 'browser',
  logLevel: 'info',
});

// Build ui.html with inlined JS
async function buildUI() {
  const template = readFileSync('src/ui.html', 'utf8');
  const js = readFileSync('dist/ui.bundle.js', 'utf8');
  const html = template.replace('<!-- SCRIPT_PLACEHOLDER -->', `<script>\n${js}\n</script>`);
  writeFileSync('dist/ui.html', html);
  console.log('✓ Built dist/ui.html with inlined JS');
}

if (watch) {
  await codeContext.watch();
  await uiJsContext.watch();
  console.log('👀 Watching for changes...');
} else {
  await codeContext.rebuild();
  await uiJsContext.rebuild();
  await buildUI();

  await codeContext.dispose();
  await uiJsContext.dispose();
  console.log('✅ Build complete');
}
