// PDF → Word (.docx) and PDF → PowerPoint (.pptx), written directly as Office Open XML (no server).
// Text comes from the PDF's own text layer; pages without one (scans) can be read with OCR.
import { strToU8, zipSync, type Zippable } from 'fflate'
import { canvasToBlob, createCanvas, ctx2d } from './image'

// ---------------------------------------------------------------- reading PDFs

/** A run of text on a page, in PDF points with the origin at the top left; y is the baseline. */
export interface TextItem {
  str: string
  x: number
  y: number
  w: number
  fs: number
}

export interface SourcePage {
  /** Page size in points (1/72 in). */
  w: number
  h: number
  image: Blob
  imageW: number
  imageH: number
  items: TextItem[]
}

export class PdfLockedError extends Error {}

/** Loads a PDF: a picture of every page plus its text with positions. */
export async function readPdf(file: Blob, password: string | undefined, onProgress: (done: number, total: number) => void): Promise<SourcePage[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    if ((e as { name?: string }).name === 'PasswordException') throw new PdfLockedError()
    throw e
  }
  const out: SourcePage[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp1 = page.getViewport({ scale: 1 })
    const scale = Math.min(3, 2000 / Math.max(vp1.width, vp1.height))
    const vp = page.getViewport({ scale })
    const c = createCanvas(vp.width, vp.height)
    const ctx = ctx2d(c)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise
    const content = await page.getTextContent()
    const items: TextItem[] = []
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue
      const m = pdfjs.Util.transform(vp1.transform, it.transform)
      const fs = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1])
      items.push({ str: it.str, x: m[4], y: m[5], w: it.width, fs })
    }
    out.push({ w: vp1.width, h: vp1.height, image: await canvasToBlob(c, 'image/jpeg', 0.9), imageW: c.width, imageH: c.height, items })
    onProgress(i, doc.numPages)
  }
  await task.destroy()
  return out
}

// ---------------------------------------------------------------- text layout

export interface Line {
  text: string
  x: number
  y: number
  w: number
  fs: number
}

export interface Para {
  text: string
  /** Font size in points. */
  fs: number
  bold: boolean
  center: boolean
}

const CJK = /[　-鿿가-힯＀-￯]/
/** Joins two pieces of text, adding a space unless either side is CJK or already spaced. */
function join(a: string, b: string): string {
  if (!a) return b
  if (/\s$/.test(a) || /^\s/.test(b)) return a + b
  if (CJK.test(a.slice(-1)) && CJK.test(b[0])) return a + b
  if (a.endsWith('-') && /[a-z]/i.test(a.slice(-2, -1))) return a.slice(0, -1) + b // re-join hyphenated words
  return a + ' ' + b
}

/** Groups text items into lines (top to bottom, left to right). */
export function toLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: TextItem[][] = []
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) < Math.max(l[0].fs, it.fs) * 0.5)
    if (line) line.push(it)
    else lines.push([it])
  }
  return lines
    .map((l) => {
      l.sort((a, b) => a.x - b.x)
      let text = ''
      let end = -Infinity
      for (const it of l) {
        const gap = it.x - end
        text = gap > it.fs * 0.15 && text && !/\s$/.test(text) && !/^\s/.test(it.str) && !(CJK.test(text.slice(-1)) && CJK.test(it.str[0])) ? text + ' ' + it.str : text + it.str
        end = it.x + it.w
      }
      const x = l[0].x
      return { text: text.trim(), x, y: l[0].y, w: end - x, fs: Math.max(...l.map((i) => i.fs)) }
    })
    .filter((l) => l.text)
    .sort((a, b) => a.y - b.y)
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0

/** Turns lines into paragraphs: a new one starts after a larger gap or a change of text size. */
export function toParagraphs(lines: Line[], pageW: number): Para[] {
  const body = median(lines.map((l) => l.fs)) || 11
  const paras: Para[] = []
  let cur: { lines: Line[] } | null = null
  const flush = () => {
    if (!cur) return
    const ls = cur.lines
    const fs = median(ls.map((l) => l.fs))
    const center = ls.every((l) => Math.abs(l.x + l.w / 2 - pageW / 2) < pageW * 0.04 && l.w < pageW * 0.7)
    paras.push({ text: ls.reduce((s, l) => join(s, l.text), ''), fs, bold: fs >= body * 1.25, center })
    cur = null
  }
  for (const l of lines) {
    const prev = cur?.lines[cur.lines.length - 1]
    const newPara = !prev || l.y - prev.y > Math.max(prev.fs, l.fs) * 1.75 || Math.abs(l.fs - prev.fs) > prev.fs * 0.2 || (l.x - prev.x > prev.fs * 1.5 && l.y - prev.y > 0)
    if (newPara) flush()
    if (!cur) cur = { lines: [] }
    cur.lines.push(l)
  }
  flush()
  return paras
}

/** Paragraphs from OCR text (blank lines separate paragraphs). */
export function parasFromText(text: string): Para[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').reduce((s, l) => join(s, l.trim()), '').trim())
    .filter(Boolean)
    .map((t) => ({ text: t, fs: 11, bold: false, center: false }))
}

// ---------------------------------------------------------------- Office Open XML

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// XML 1.0 forbids most control characters; PDFs sometimes contain them.
const clean = (s: string) => esc(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''))
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const EMU_PER_PT = 12700
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function rels(list: [id: string, type: string, target: string][]): Uint8Array {
  return strToU8(
    XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('') +
      '</Relationships>',
  )
}

async function bytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer())
}

export type DocxPage = { kind: 'text'; w: number; h: number; paras: Para[] } | { kind: 'image'; w: number; h: number; image: Blob }

/**
 * Builds a .docx. Text pages become editable paragraphs on a page of the same size; image pages
 * become a full-page picture with no margins, so they look exactly like the PDF.
 */
export async function buildDocxPages(pages: DocxPage[]): Promise<Blob> {
  const files: Zippable = {}
  const relList: [string, string, string][] = []
  let body = ''
  let pic = 0
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const tw = Math.round(p.w * 20) // points → twentieths of a point
    const th = Math.round(p.h * 20)
    let margin = 0
    if (p.kind === 'text') {
      margin = 1080 // 0.75 in
      body += p.paras.length
        ? p.paras
            .map((q) => {
              const sz = Math.round(Math.min(72, Math.max(7, q.fs)) * 2)
              return `<w:p><w:pPr>${q.center ? '<w:jc w:val="center"/>' : ''}<w:spacing w:after="${Math.round(q.fs * 6)}"/></w:pPr><w:r><w:rPr>${q.bold ? '<w:b/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${clean(q.text)}</w:t></w:r></w:p>`
            })
            .join('')
        : '<w:p/>'
    } else {
      pic++
      const id = `rIdImg${pic}`
      files[`word/media/page${pic}.jpg`] = await bytes(p.image)
      relList.push([id, 'image', `media/page${pic}.jpg`])
      const cx = Math.round(p.w * EMU_PER_PT)
      const cy = Math.round(p.h * EMU_PER_PT)
      body +=
        `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pic}" name="Page ${pic}"/>` +
        `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:nvPicPr><pic:cNvPr id="${pic}" name="page${pic}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    }
    // Each PDF page gets its own section so its size (and margins) carry over.
    const sect = `<w:sectPr><w:pgSz w:w="${tw}" w:h="${th}"${p.w > p.h ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`
    body += i < pages.length - 1 ? `<w:p><w:pPr>${sect}</w:pPr></w:p>` : sect
  }
  files['[Content_Types].xml'] = strToU8(
    XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  files['_rels/.rels'] = rels([['rId1', 'officeDocument', 'word/document.xml']])
  files['word/_rels/document.xml.rels'] = rels(relList)
  files['word/document.xml'] = strToU8(
    XML +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${NS_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>` +
      body +
      '</w:body></w:document>',
  )
  return new Blob([zipSync(files) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

export type PptSlide = { kind: 'image'; w: number; h: number; image: Blob } | { kind: 'text'; w: number; h: number; lines: Line[] }

const THEME =
  `<a:theme xmlns:a="${NS_A}" name="AnyScan"><a:themeElements>` +
  '<a:clrScheme name="AnyScan"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="2FBF8F"/></a:accent1><a:accent2><a:srgbClr val="4F7CFF"/></a:accent2><a:accent3><a:srgbClr val="FF7A45"/></a:accent3><a:accent4><a:srgbClr val="9B6BFF"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="22B8CF"/></a:accent5><a:accent6><a:srgbClr val="F0568C"/></a:accent6><a:hlink><a:srgbClr val="2F6BFF"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="AnyScan"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="AnyScan"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
  '</a:themeElements></a:theme>'

const P_NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'

/** Slide size in EMU for a page of w×h points: 10 in wide (or 7.5 in tall for portrait pages), within PowerPoint's limits. */
export function slideSize(w: number, h: number): { cx: number; cy: number } {
  const EMU_IN = 914400
  const s = w >= h ? (10 * EMU_IN) / w : (7.5 * EMU_IN) / h
  const clamp = (v: number) => Math.round(Math.min(56 * EMU_IN, Math.max(EMU_IN, v)))
  return { cx: clamp(w * s), cy: clamp(h * s) }
}

/**
 * Builds a .pptx with one slide per page. Image slides show the page exactly; text slides place each
 * line as an editable text box where it was on the page.
 */
export async function buildPptx(slides: PptSlide[]): Promise<Blob> {
  const files: Zippable = {}
  // A deck has one slide size: use the most common page shape (a portrait cover shouldn't shrink 16:9 slides).
  const shapes = new Map<string, { w: number; h: number; n: number }>()
  for (const s of slides) {
    const key = (s.w / s.h).toFixed(2)
    const e = shapes.get(key) ?? { w: s.w, h: s.h, n: 0 }
    e.n++
    shapes.set(key, e)
  }
  const common = [...shapes.values()].sort((a, b) => b.n - a.n)[0] ?? { w: 960, h: 540 }
  const { cx, cy } = slideSize(common.w, common.h)
  const ct: string[] = []
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]
    const n = i + 1
    // Fit the page into the slide, centred (pages of a different shape get side bars).
    const k = Math.min(cx / s.w, cy / s.h)
    const ox = Math.round((cx - s.w * k) / 2)
    const oy = Math.round((cy - s.h * k) / 2)
    let shapes = ''
    const slideRels: [string, string, string][] = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]
    if (s.kind === 'image') {
      files[`ppt/media/page${n}.jpg`] = await bytes(s.image)
      slideRels.push(['rId2', 'image', `../media/page${n}.jpg`])
      shapes =
        `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${n}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
        '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
        `<p:spPr><a:xfrm><a:off x="${ox}" y="${oy}"/><a:ext cx="${Math.round(s.w * k)}" cy="${Math.round(s.h * k)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    } else {
      shapes = s.lines
        .map((l, j) => {
          const sz = Math.round(Math.min(400, Math.max(6, (l.fs * k) / EMU_PER_PT)) * 100) // hundredths of a point on the slide
          const x = Math.max(0, Math.round(ox + l.x * k))
          const y = Math.max(0, Math.round(oy + (l.y - l.fs * 0.95) * k))
          const w = Math.min(cx - x, Math.round(Math.max(l.w, l.fs) * k * 1.08) + 1)
          const h = Math.round(l.fs * 1.3 * k)
          return (
            `<p:sp><p:nvSpPr><p:cNvPr id="${j + 2}" name="Text ${j + 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
            `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${Math.max(1, w)}" cy="${Math.max(1, h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
            `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="${sz}" dirty="0"/><a:t>${clean(l.text)}</a:t></a:r></a:p></p:txBody></p:sp>`
          )
        })
        .join('')
    }
    files[`ppt/slides/slide${n}.xml`] = strToU8(XML + `<p:sld ${P_NS}><p:cSld><p:spTree>${GROUP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = rels(slideRels)
    ct.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
  }
  files['[Content_Types].xml'] = strToU8(
    XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      ct.join('') +
      '</Types>',
  )
  files['_rels/.rels'] = rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])
  files['ppt/presentation.xml'] = strToU8(
    XML +
      `<p:presentation ${P_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst>` +
      `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  )
  files['ppt/_rels/presentation.xml.rels'] = rels([
    ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ['rId2', 'theme', 'theme/theme1.xml'],
    ...slides.map((_, i): [string, string, string] => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`]),
  ])
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(
    XML +
      `<p:sldMaster ${P_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>` +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
  )
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([
    ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ['rId2', 'theme', '../theme/theme1.xml'],
  ])
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(XML + `<p:sldLayout ${P_NS} preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])
  files['ppt/theme/theme1.xml'] = strToU8(XML + THEME)
  return new Blob([zipSync(files) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}
