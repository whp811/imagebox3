import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

async function bootstrap() {
  if (import.meta.env.VITE_TAURI === '1') {
    const { installTauriWsiApi } = await import('./install-tauri-wsi')
    await installTauriWsiApi()
  }
}

void bootstrap().then(() => {
  const el = document.getElementById('root')!
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
