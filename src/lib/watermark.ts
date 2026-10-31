// Watermarks for documents ("For personal use only", "Copy for XYZ Bank"…) in several styles, placed
// either on the whole page or only on the cards/photos found on it (e.g. an IC copied onto A4).
import { createCanvas, ctx2d } from './image'

export type WmStyle = 'diagonal' | 'corners' | 'strike' | 'corner' | 'stamp' | 'tiled'
export type WmPos = 'tl' | 'tr' | 'bl' | 'br' | 'c'
export const WM_STYLES: WmStyle[] = ['diagonal', 'corners', 'strike', 'corner', 'stamp', 'tiled']

export interface WmOptions {
  style: WmStyle
  text: string
  /** Optional second line, e.g. today's date. */
  sub?: string
  color: string
  opacity: number
  /** 15–100; 50 is the default size. */
  size: number
  /** Degrees, for corner and stamp; negative tilts up to the right. */
  angle: number
  pos: WmPos
  /** Put the watermark on the detected cards/photos, or on the whole page. */
  area: 'content' | 'page'
}

export const DEFAULT_WM: Omit<WmOptions, 'text'> = { style: 'diagonal', color: '#808080', opacity: 0.35, size: 50, angle: -20, pos: 'br', area: 'content' }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// ---------------------------------------------------------------- finding cards / photos on a page

/** Splits [0, n) into runs where `on(i)` holds, joining runs separated by gaps shorter than `gap`. */
function runs(n: number, on: (i: number) => boolean, gap: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    if (!on(i)) continue
    const last = out[out.length - 1]
    if (last && i - last[1] <= gap) last[1] = i + 1
    else out.push([i, i + 1])
  }
  return out
}

/**
 * Finds separate objects (ID card front/back, a photo, a receipt) lying on a plain page, from RGBA
 * pixels. Returns [] when the page is simply full of content, i.e. there's nothing smaller to target.
 */
export function contentRegions(data: Uint8ClampedArray, w: number, h: number): Rect[] {
  // Background colour: median of the border pixels.
  const border: number[][] = [[], [], []]
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4
    for (let c = 0; c < 3; c++) border[c].push(data[i + c])
  }
  for (let x = 0; x < w; x++) add(x, 0), add(x, h - 1)
  for (let y = 0; y < h; y++) add(0, y), add(w - 1, y)
  const bg = border.map((v) => v.sort((a, b) => a - b)[v.length >> 1])
  const ink = new Uint8Array(w * h)
  for (let p = 0, i = 0; p < w * h; p++, i += 4) ink[p] = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) > 28 ? 1 : 0

  const inkInRow = (y: number, x0: number, x1: number) => {
    let n = 0
    for (let x = x0; x < x1; x++) n += ink[y * w + x]
    return n
  }
  const inkInCol = (x: number, y0: number, y1: number) => {
    let n = 0
    for (let y = y0; y < y1; y++) n += ink[y * w + x]
    return n
  }

  const rects: Rect[] = []
  for (const [y0, y1] of runs(h, (y) => inkInRow(y, 0, w) >= Math.max(2, w * 0.01), h * 0.04)) {
    for (const [x0, x1] of runs(w, (x) => inkInCol(x, y0, y1) >= Math.max(1, (y1 - y0) * 0.02), w * 0.04)) {
      // Tighten the rows to this column range (side-by-side objects may differ in height).
      const ys = runs(y1 - y0, (k) => inkInRow(y0 + k, x0, x1) >= Math.max(1, (x1 - x0) * 0.02), h * 0.04)
      if (!ys.length) continue
      const top = y0 + ys[0][0]
      const bottom = y0 + ys[ys.length - 1][1]
      const r = { x: x0, y: top, w: x1 - x0, h: bottom - top }
      if (r.w >= w * 0.08 && r.h >= h * 0.04 && r.w * r.h >= w * h * 0.01) rects.push(r)
    }
  }
  const area = rects.reduce((s, r) => s + r.w * r.h, 0)
  // Too many pieces or most of the page covered: it's an ordinary page, not objects on paper.
  if (!rects.length || rects.length > 4 || area > w * h * 0.6) return []
  return rects
}

/** Detects objects on a canvas (analysed at low resolution) and returns them in canvas pixels. */
export function detectRegions(c: HTMLCanvasElement): Rect[] {
  const s = Math.min(1, 320 / Math.max(c.width, c.height))
  const small = createCanvas(c.width * s, c.height * s)
  const sx = ctx2d(small)
  sx.drawImage(c, 0, 0, small.width, small.height)
  const { data } = sx.getImageData(0, 0, small.width, small.height)
  const k = c.width / small.width
  return contentRegions(data, small.width, small.height).map((r) => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }))
}

// ---------------------------------------------------------------- drawing

const FONT = '-apple-system, "PingFang SC", "Noto Sans", sans-serif'

/** Size of a block of lines rotated by `a` radians. */
export function rotatedBox(w: number, h: number, a: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(a))
  const s = Math.abs(Math.sin(a))
  return { w: w * c + h * s, h: w * s + h * c }
}

/** Where the centre of a rotated block of size bw×bh goes so it sits in corner `pos` of `r`. */
export function cornerCentre(r: Rect, bw: number, bh: number, pos: WmPos): { x: number; y: number } {
  const m = Math.min(r.w, r.h) * 0.05
  const left = r.x + m + bw / 2
  const right = r.x + r.w - m - bw / 2
  const top = r.y + m + bh / 2
  const bottom = r.y + r.h - m - bh / 2
  if (pos === 'c') return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  return { x: pos[1] === 'l' ? left : right, y: pos[0] === 't' ? top : bottom }
}

function drawIn(ctx: CanvasRenderingContext2D, r: Rect, o: WmOptions, pageArea: boolean) {
  const k = o.size / 50
  const min = Math.min(r.w, r.h)
  const one = o.sub ? `${o.text}  ·  ${o.sub}` : o.text
  const lines = o.sub ? [o.text, o.sub] : [o.text]
  const font = (fs: number, weight = 650) => (ctx.font = `${weight} ${fs}px ${FONT}`)
  /** Block size of `lines` at font size fs (second line slightly smaller). */
  const block = (fs: number, weight?: number) => {
    font(fs, weight)
    const w0 = ctx.measureText(lines[0]).width
    font(fs * 0.75, weight)
    const w1 = lines[1] ? ctx.measureText(lines[1]).width : 0
    return { w: Math.max(w0, w1), h: fs * (lines[1] ? 2.05 : 1.1) }
  }
  const drawLines = (fs: number, weight?: number) => {
    if (!lines[1]) {
      font(fs, weight)
      ctx.fillText(lines[0], 0, 0)
      return
    }
    font(fs, weight)
    ctx.fillText(lines[0], 0, -fs * 0.45)
    font(fs * 0.75, weight)
    ctx.fillText(lines[1], 0, fs * 0.6)
  }
  /** Largest font size ≤ fs whose block fits, rotated by a, within maxW×maxH. */
  const fit = (fs: number, a: number, maxW: number, maxH: number, extra: (f: number) => { w: number; h: number } = () => ({ w: 0, h: 0 }), weight?: number) => {
    for (let i = 0; i < 40; i++) {
      const b = block(fs, weight)
      const e = extra(fs)
      const rb = rotatedBox(b.w + e.w, b.h + e.h, a)
      if (rb.w <= maxW && rb.h <= maxH) break
      fs *= 0.92
    }
    return fs
  }

  ctx.save()
  // "Two corners" runs over the card's edge onto the paper on purpose; every other style stays on the area.
  if (o.style !== 'corners') {
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
  }
  ctx.fillStyle = ctx.strokeStyle = o.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (o.style === 'corners') {
    // Slanted text across two opposite corners, half on the card and half on the paper, as people
    // write on IC photocopies so a corner can't be cut off cleanly. pos tl/br → ↖↘ (rising), tr/bl → ↗↙.
    const rising = o.pos === 'tl' || o.pos === 'br' || o.pos === 'c'
    const a = ((rising ? -1 : 1) * 33 * Math.PI) / 180
    font(min * 0.16 * k)
    const fs = Math.min(min * 0.16 * k, (min * 0.16 * k * r.w * 0.7) / Math.max(1, block(min * 0.16 * k).w))
    const ix = r.w * 0.12
    const iy = r.h * 0.12
    const spots = rising
      ? [
          [r.x + ix, r.y + iy],
          [r.x + r.w - ix, r.y + r.h - iy],
        ]
      : [
          [r.x + r.w - ix, r.y + iy],
          [r.x + ix, r.y + r.h - iy],
        ]
    for (const [x, y] of spots) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(a)
      drawLines(fs)
      ctx.restore()
    }
  } else if (o.style === 'tiled') {
    const fs = min * (pageArea ? 0.06 : 0.09) * k
    font(fs)
    const tw = ctx.measureText(one).width + fs * 2
    const th = fs * 3.2
    const span = Math.hypot(r.w, r.h)
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
    ctx.rotate(-Math.PI / 6)
    let row = 0
    for (let y = -span / 2; y < span / 2; y += th, row++) for (let x = -span / 2 + (row % 2 ? tw / 2 : 0); x < span / 2; x += tw) ctx.fillText(one, x, y)
  } else if (o.style === 'diagonal' || o.style === 'strike') {
    // Along the rising diagonal of the area, as people write across a photocopied IC.
    const a = -Math.atan2(r.h, r.w)
    const diag = Math.hypot(r.w, r.h)
    const fs0 = min * 0.2 * k
    font(fs0)
    const fs = Math.min(fs0, (fs0 * diag * (o.style === 'strike' ? 0.6 : 0.8)) / Math.max(1, ctx.measureText(one).width))
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
    ctx.rotate(a)
    font(fs)
    ctx.fillText(one, 0, 0)
    if (o.style === 'strike') {
      ctx.lineWidth = Math.max(1, fs * 0.09)
      ctx.lineCap = 'round'
      for (const d of [-fs * 0.95, fs * 0.95]) {
        ctx.beginPath()
        ctx.moveTo(-diag / 2, d)
        ctx.lineTo(diag / 2, d)
        ctx.stroke()
      }
    }
  } else {
    const a = (o.angle * Math.PI) / 180
    const stamp = o.style === 'stamp'
    const weight = stamp ? 800 : 650
    const pad = (f: number) => (stamp ? { w: f * 1.4, h: f * 0.9 } : { w: 0, h: 0 })
    const fs = fit(min * 0.11 * k * (pageArea ? 0.8 : 1), a, r.w * 0.9, r.h * 0.9, pad, weight)
    const b = block(fs, weight)
    const p = pad(fs)
    const rb = rotatedBox(b.w + p.w, b.h + p.h, a)
    const pos = !stamp && o.pos === 'c' ? 'br' : o.pos
    const at = cornerCentre(r, rb.w, rb.h, pos)
    ctx.translate(at.x, at.y)
    ctx.rotate(a)
    if (stamp) {
      const bw = b.w + p.w
      const bh = b.h + p.h
      const box = (inset: number, lw: number) => {
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.roundRect(-bw / 2 + inset, -bh / 2 + inset, bw - inset * 2, bh - inset * 2, fs * 0.35)
        ctx.stroke()
      }
      box(0, Math.max(1, fs * 0.13))
      box(fs * 0.24, Math.max(1, fs * 0.05))
    }
    drawLines(fs, weight)
  }
  ctx.restore()
}

/**
 * Draws the watermark on `c`. With `area: 'content'` it goes on each object found on the page
 * (pass `regions` to reuse a detection); if none are found it covers the whole page.
 */
export function drawWatermark(c: HTMLCanvasElement, o: WmOptions, regions?: Rect[]) {
  if (!o.text.trim()) return
  const ctx = ctx2d(c)
  const found = o.area === 'content' ? regions ?? detectRegions(c) : []
  const areas = found.length ? found : [{ x: 0, y: 0, w: c.width, h: c.height }]
  ctx.save()
  ctx.globalAlpha = o.opacity
  for (const r of areas) drawIn(ctx, r, o, !found.length)
  ctx.restore()
}
