// Executed before a build. Do not echo key values, including on failure.
import { loadEnv } from 'vite';
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key } = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
if (!url && !key) process.exit(0); // No config intentionally builds a labeled demo.
const fail = message => { console.error(message); process.exit(1); };
if (!url || !key) fail('Set both public Supabase variables or neither for demo mode.');
try { const u = new URL(url); if (u.protocol !== 'https:' || !u.hostname.endsWith('.supabase.co')) fail('Use your hosted Supabase HTTPS URL.'); } catch { fail('Invalid Supabase URL.'); }
if (key.startsWith('sb_publishable_')) process.exit(0);
if (key.startsWith('eyJ')) {
  try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon') process.exit(0); } catch { /* invalid key */ }
}
fail('Frontend builds accept only publishable or legacy anon keys. Never use service-role or secret keys.');
