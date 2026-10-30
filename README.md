<p align="center"><img src="public/icons/icon-192.png" width="96" alt="AnyScan logo"></p>

# AnyScan

A free document scanner for your phone. There is no account, no subscription, no ads and no watermark, and nothing gets uploaded: scans are processed and stored inside your phone's browser.

It's a web app (PWA). Open it in Safari or Chrome and add it to your home screen; from then on it runs full screen like a normal app and keeps working offline.

**Languages:** English · 简体中文 · Bahasa Melayu. On first launch AnyScan asks which language to use (English is preselected); change it anytime under **Settings › Language**.

## Features

| Area | Tools |
|---|---|
| Scan | Smart Scan (finds the paper edges automatically, lets you drag the corners, flattens the perspective), multi-page scanning, filters (Magic / Enhance / Grayscale / B&W), rotate |
| ID | ID Card (front and back on one A4 page at real card size), ID Photo (Malaysia passport 35×50, 35×45, US 2×2, China visa, 1″, 2″, plus a 4R print sheet) |
| Text | Extract Text (on-device OCR for English, Malay, Simplified and Traditional Chinese), To Word (.docx), copy, .txt |
| QR code | Scan QR with the camera or from a photo; create QR codes for URL, text, Wi-Fi, contact (vCard), phone, email and SMS; colours, error correction, history |
| Convert | PDF, JPG images, long image, Word |
| Edit | Sign (draw and save signatures), Watermark, Merge, Extract pages, Reorder/rotate/delete pages, Password lock (AES-256 PDF), Compress (High/Medium/Small, shows the file size) |
| Other | Import images or PDFs from Files, Timestamp photos, Print, share sheet / Save to Files, dark & light mode |

## Install on iPhone

1. Open the app URL in **Safari** (after the first deploy: `https://<your-github-username>.github.io/any-scan/`).
2. Tap **Share** ⎋ → **Add to Home Screen**.
3. Open AnyScan from the home screen icon.

Your documents live in that home-screen app's storage. If you delete the app from the home screen, or clear Safari website data, the scans go with it, so share anything important to Files or iCloud Drive.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run build      # type-check + production build into dist/
npm run icons      # re-render PNG icons from public/icons/logo.svg (needs Playwright)
```

Stack: React 19 + TypeScript + Vite. `npm run dev`/`build` first copy the OCR engine and language files from `node_modules` into `public/ocr` (`scripts/copy-ocr.mjs`). PDF writing and encryption use `@cantoo/pdf-lib`, PDF import uses `pdfjs-dist`, OCR uses `tesseract.js`, and QR codes use `qrcode` (generate) and `jsqr` / the native `BarcodeDetector` (read). The perspective correction, edge detection and scan filters are hand-written canvas code in `src/lib/image.ts`.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which tests, builds and publishes to GitHub Pages. You need to turn it on once: **Repo Settings › Pages › Build and deployment › Source: GitHub Actions**.

## Known limits

- Auto edge detection (`src/lib/detect.ts`) combines several colour/brightness segmentations with edge snapping. It handles light tables, coloured cards, rotated paper and patterned backgrounds, but a page whose edge is nearly invisible (e.g. a black header on a black table) can still need a manual corner drag.
- OCR runs on the phone. The first use downloads the engine (~4 MB) and each language (1–3 MB) from the app's own site, not a third-party CDN; after that it works offline. Accuracy depends on photo quality, and handwriting isn't supported.
- ID Photo crops and sizes the photo. It doesn't remove or replace the background, so shoot against a plain light wall.
- Edits such as signatures and watermarks are baked into the page image. Signatures are drawn images, not certified digital signatures.
