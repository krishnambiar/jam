import { cloudflare } from '@cloudflare/vite-plugin';
import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  publicDir: '../public',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    react(),
    sites(),
    cloudflare({
      configPath: '../wrangler.jsonc',
      viteEnvironment: { name: 'server' },
    }),
  ],
});
