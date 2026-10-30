// Export documents as PDF / JPG / long image / Word, and import PDFs as pages.
import { strToU8, zipSync } from 'fflate'
import type { NewPage, PageRec } from './db'
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d, scaleCanvas } from './image'

export type Quality = 'high' | 'medium' | 'small'
export type PageSize = 'auto' | 'a4' | 'letter'

// Max side in px and JPEG quality for each export quality level.
const QUALITY: Record<Quality, { side: number; q: number }> = {
  high: { side: 2480, q: 0.9 },
  medium: { side: 1754, q: 0.75 },
  small: { side: 1240, q: 0.55 },
}

const PAPER: Record<Exclude<PageSize, 'auto'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}

async function reencode(p: PageRec, quality: Quality): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const { side, q } = QUALITY[quality]
  if (quality === 'high' && p.blob.type === 'image/jpeg' && Math.max(p.w, p.h) <= side) {
    return { bytes: new Uint8Array(await p.blob.arrayBuffer()), w: p.w, h: p.h }
  }
  const c = scaleCanvas(await blobToCanvas(p.blob, 10000), side)
  const b = await canvasToBlob(c, 'image/jpeg', q)
  return { bytes: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height }
}

export async function buildPdf(
  pages: PageRec[],
  opts: { quality: Quality; pageSize: PageSize; password?: string; title?: string },
): Promise<Blob> {
  // Loaded on demand: pdf-lib is the largest dependency and isn't needed to start the app.
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setProducer('AnyScan')
  pdf.setCreator('AnyScan')
  if (opts.title) pdf.setTitle(opts.title)
  for (const p of pages) {
    const { bytes, w, h } = await reencode(p, opts.quality)
    const img = await pdf.embedJpg(bytes)
    if (opts.pageSize === 'auto') {
      // A4 width, image aspect ratio: keeps scans at a sensible physical size.
      const pw = 595.28
      const ph = (pw * h) / w
      pdf.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph })
    } else {
      let [pw, ph] = PAPER[opts.pageSize]
      if (w > h) [pw, ph] = [ph, pw]
      const margin = 18
      const s = Math.min((pw - margin * 2) / w, (ph - margin * 2) / h)
      const dw = w * s
      const dh = h * s
      pdf.addPage([pw, ph]).drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh })
    }
  }
  if (opts.password) {
    pdf.encrypt({ userPassword: opts.password, ownerPassword: opts.password, permissions: { printing: 'highResolution', copying: true } })
  }
  const bytes = await pdf.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

export async function buildJpgs(pages: PageRec[], quality: Quality): Promise<Blob[]> {
  const out: Blob[] = []
  for (const p of pages) {
    const { bytes } = await reencode(p, quality)
    out.push(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
  }
  return out
}

/** Stacks all pages vertically into one tall image. */
export async function buildLongImage(pages: PageRec[], quality: Quality): Promise<Blob> {
  const width = Math.min(QUALITY[quality].side, 1600)
  const gap = 12
  const heights = pages.map((p) => Math.round((p.h * width) / p.w))
  // iOS Safari limits canvases to ~16.7M pixels; shrink if needed.
  const total = heights.reduce((a, b) => a + b, 0) + gap * (pages.length - 1)
  const scale = Math.min(1, Math.sqrt(16_000_000 / (width * total)), 32000 / total)
  const c = createCanvas(width * scale, total * scale)
  const ctx = ctx2d(c)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  let y = 0
  for (let i = 0; i < pages.length; i++) {
    const src = await blobToCanvas(pages[i].blob, 10000)
    ctx.drawImage(src, 0, y * scale, c.width, heights[i] * scale)
    y += heights[i] + gap
  }
  return canvasToBlob(c, 'image/jpeg', QUALITY[quality].q)
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Builds a minimal, valid .docx (Office Open XML) containing the given text. */
export function buildDocx(text: string): Blob {
  const paras = text
    .split(/\r?\n/)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`)
    .join('')
  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        paras +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
        '</w:body></w:document>',
    ),
  }
  return new Blob([zipSync(files) as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

export class PdfPasswordError extends Error {}

/** Renders every page of a PDF file into JPEG pages. */
export async function importPdf(
  file: Blob,
  password?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<NewPage[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    if ((e as { name?: string }).name === 'PasswordException') throw new PdfPasswordError()
    throw e
  }
  const pages: NewPage[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(3, 2000 / Math.max(base.width, base.height))
    const vp = page.getViewport({ scale })
    const c = createCanvas(vp.width, vp.height)
    const ctx = ctx2d(c)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise
    pages.push({ blob: await canvasToBlob(c, 'image/jpeg', 0.88), w: c.width, h: c.height })
    onProgress?.(i, doc.numPages)
  }
  await task.destroy()
  return pages
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'AnyScan'
}
