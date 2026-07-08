import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Pure-logic tests only. Anything that needs the real Obsidian API belongs
      // in the manual matrix, not here.
      obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Node's WebCrypto (>=19) exposes the same `crypto.subtle` surface the plugin
    // uses in the browser.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
