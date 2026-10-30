import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works both at a domain root and under /any-scan/ on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
