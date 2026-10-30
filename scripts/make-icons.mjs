// Renders public/icons/logo.svg to the PNG sizes iOS and Android need. Run: npm run icons
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

// Playwright is resolved via require so a globally installed copy works too.
const { chromium } = createRequire(import.meta.url)('playwright')

const svg = readFileSync(new URL('../public/icons/logo.svg', import.meta.url), 'utf8')
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname
const browser = await chromium.launch()
const page = await browser.newPage()

async function render(file, size, { squareBg = false, pad = 0 } = {}) {
  // Apple and maskable icons must be full-bleed squares; the OS applies its own rounding.
  const inner = squareBg ? svg.replace(/<rect width="512" height="512" rx="115"/, '<rect width="512" height="512" rx="0"') : svg
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<html><body style="margin:0;background:${squareBg ? '#1fa8c8' : 'transparent'}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">` +
      `<div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${inner.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body></html>`,
  )
  await page.screenshot({ path: out(file), omitBackground: !squareBg })
}

await render('icon-192.png', 192)
await render('icon-512.png', 512)
await render('apple-touch-icon.png', 180, { squareBg: true })
await render('icon-maskable-512.png', 512, { squareBg: true })
await browser.close()
console.log('icons written')
