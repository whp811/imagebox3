declare module 'openseadragon'
declare module '*.mjs'
declare module '*.png' {
  const src: string
  export default src
}

/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_TAURI?: string
  readonly VITE_ELECTROBUN?: string
}
