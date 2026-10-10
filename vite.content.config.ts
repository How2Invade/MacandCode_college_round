import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false, // Do not clear the directory so main build is kept
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'HandsfreeContent',
      formats: ['iife'], // IIFE format wraps the code so it doesn't use import/export
      fileName: () => 'content.js'
    },
    rollupOptions: {
      output: {
        extend: true
      }
    }
  },
});
