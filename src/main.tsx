import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppProvider } from './state'
import { registerServiceWorker } from './lib/update'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)

registerServiceWorker()

// Fade the splash out once the first screen has painted, keeping it up long enough to read.
const splash = document.getElementById('splash')
if (splash) {
  const shown = performance.now()
  requestAnimationFrame(() =>
    setTimeout(() => {
      splash.classList.add('hide')
      setTimeout(() => splash.remove(), 400)
    }, Math.max(0, 900 - shown)),
  )
}
