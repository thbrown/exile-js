import { defineConfig } from 'vitest/config';

export default defineConfig({
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
});
