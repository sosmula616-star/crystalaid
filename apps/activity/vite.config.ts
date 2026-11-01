import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Mode-specific values of apps/activity/.env.<mode> (only `mock` has one): the shared
  // envDir below is the repository root, so these are defined here.
  define: Object.fromEntries(
    Object.entries(loadEnv(mode, here, 'VITE_')).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  ),
  // The one .env lives in the repository root, next to the API's.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  // Only VITE_* values reach the client bundle. The root .env also holds secrets
  // (DISCORD_CLIENT_SECRET, JWT_SECRET, ...) which must never match this prefix.
  envPrefix: 'VITE_',
  server: {
    proxy: {
      // The API has no /api prefix; Discord URL Mapping strips it in production.
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Lazy sections are tiny for now, so the vendor code is split by library
        // to keep every chunk under the 500 kB warning and cacheable on its own.
        codeSplitting: {
          groups: [
            { name: 'discord-sdk', test: /node_modules[\\/](@discord|zod)[\\/]/ },
            { name: 'radix', test: /node_modules[\\/](@radix-ui|@floating-ui|aria-hidden|react-remove-scroll[^\\/]*)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
}));
