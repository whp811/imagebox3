import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'public'),
  base: './',
  define: {
    'import.meta.env.VITE_ELECTROBUN': JSON.stringify('1'),
  },
  build: {
    outDir: resolve(__dirname, 'dist-electrobun'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
    },
  },
  optimizeDeps: {
    exclude: ['@conflux-xyz/openslide-wasm'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src/renderer') },
  },
  plugins: [react()],
})
