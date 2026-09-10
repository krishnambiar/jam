import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'app',
  cacheDir: '../node_modules/.vite',
  define: {
    'import.meta.env.VITE_BACKGROUND_REMOVAL_ENABLED': JSON.stringify('true'),
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
