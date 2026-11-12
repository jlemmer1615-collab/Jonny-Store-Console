import { defineConfig } from 'vite';
// `preview.allowedHosts` is scoped to the Cloudflare quick-tunnel domain used for
// sharing a build for review. It is not a wildcard: unknown Host headers are still
// rejected by Vite's DNS-rebinding guard.
export default defineConfig({base:process.env.BASE_PATH || '/',server:{host:'127.0.0.1'},preview:{host:'127.0.0.1',allowedHosts:['.trycloudflare.com']},build:{target:'es2022'}});
