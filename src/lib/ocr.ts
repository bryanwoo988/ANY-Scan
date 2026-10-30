// On-device text recognition with Tesseract. The engine and language models are served
// by the app itself (see scripts/copy-ocr.mjs) and cached by the browser after first use.
import type { Worker } from 'tesseract.js'

export type OcrLang = 'eng' | 'chi_sim' | 'chi_tra' | 'msa'
export const OCR_LANGS: OcrLang[] = ['eng', 'msa', 'chi_sim', 'chi_tra']

let cached: { key: string; worker: Worker } | null = null

async function getWorker(langs: OcrLang[], onProgress: (p: number, status: string) => void): Promise<Worker> {
  const key = [...langs].sort().join('+')
  if (cached?.key === key) return cached.worker
  if (cached) await cached.worker.terminate()
  cached = null
  const { createWorker } = await import('tesseract.js')
  // The worker runs from a blob URL, so every path must be absolute.
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href
  const created = createWorker(langs, 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    logger: (m: { status: string; progress: number }) => onProgress(m.progress ?? 0, m.status ?? ''),
  })
  // If the worker script can't load, createWorker never settles; fail instead of hanging forever.
  const worker = await Promise.race([
    created,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('OCR engine failed to load')), 120_000)),
  ])
  cached = { key, worker }
  return worker
}

export async function recognize(
  images: Blob[],
  langs: OcrLang[],
  onProgress: (fraction: number, status: string) => void,
): Promise<string> {
  let page = 0
  const worker = await getWorker(langs, (p, s) => {
    if (s.startsWith('recognizing')) onProgress((page + p) / images.length, s)
    else onProgress(0, s)
  })
  const parts: string[] = []
  for (page = 0; page < images.length; page++) {
    const { data } = await worker.recognize(images[page])
    let text = data.text.trim()
    // Tesseract separates CJK characters with spaces; join them back.
    if (langs.some((l) => l.startsWith('chi'))) text = text.replace(/(?<=[　-鿿＀-￯])\s+(?=[　-鿿＀-￯])/g, '')
    parts.push(text)
    onProgress((page + 1) / images.length, 'done')
  }
  return parts.join('\n\n')
}
