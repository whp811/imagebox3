import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Tauri-only frontend build (no Electron main/preload). Outputs to dist-tauri/.
 * Electron pipeline uses electron-vite config — unchanged.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'public'),
  base: './',
  define: {
    'import.meta.env.VITE_TAURI': JSON.stringify('1'),
  },
  server: {
    port: 5184,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist-tauri'),
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
