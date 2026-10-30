import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const buildId = `${pkg.version}-${Date.now().toString(36)}`

/**
 * Finishes dist/sw.js: stamps the build id (so every deploy is a new service worker and phones
 * notice the update) and lists the files to precache, so the app opens offline even if the
 * first visit loaded them before the service worker was in control.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'anyscan-stamp-sw',
    apply: 'build',
    closeBundle() {
      const dist = new URL('./dist/', import.meta.url)
      const assets = readdirSync(new URL('assets/', dist)).map((f) => `./assets/${f}`)
      const precache = ['./', './index.html', './manifest.webmanifest', './icons/logo.svg', './icons/apple-touch-icon.png', './icons/icon-192.png', ...assets]
      const file = new URL('sw.js', dist)
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__BUILD_ID__', buildId).replace("'__PRECACHE__'", JSON.stringify(precache)))
    },
  }
}

// Relative base so the build works both at a domain root and under /ANY-Scan/ on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react(), stampServiceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
