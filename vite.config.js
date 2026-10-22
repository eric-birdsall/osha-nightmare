import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works at https://<user>.github.io/osha-nightmare/
  base: './',
  build: {
    target: 'es2022', // top-level await for Rapier init
    chunkSizeWarningLimit: 6000, // Rapier inlines its wasm
  },
});
