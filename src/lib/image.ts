// Image processing for scanned pages: perspective correction, filters, rotation.
// Everything runs on <canvas> in the browser; nothing is uploaded anywhere.

export type Point = { x: number; y: number }
export type Quad = [Point, Point, Point, Point] // top-left, top-right, bottom-right, bottom-left
export type FilterName = 'original' | 'enhance' | 'magic' | 'gray' | 'bw'

export const FILTERS: FilterName[] = ['original', 'magic', 'enhance', 'gray', 'bw']

/** Longest side we keep for source photos. 12 MP phone photos would exhaust memory on older phones. */
export const MAX_SOURCE_SIDE = 3000
/** Longest side of a finished page. ~300 dpi for an A4 sheet. */
export const MAX_PAGE_SIDE = 2480

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas not supported')
  return ctx
}

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = typeof src === 'string' ? src : URL.createObjectURL(src)
    img.onload = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url)
      reject(new Error('Could not read image'))
    }
    img.src = url
  })
}

/** Draws an image into a canvas, downscaled so its longest side is at most `maxSide`. */
export function imageToCanvas(img: CanvasImageSource & { width: number; height: number }, maxSide = MAX_SOURCE_SIDE): HTMLCanvasElement {
  const w = (img as HTMLImageElement).naturalWidth || img.width
  const h = (img as HTMLImageElement).naturalHeight || img.height
  const s = Math.min(1, maxSide / Math.max(w, h))
  const c = createCanvas(w * s, h * s)
  const ctx = ctx2d(c)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c
}

export async function blobToCanvas(blob: Blob, maxSide = MAX_SOURCE_SIDE): Promise<HTMLCanvasElement> {
  return imageToCanvas(await loadImage(blob), maxSide)
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality)
  })
}

export function fullQuad(w: number, h: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Solves for the 3x3 homography H (h8 = 1) that maps each `from[i]` to `to[i]`.
 * Returns the 8 unknowns [h0..h7].
 */
export function solveHomography(from: Quad, to: Quad): number[] {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i]
    const { x, y } = to[i]
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x])
    b.push(x)
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y])
    b.push(y)
  }
  // Gaussian elimination with partial pivoting.
  const n = 8
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-12) throw new Error('Degenerate quadrilateral')
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    ;[b[col], b[pivot]] = [b[pivot], b[col]]
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col]
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  const h = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let c = r + 1; c < n; c++) s -= A[r][c] * h[c]
    h[r] = s / A[r][r]
  }
  return h
}

export function applyHomography(h: number[], p: Point): Point {
  const d = h[6] * p.x + h[7] * p.y + 1
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d }
}

/** Output size of a flattened quad, preserving the document's apparent aspect ratio. */
export function quadOutputSize(q: Quad, maxSide = MAX_PAGE_SIDE): { w: number; h: number } {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]))
  const h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]))
  const s = Math.min(1, maxSide / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

export function isFullQuad(q: Quad, w: number, h: number): boolean {
  const f = fullQuad(w, h)
  return q.every((p, i) => Math.abs(p.x - f[i].x) < 1 && Math.abs(p.y - f[i].y) < 1)
}

/** Flattens the area inside `quad` of `src` into a rectangle (perspective correction). */
export function warpPerspective(src: HTMLCanvasElement, quad: Quad, maxSide = MAX_PAGE_SIDE): HTMLCanvasElement {
  const { w, h } = quadOutputSize(quad, maxSide)
  if (isFullQuad(quad, src.width, src.height)) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height))
    const out = createCanvas(src.width * s, src.height * s)
    const c = ctx2d(out)
    c.imageSmoothingQuality = 'high'
    c.drawImage(src, 0, 0, out.width, out.height)
    return out
  }
  const H = solveHomography(fullQuad(w, h), quad)
  const sw = src.width
  const sh = src.height
  const sData = ctx2d(src).getImageData(0, 0, sw, sh).data
  const out = createCanvas(w, h)
  const oc = ctx2d(out)
  const oImg = oc.createImageData(w, h)
  const o = oImg.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = H[6] * x + H[7] * y + 1
      let sx = (H[0] * x + H[1] * y + H[2]) / d
      let sy = (H[3] * x + H[4] * y + H[5]) / d
      sx = Math.min(sw - 1.001, Math.max(0, sx))
      sy = Math.min(sh - 1.001, Math.max(0, sy))
      const x0 = sx | 0
      const y0 = sy | 0
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + sw * 4
      const i11 = i01 + 4
      const oi = (y * w + x) * 4
      for (let k = 0; k < 3; k++) {
        const top = sData[i00 + k] + (sData[i10 + k] - sData[i00 + k]) * fx
        const bot = sData[i01 + k] + (sData[i11 + k] - sData[i01 + k]) * fx
        o[oi + k] = top + (bot - top) * fy
      }
      o[oi + 3] = 255
    }
  }
  oc.putImageData(oImg, 0, 0)
  return out
}

export function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const r = ((deg % 360) + 360) % 360
  if (r === 0) return src
  const swap = r === 90 || r === 270
  const out = createCanvas(swap ? src.height : src.width, swap ? src.width : src.height)
  const c = ctx2d(out)
  c.translate(out.width / 2, out.height / 2)
  c.rotate((r * Math.PI) / 180)
  c.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

export function rotateQuad(q: Quad, w: number, h: number, deg: number): Quad {
  const r = ((deg % 360) + 360) % 360
  const f = (p: Point): Point => {
    if (r === 90) return { x: h - p.y, y: p.x }
    if (r === 180) return { x: w - p.x, y: h - p.y }
    if (r === 270) return { x: p.y, y: w - p.x }
    return p
  }
  const m = q.map(f) as Quad
  // Keep the corner order top-left, top-right, bottom-right, bottom-left after rotating.
  const shift = r / 90
  return [0, 1, 2, 3].map((i) => m[(i - shift + 4) % 4]) as Quad
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** Pure pixel-buffer filter so it can be unit tested without a canvas. */
export function filterPixels(d: Uint8ClampedArray, w: number, h: number, f: FilterName): void {
  if (f === 'original') return
  const n = w * h
  if (f === 'gray' || f === 'enhance') {
    // Contrast stretch between the 1st and 99th luminance percentile.
    const hist = new Uint32Array(256)
    for (let i = 0; i < n; i++) hist[luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) | 0]++
    let lo = 0
    let hi = 255
    let acc = 0
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) > n * 0.01) { lo = v; break }
    acc = 0
    for (let v = 255; v >= 0; v--) if ((acc += hist[v]) > n * 0.01) { hi = v; break }
    const range = Math.max(1, hi - lo)
    for (let i = 0; i < n * 4; i += 4) {
      if (f === 'gray') {
        const y = ((luma(d[i], d[i + 1], d[i + 2]) - lo) / range) * 255
        d[i] = d[i + 1] = d[i + 2] = y
      } else {
        for (let k = 0; k < 3; k++) d[i + k] = ((d[i + k] - lo) / range) * 255
        // Mild saturation boost.
        const y = luma(d[i], d[i + 1], d[i + 2])
        for (let k = 0; k < 3; k++) d[i + k] = y + (d[i + k] - y) * 1.2
      }
    }
    return
  }
  if (f === 'bw') {
    // Bradley adaptive threshold: robust against uneven lighting and shadows.
    const gray = new Float64Array(n)
    for (let i = 0; i < n; i++) gray[i] = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])
    const integral = new Float64Array((w + 1) * (h + 1))
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x]
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row
      }
    }
    const s = Math.max(8, Math.round(Math.max(w, h) / 16))
    const half = s >> 1
    const t = 0.15
    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - half)
      const y2 = Math.min(h - 1, y + half)
      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - half)
        const x2 = Math.min(w - 1, x + half)
        const count = (x2 - x1 + 1) * (y2 - y1 + 1)
        const sum =
          integral[(y2 + 1) * (w + 1) + x2 + 1] -
          integral[y1 * (w + 1) + x2 + 1] -
          integral[(y2 + 1) * (w + 1) + x1] +
          integral[y1 * (w + 1) + x1]
        const v = gray[y * w + x] * count < sum * (1 - t) ? 0 : 255
        const i = (y * w + x) * 4
        d[i] = d[i + 1] = d[i + 2] = v
      }
    }
    return
  }
  // 'magic': estimate the paper colour per region (block maximum), divide it out to remove
  // shadows and colour casts, then deepen the ink a little.
  const bs = Math.max(8, Math.round(Math.max(w, h) / 40))
  const gw = Math.ceil(w / bs)
  const gh = Math.ceil(h / bs)
  const grid = new Float64Array(gw * gh * 3)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      // 95th-percentile brightness of the block approximates the paper; plain max is too noisy.
      const vals: number[] = []
      for (let y = gy * bs; y < Math.min(h, (gy + 1) * bs); y += 2)
        for (let x = gx * bs; x < Math.min(w, (gx + 1) * bs); x += 2) vals.push((y * w + x) * 4)
      vals.sort((a, b) => luma(d[a], d[a + 1], d[a + 2]) - luma(d[b], d[b + 1], d[b + 2]))
      const pick = vals[Math.floor(vals.length * 0.95)] ?? vals[vals.length - 1]
      for (let k = 0; k < 3; k++) grid[(gy * gw + gx) * 3 + k] = Math.max(40, d[pick + k])
    }
  }
  for (let y = 0; y < h; y++) {
    const gyf = Math.min(gh - 1, Math.max(0, y / bs - 0.5))
    const gy0 = Math.floor(gyf)
    const gy1 = Math.min(gh - 1, gy0 + 1)
    const fy = gyf - gy0
    for (let x = 0; x < w; x++) {
      const gxf = Math.min(gw - 1, Math.max(0, x / bs - 0.5))
      const gx0 = Math.floor(gxf)
      const gx1 = Math.min(gw - 1, gx0 + 1)
      const fx = gxf - gx0
      const i = (y * w + x) * 4
      for (let k = 0; k < 3; k++) {
        const a = grid[(gy0 * gw + gx0) * 3 + k]
        const b = grid[(gy0 * gw + gx1) * 3 + k]
        const c = grid[(gy1 * gw + gx0) * 3 + k]
        const e = grid[(gy1 * gw + gx1) * 3 + k]
        const bg = (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy
        const v = Math.min(1, d[i + k] / bg)
        d[i + k] = Math.pow(v, 1.6) * 255
      }
    }
  }
}

export function applyFilter(src: HTMLCanvasElement, f: FilterName): HTMLCanvasElement {
  if (f === 'original') return src
  const out = createCanvas(src.width, src.height)
  const c = ctx2d(out)
  c.drawImage(src, 0, 0)
  const img = c.getImageData(0, 0, out.width, out.height)
  filterPixels(img.data, out.width, out.height, f)
  c.putImageData(img, 0, 0)
  return out
}

export function scaleCanvas(src: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height))
  if (s === 1) return src
  const out = createCanvas(src.width * s, src.height * s)
  const c = ctx2d(out)
  c.imageSmoothingQuality = 'high'
  c.drawImage(src, 0, 0, out.width, out.height)
  return out
}

export function formatStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Pure helper for detectDocument: finds the largest bright region in a grayscale buffer
 * and returns its four extreme corners, or null if nothing plausible is found.
 */
export function detectQuadInGray(gray: Uint8Array, w: number, h: number): Quad | null {
  // Otsu threshold separates paper from background.
  const hist = new Array(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]
  let sumB = 0
  let wB = 0
  let best = 0
  let thr = 128
  for (let v = 0; v < 256; v++) {
    wB += hist[v]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += v * hist[v]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      thr = v
    }
  }
  // Largest 4-connected bright component.
  const label = new Int32Array(total).fill(-1)
  const queue = new Int32Array(total)
  let bestSize = 0
  let bestLabel = -1
  let next = 0
  for (let s = 0; s < total; s++) {
    if (label[s] !== -1 || gray[s] <= thr) continue
    let head = 0
    let tail = 0
    queue[tail++] = s
    label[s] = next
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      const y = (p - x) / w
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
      for (const q of nb) {
        if (q >= 0 && label[q] === -1 && gray[q] > thr) {
          label[q] = next
          queue[tail++] = q
        }
      }
    }
    if (tail > bestSize) {
      bestSize = tail
      bestLabel = next
    }
    next++
  }
  const frac = bestSize / total
  if (bestLabel < 0 || frac < 0.15 || frac > 0.97) return null
  let tl = { s: Infinity, x: 0, y: 0 }
  let br = { s: -Infinity, x: 0, y: 0 }
  let tr = { s: -Infinity, x: 0, y: 0 }
  let bl = { s: Infinity, x: 0, y: 0 }
  for (let p = 0; p < total; p++) {
    if (label[p] !== bestLabel) continue
    const x = p % w
    const y = (p - x) / w
    if (x + y < tl.s) tl = { s: x + y, x, y }
    if (x + y > br.s) br = { s: x + y, x, y }
    if (x - y > tr.s) tr = { s: x - y, x, y }
    if (x - y < bl.s) bl = { s: x - y, x, y }
  }
  const q: Quad = [
    { x: tl.x, y: tl.y },
    { x: tr.x + 1, y: tr.y },
    { x: br.x + 1, y: br.y + 1 },
    { x: bl.x, y: bl.y + 1 },
  ]
  // Reject degenerate shapes (e.g. a thin strip) — the user can still crop by hand.
  const area = Math.abs(
    q.reduce((a, p, i) => {
      const n = q[(i + 1) % 4]
      return a + p.x * n.y - n.x * p.y
    }, 0) / 2,
  )
  if (area < total * 0.12) return null
  return q
}

/** Best-effort automatic detection of a sheet of paper in a photo. */
export function detectDocument(src: HTMLCanvasElement): Quad | null {
  const s = 220 / Math.max(src.width, src.height)
  const small = createCanvas(src.width * s, src.height * s)
  const c = ctx2d(small)
  c.drawImage(src, 0, 0, small.width, small.height)
  const d = c.getImageData(0, 0, small.width, small.height).data
  const gray = new Uint8Array(small.width * small.height)
  for (let i = 0; i < gray.length; i++) gray[i] = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])
  const q = detectQuadInGray(gray, small.width, small.height)
  if (!q) return null
  const sx = src.width / small.width
  const sy = src.height / small.height
  return q.map((p) => ({ x: Math.min(src.width, p.x * sx), y: Math.min(src.height, p.y * sy) })) as Quad
}
