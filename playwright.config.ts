import { defineConfig } from '@playwright/test';

// These specs cover the demo build. Blank the Supabase values so the suite does
// not turn into a sign-in test when the developer has a real .env on disk.
const demoEnv = { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' };

export default defineConfig({testDir:'./tests',testMatch:'ui.spec.ts',fullyParallel:false,use:{baseURL:'http://127.0.0.1:5173',headless:true,launchOptions:{args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})}},webServer:{command:'npm run dev -- --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI,env:{...process.env,...demoEnv}},reporter:'list'});
