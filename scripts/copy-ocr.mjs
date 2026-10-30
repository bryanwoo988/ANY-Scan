// Copies the OCR engine and language data from node_modules into public/ocr so the app
// serves them itself instead of depending on a third-party CDN. Runs before dev and build.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const files = {
  'node_modules/tesseract.js/dist/worker.min.js': 'worker.min.js',
  // Only the LSTM cores are needed (the app always uses the LSTM engine); the worker picks one by CPU features.
  'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js': 'core/tesseract-core-lstm.wasm.js',
  'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js': 'core/tesseract-core-simd-lstm.wasm.js',
  'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js': 'core/tesseract-core-relaxedsimd-lstm.wasm.js',
}
for (const lang of ['eng', 'msa', 'chi_sim', 'chi_tra']) {
  files[`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`] = `lang/${lang}.traineddata.gz`
}
for (const [from, to] of Object.entries(files)) {
  const dest = `${root}public/ocr/${to}`
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(`${root}${from}`, dest)
}
console.log(`copied ${Object.keys(files).length} OCR files to public/ocr`)
