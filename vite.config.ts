import { defineConfig } from 'vite';
export default defineConfig({base:process.env.BASE_PATH || '/',server:{host:'127.0.0.1'},build:{target:'es2022'}});
