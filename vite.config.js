import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `npm run demo` = celá hra bez sítě a bez produkčních dat: Firebase se nahradí simulací v src/dev/mock.
export default defineConfig(({ mode }) => ({
  resolve: mode === 'demo' ? {
    alias: {
      'firebase/app': resolve(import.meta.dirname, 'src/dev/mock/app.js'),
      'firebase/auth': resolve(import.meta.dirname, 'src/dev/mock/auth.js'),
      'firebase/firestore': resolve(import.meta.dirname, 'src/dev/mock/firestore.js'),
    },
  } : {},
  build: {
    // lightningcss při minifikaci sloučil dvě pravidla .hidden a zahodil !important → modaly byly vidět
    cssMinify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
}));
