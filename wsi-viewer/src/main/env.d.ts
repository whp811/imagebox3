import 'electron'
import 'vite/client'

interface ImportMetaEnv {
  readonly VITE_DEV_SERVER_URL?: string
  readonly BASE_URL: string
  readonly DEV: boolean
  readonly PROD: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
