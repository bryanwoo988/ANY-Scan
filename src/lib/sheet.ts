// Tables from page text (PDF text layer or OCR words) and a minimal .xlsx writer.
import { strToU8, zipSync, type Zippable } from 'fflate'
import type { TextItem } from './office'
import type { OcrWord } from './ocr'

/**
 * A number with one of Excel's built-in formats, so it looks as it did on the page but stays a
 * number: 2 = 0.00, 3 = #,##0, 4 = #,##0.00, 9 = 0%, 10 = 0.00%. Percentages are stored as
 * fractions (12% → 0.12).
 */
export type Fmt = 2 | 3 | 4 | 9 | 10
export type Cell = string | number | { v: number; fmt: Fmt } | null
export const FMTS: Fmt[] = [2, 3, 4, 9, 10]
export interface Sheet {
  name: string
  rows: Cell[][]
}

/** Tilt of a photo (dy per dx), as the median slope of OCR lines with words far apart. */
export function skew(words: OcrWord[]): number {
  const byLine = new Map<number, OcrWord[]>()
  for (const w of words) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w])
  const slopes: number[] = []
  for (const ws of byLine.values()) {
    if (ws.length < 2) continue
    const a = ws[0]
    const b = ws[ws.length - 1]
    const dx = (b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2
    if (dx > a.lh * 4) slopes.push(((b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2) / dx)
  }
  if (!slopes.length) return 0
  slopes.sort((x, y) => x - y)
  const m = slopes[slopes.length >> 1]
  return Math.abs(m) < 0.15 ? m : 0
}

/** OCR words → text items: straightened for tilt, vertical centre as the baseline, line height as the size. */
export function wordsToItems(words: OcrWord[]): TextItem[] {
  const k = skew(words)
  return words.map((w) => ({ str: w.text, x: w.x0, y: (w.y0 + w.y1) / 2 - k * ((w.x0 + w.x1) / 2), w: w.x1 - w.x0, fs: Math.max(1, w.lh || w.y1 - w.y0) }))
}

interface Piece {
  text: string
  x0: number
  x1: number
}

/** Groups items into rows, and each row into cells split at wide gaps. */
function rowsOfCells(items: TextItem[]): { cells: Piece[]; fs: number }[] {
  const rows: TextItem[][] = []
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) < Math.max(r[0].fs, it.fs) * 0.5)
    if (row) row.push(it)
    else rows.push([it])
  }
  return rows
    .sort((a, b) => a[0].y - b[0].y)
    .map((r) => {
      r.sort((a, b) => a.x - b.x)
      const fs = r.reduce((s, i) => s + i.fs, 0) / r.length
      const cells: Piece[] = []
      for (const it of r) {
        const last = cells[cells.length - 1]
        // A word space is about a third of the text size; columns are separated by much more.
        if (last && it.x - last.x1 < fs * 0.8) {
          last.text += it.x - last.x1 > fs * 0.12 && !/\s$/.test(last.text) ? ' ' + it.str : it.str
          last.x1 = Math.max(last.x1, it.x + it.w)
        } else cells.push({ text: it.str, x0: it.x, x1: it.x + it.w })
      }
      for (const c of cells) c.text = c.text.trim()
      return { cells: cells.filter((c) => c.text), fs }
    })
    .filter((r) => r.cells.length)
}

/**
 * Lays page text out as a grid. Columns are the horizontal ranges covered by the cells of the
 * table rows (rows with 2+ cells), split where almost no row has text, so a title that spans
 * several columns doesn't merge them. Pages without table rows give one text line per row.
 */
export function toTable(items: TextItem[]): string[][] {
  const rows = rowsOfCells(items)
  const tableRows = rows.filter((r) => r.cells.length >= 2)
  if (tableRows.length < 2) return rows.map((r) => [r.cells.map((c) => c.text).join(' ')])

  const minX = Math.floor(Math.min(...tableRows.flatMap((r) => r.cells.map((c) => c.x0))))
  const maxX = Math.ceil(Math.max(...tableRows.flatMap((r) => r.cells.map((c) => c.x1))))
  const fs = tableRows.reduce((s, r) => s + r.fs, 0) / tableRows.length
  const step = Math.max(0.5, fs / 8)
  const bins = Math.max(1, Math.ceil((maxX - minX) / step))
  const cover = new Array<number>(bins).fill(0)
  for (const r of tableRows)
    for (const c of r.cells) for (let b = Math.floor((c.x0 - minX) / step); b < Math.ceil((c.x1 - minX) / step) && b < bins; b++) cover[b]++
  // Up to 15% of table rows may cross a column gap (titles, notes, long descriptions).
  const limit = Math.floor(tableRows.length * 0.15)
  const cols: [number, number][] = []
  for (let b = 0; b < bins; b++) {
    if (cover[b] <= limit) continue
    const x = minX + b * step
    const last = cols[cols.length - 1]
    if (last && x - last[1] <= step * 1.01) last[1] = x + step
    else cols.push([x, x + step])
  }
  if (cols.length < 2) return rows.map((r) => [r.cells.map((c) => c.text).join(' ')])

  const colOf = (c: Piece) => {
    let best = 0
    let bestOverlap = -Infinity
    cols.forEach(([a, b], i) => {
      const o = Math.min(b, c.x1) - Math.max(a, c.x0)
      // Without any overlap, prefer the column nearest to the cell's start.
      const score = o > 0 ? o : -Math.min(Math.abs(c.x0 - a), Math.abs(c.x0 - b))
      if (score > bestOverlap) (bestOverlap = score), (best = i)
    })
    return best
  }
  const fitsAColumn = (c: Piece) => cols.some(([a, b]) => Math.min(b, c.x1) - Math.max(a, c.x0) >= (c.x1 - c.x0) * 0.6)
  return rows.map((r) => {
    // A lone line that isn't mostly inside one column (a title, a note) goes in column A.
    if (r.cells.length === 1 && !fitsAColumn(r.cells[0])) return [r.cells[0].text]
    const out = new Array<string>(cols.length).fill('')
    for (const c of r.cells) {
      const i = colOf(c)
      out[i] = out[i] ? `${out[i]} ${c.text}` : c.text
    }
    while (out.length && !out[out.length - 1]) out.pop()
    return out
  })
}

/**
 * Turns plain numbers into numbers (1,234.50 · -12 · (45.00) · RM 45.90 · 12%) and leaves
 * everything else as text, including codes with leading zeros, IC and phone numbers.
 */
export function cellValue(s: string): Cell {
  const t = s.trim()
  if (!t) return null
  const m = /^([-+])?(?:RM|MYR|USD|SGD|S\$|\$|€|£|¥)?\s?(\()?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\))?(%)?$/i.exec(t)
  if (!m) return t
  const [, sign, open, int, frac, close, pct] = m
  if (!!open !== !!close) return t
  const digits = int.replace(/,/g, '')
  if ((digits.length > 1 && digits.startsWith('0') && !frac) || digits.length > 15) return t
  let v = Number(digits + (frac ?? ''))
  if (sign === '-' || open) v = -v
  if (pct) return { v: v / 100, fmt: frac ? 10 : 9 }
  const grouped = int.includes(',')
  // Keep "8.90" and "2,100.00" looking that way; other decimals stay General.
  if (frac?.length === 3) return { v, fmt: grouped ? 4 : 2 }
  if (grouped && !frac) return { v, fmt: 3 }
  return v
}

/** How a cell reads on screen (matches the Excel format). */
export function cellText(c: Cell): string {
  if (c == null) return ''
  if (typeof c !== 'object') return String(c)
  const { v, fmt } = c
  if (fmt === 9 || fmt === 10) return `${(v * 100).toFixed(fmt === 10 ? 2 : 0)}%`
  return v.toLocaleString('en-US', { minimumFractionDigits: fmt === 3 ? 0 : 2, maximumFractionDigits: fmt === 3 ? 0 : 2, useGrouping: fmt !== 2 })
}

// ---------------------------------------------------------------- .xlsx

const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

export function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A sheet name Excel accepts: no []:*?/\ characters, at most 31 characters, unique. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = base
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 27)} (${i})`
  used.add(n.toLowerCase())
  return n
}

export function buildXlsx(sheets: Sheet[]): Blob {
  const files: Zippable = {}
  const used = new Set<string>()
  const names = sheets.map((s) => sheetName(s.name, used))
  sheets.forEach((sh, si) => {
    const width = Math.max(1, ...sh.rows.map((r) => r.length))
    const widths = Array.from({ length: width }, (_, c) => Math.min(60, Math.max(8, ...sh.rows.map((r) => cellText(r[c] ?? null).length * 1.1 + 2))))
    const rows = sh.rows
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            if (v == null || v === '') return ''
            const ref = `${colName(ci)}${ri + 1}`
            if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`
            // Styles 1… are the formats in FMTS order (see styles.xml below).
            if (typeof v === 'object') return `<c r="${ref}" s="${FMTS.indexOf(v.fmt) + 1}"><v>${v.v}</v></c>`
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
          })
          .join('')
        return `<row r="${ri + 1}">${cells}</row>`
      })
      .join('')
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(
      XML +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`).join('')}</cols>` +
        `<sheetData>${rows}</sheetData></worksheet>`,
    )
  })
  files['[Content_Types].xml'] = strToU8(
    XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>',
  )
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
  files['_rels/.rels'] = strToU8(XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'officeDocument', 'xl/workbook.xml')}</Relationships>`)
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => rel(`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`)).join('') +
      rel(`rId${sheets.length + 1}`, 'styles', 'styles.xml') +
      '</Relationships>',
  )
  files['xl/workbook.xml'] = strToU8(
    XML +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  )
  files['xl/styles.xml'] = strToU8(
    XML +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${FMTS.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${FMTS.map((f) => `<xf numFmtId="${f}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',
  )
  return new Blob([zipSync(files) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
