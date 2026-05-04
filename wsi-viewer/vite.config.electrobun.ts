import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/** WKWebView treats ws: separately from http:; Electrobun RPC uses ws://localhost:<port>. */
const electrobunCsp =
  "default-src 'self' wsi:; " +
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline' blob:; " +
  "img-src 'self' data: blob: wsi: http://127.0.0.1:* http://localhost:*; " +
  "connect-src 'self' wsi: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; " +
  "worker-src 'self' blob:;"

function electrobunHtmlPostProcess(): Plugin {
  return {
    name: 'electrobun-html-post',
    enforce: 'post',
    transformIndexHtml(html) {
      let out = html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*("\s*\/>)/i,
        `$1${electrobunCsp}$2`,
      )
      // WKWebView + views://: module scripts with crossorigin fail (no CORS on custom scheme).
      out = out.replace(/\s+crossorigin(?:="[^"]*")?/gi, '')
      return out
    },
  }
}

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
  plugins: [react(), electrobunHtmlPostProcess()],
})
