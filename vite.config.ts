import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at /exile-js/; keep the dev server at root
  // so local URLs (and verify-screen.mjs) don't need to change.
  base: command === 'build' ? '/exile-js/' : '/',
  build: {
    outDir: 'docs',
  },
  server: {
    port: 5199,
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Several tests parse whole scenarios off disk (21 towns each); 5s is tight
    // on a loaded machine.
    testTimeout: 30000,
  },
}));
