import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * jsdom gives us window, document, localStorage, history, matchMedia, etc.
     * Required for any test that touches DOM helpers from main.js.
     */
    environment: 'jsdom',

    /**
     * Inject `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach`
     * globally so test files stay concise (matches Deno's test style).
     */
    globals: true,

    /**
     * Run each test file in its own worker so module-level state (e.g.
     * localStorage, `state` object in main.js) is fully isolated.
     */
    isolate: true,

    /**
     * Only pick up .test.js files under js/.
     * The Supabase Edge Function tests (*.test.ts under supabase/) use
     * Deno-specific https:// imports and must be run with `deno test` instead.
     */
    include: ['js/**/*.test.js'],

    /**
     * Coverage: scope to js/ source files only.
     * - Excludes test files themselves.
     * - Excludes config.js (credential stub injected at deploy; no logic).
     * - Excludes the Supabase Edge Function .ts files (covered by `deno test`).
     */
    coverage: {
      provider: 'v8',
      include:  ['js/**/*.js'],
      exclude:  ['js/**/*.test.js', 'js/config.js'],
      reporter: ['text', 'lcov'],
    },
  },
});
