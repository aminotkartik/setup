/**
 * Campus+ — ESLint (flat config).
 *
 * `eslint-config-next/core-web-vitals` already ships a flat-config array in
 * Next 16, so it is spread directly instead of going through FlatCompat.
 * A few project rules then encode decisions from the product spec:
 *
 *   - no `console.log` left in application code (only `console.warn`/`error`
 *     for the deliberate, user-safe diagnostics in lib/errors.js),
 *   - no unused variables (dead code hides missing wiring),
 *   - no `dangerouslySetInnerHTML` anywhere: Campus+ renders user text as text.
 */

import next from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'database/**',
      'supabase/**',
      'scripts/dev/**',
      '.vercel/**',
    ],
  },
  ...next,
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-eq-null': 'off',
      eqeqeq: ['error', 'smart'],
      'react/no-danger': 'error',
      'react/jsx-key': 'error',
    },
  },
  {
    // The scripts and tooling are Node programs: console output is the point.
    files: ['scripts/**/*.mjs', 'tests/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
