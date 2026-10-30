import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const buildId = `${pkg.version}-${Date.now().toString(36)}`

/** Stamps the build id into dist/sw.js so every deploy changes the service worker and phones notice the update. */
function stampServiceWorker(): Plugin {
  return {
    name: 'anyscan-stamp-sw',
    apply: 'build',
    closeBundle() {
      const file = new URL('./dist/sw.js', import.meta.url)
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__BUILD_ID__', buildId))
    },
  }
}

// Relative base so the build works both at a domain root and under /ANY-Scan/ on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react(), stampServiceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
