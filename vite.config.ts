import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig({
  root: 'app',
  publicDir: '../public',
  define: {
    'import.meta.env.VITE_BACKGROUND_REMOVAL_ENABLED': JSON.stringify('true'),
  },
  build: {
    emptyOutDir: true,
    outDir: '../dist',
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
    watch: isCodexSeatbeltSandbox
      ? { useFsEvents: false, usePolling: true }
      : undefined,
  },
});
