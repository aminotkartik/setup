import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs}'],
    globals: false,
    reporters: 'default',
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
      // `server-only` intentionally throws outside a React Server environment.
      // Unit tests exercise server-side logic in plain Node, so alias it away.
      'server-only': path.resolve(process.cwd(), 'tests/helpers/server-only-stub.js'),
    },
  },
});
