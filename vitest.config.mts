/*
 * Component/hook tests. The lib-level suite still runs under node:test — this
 * exists for the things node:test cannot reach: anything that needs React to
 * actually run.
 *
 * It was added because three loading and partial-failure states shipped
 * verified only by reading. Those are precisely the states a reader depends on
 * to know their data is incomplete, and precisely the ones a happy path never
 * exercises.
 *
 * ⚠ .mts, NOT .ts. package.json has no "type": "module", so Vitest loads a
 * .ts config through require — and @vitejs/plugin-react is ESM-only, which
 * fails at startup with an "ESM file cannot be loaded by require" error that
 * points at the plugin rather than at the extension. The .mts suffix forces
 * the ESM loader without making the whole Next app ESM.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors tsconfig's `@/*` → `src/*` so tests import exactly what the app does.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  /*
   * ⚠ EXPLICIT, because tsconfig says `jsx: "preserve"` — correct for Next,
   * which does its own transform, but it leaves esbuild emitting classic
   * React.createElement calls into a test file that never imports React. The
   * symptom is "React is not defined" pointing at the render() call rather
   * than at any config.
   */
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx'],
    globals: true,
    restoreMocks: true,
  },
});
