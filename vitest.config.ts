import { defineConfig } from 'vitest/config';

// The DOM suite exercises the demo build, which is what the app serves when no
// Supabase project is configured. Pin those values so the suite does not change
// behaviour depending on whether the developer has a real .env on disk; CI only
// injects them into the Pages build step, so an unpinned local run disagreed.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/console.dom.test.tsx'],
    fileParallelism: false,
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
    },
  },
});
