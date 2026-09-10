import { cloudflare } from '@cloudflare/vite-plugin';
import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  publicDir: '../public',
  define: {
    'import.meta.env.VITE_BACKGROUND_REMOVAL_ENABLED': JSON.stringify('false'),
  },
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
