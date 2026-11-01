// Watermark removal for documents.
//
// Auto: a watermark on a document is almost always printed lighter than the text (light grey
// "CONFIDENTIAL", a pale logo, a faint coloured stamp across the page). After evening out the
// paper's brightness, everything lighter than a threshold becomes paper white and the darker
// text is kept as it is.
//
// Brush: the user paints over a mark and the painted area is filled in from its surroundings
// (push-pull interpolation, then smoothing), which suits paper and plain backgrounds.

export interface AutoOptions {
  /** 0..1: how dark a mark may be and still be removed. */
  strength: number
  /** Also remove coloured marks (stamps, logos) that are darker than the threshold. */
  color: boolean
}

export const DEFAULT_AUTO: AutoOptions = { strength: 0.5, color: false }

/** Luminance above which a pixel becomes white, from the strength setting. */
export function threshold(strength: number): number {
  return 0.92 - 0.4 * Math.min(1, Math.max(0, strength))
}

const BAND = 0.1 // soft edge below the threshold, so stroke edges don't turn jagged

/**
 * Paper brightness per channel across the page: the 90th-percentile value of blocks of the page,
 * smoothed, so shadows and a tinted scan become white without touching dark text.
 */
function paper(d: Uint8ClampedArray, w: number, h: number): (x: number, y: number, c: number) => number {
  const bs = Math.max(16, Math.round(Math.max(w, h) / 16))
  const gw = Math.ceil(w / bs)
  const gh = Math.ceil(h / bs)
  const grid = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)]
  const hist = new Uint32Array(256)
  const step = Math.max(1, Math.floor(bs / 24)) // sample: a block has plenty of pixels
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      for (let c = 0; c < 3; c++) {
        hist.fill(0)
        let n = 0
        for (let y = gy * bs; y < Math.min(h, (gy + 1) * bs); y += step)
          for (let x = gx * bs; x < Math.min(w, (gx + 1) * bs); x += step) {
            hist[d[(y * w + x) * 4 + c]]++
            n++
          }
        let k = 255
        for (let acc = 0; k > 0; k--) if ((acc += hist[k]) >= n * 0.1) break
        grid[c][gy * gw + gx] = Math.max(k, 40)
      }
    }
  // 3×3 median: a block covered by a large dark mark doesn't darken the paper estimate.
  const med = grid.map((g) =>
    Float32Array.from(g, (_, i) => {
      const gx = i % gw
      const gy = (i - gx) / gw
      const v: number[] = []
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx
          const y = gy + dy
          if (x >= 0 && y >= 0 && x < gw && y < gh) v.push(g[y * gw + x])
        }
      v.sort((a, b) => a - b)
      return v[v.length >> 1]
    }),
  )
  // Bilinear between block centres.
  return (x, y, c) => {
    const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5))
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5))
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = Math.min(gw - 1, x0 + 1)
    const y1 = Math.min(gh - 1, y0 + 1)
    const ax = fx - x0
    const ay = fy - y0
    const g = med[c]
    return (g[y0 * gw + x0] * (1 - ax) + g[y0 * gw + x1] * ax) * (1 - ay) + (g[y1 * gw + x0] * (1 - ax) + g[y1 * gw + x1] * ax) * ay
  }
}

/** Removes light (and optionally coloured) marks from a document picture, in place. */
export function removeLightMarks(d: Uint8ClampedArray, w: number, h: number, o: AutoOptions): void {
  const bg = paper(d, w, h)
  const T = threshold(o.strength)
  for (let y = 0; y < h; y++) {
    // Paper estimate changes slowly: evaluate it every 8 px and interpolate linearly between.
    for (let x0 = 0; x0 < w; x0 += 8) {
      const x1 = Math.min(w - 1, x0 + 8)
      const a = [bg(x0, y, 0), bg(x0, y, 1), bg(x0, y, 2)]
      const b = [bg(x1, y, 0), bg(x1, y, 1), bg(x1, y, 2)]
      for (let x = x0; x < Math.min(w, x0 + 8); x++) {
        const t = x1 > x0 ? (x - x0) / (x1 - x0) : 0
        const i = (y * w + x) * 4
        const r = Math.min(1, d[i] / (a[0] + (b[0] - a[0]) * t))
        const g = Math.min(1, d[i + 1] / (a[1] + (b[1] - a[1]) * t))
        const bl = Math.min(1, d[i + 2] / (a[2] + (b[2] - a[2]) * t))
        const lum = 0.299 * r + 0.587 * g + 0.114 * bl
        // Coloured marks: judged by their darkest channel's distance from grey, so black text
        // (no colour) and dark-blue ink (dark overall) are kept.
        const chroma = Math.max(r, g, bl) - Math.min(r, g, bl)
        let k = lum >= T ? 1 : lum <= T - BAND ? 0 : (lum - (T - BAND)) / BAND
        if (o.color && chroma > 0.25 && lum > 0.25) k = Math.max(k, Math.min(1, (chroma - 0.25) / 0.15))
        d[i] = Math.round(255 * (r + (1 - r) * k))
        d[i + 1] = Math.round(255 * (g + (1 - g) * k))
        d[i + 2] = Math.round(255 * (bl + (1 - bl) * k))
      }
    }
  }
}

/**
 * Fills the masked pixels (mask[i] = 1) of an RGBA picture from their surroundings, in place.
 * Only the area around the mask is worked on, so a small mark on a big page stays quick.
 */
export function inpaint(d: Uint8ClampedArray, w: number, h: number, mask: Uint8Array): void {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return
  const m = Math.max(16, Math.round(Math.max(x1 - x0, y1 - y0) / 3))
  x0 = Math.max(0, x0 - m)
  y0 = Math.max(0, y0 - m)
  x1 = Math.min(w - 1, x1 + m)
  y1 = Math.min(h - 1, y1 + m)
  const rw = x1 - x0 + 1
  const rh = y1 - y0 + 1

  // Level 0: the region, with weight 1 where known.
  const C: Float32Array[] = []
  const W: Float32Array[] = []
  const dims: [number, number][] = []
  let c = new Float32Array(rw * rh * 3)
  let wt = new Float32Array(rw * rh)
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      const i = ((y + y0) * w + x + x0) * 4
      const known = mask[(y + y0) * w + x + x0] ? 0 : 1
      wt[p] = known
      c[p * 3] = d[i] * known
      c[p * 3 + 1] = d[i + 1] * known
      c[p * 3 + 2] = d[i + 2] * known
    }
  let cw = rw
  let ch = rh
  // Push: halve until every pixel has some known information (or the picture is tiny).
  for (;;) {
    C.push(c)
    W.push(wt)
    dims.push([cw, ch])
    let missing = false
    for (let p = 0; p < wt.length; p++)
      if (wt[p] < 1e-6) {
        missing = true
        break
      }
    if (!missing || (cw <= 1 && ch <= 1)) break
    const nw = Math.max(1, Math.ceil(cw / 2))
    const nh = Math.max(1, Math.ceil(ch / 2))
    const nc = new Float32Array(nw * nh * 3)
    const nwt = new Float32Array(nw * nh)
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        let s = 0
        let r = 0
        let g = 0
        let b = 0
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(cw - 1, x * 2 + dx)
            const sy = Math.min(ch - 1, y * 2 + dy)
            const q = sy * cw + sx
            s += wt[q]
            r += c[q * 3]
            g += c[q * 3 + 1]
            b += c[q * 3 + 2]
          }
        const p = y * nw + x
        // Colours are stored premultiplied by weight; weight saturates at 1.
        const k = s > 1 ? 1 / s : 1
        nwt[p] = Math.min(1, s)
        nc[p * 3] = r * k
        nc[p * 3 + 1] = g * k
        nc[p * 3 + 2] = b * k
      }
    c = nc
    wt = nwt
    cw = nw
    ch = nh
  }
  // Pull: from coarse to fine, missing weight is made up from the (bilinear) coarser level.
  for (let l = C.length - 2; l >= 0; l--) {
    const [fw, fh] = dims[l]
    const [gw, gh] = dims[l + 1]
    const fc = C[l]
    const fwt = W[l]
    const gc = C[l + 1]
    const gwt = W[l + 1]
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const p = y * fw + x
        const a = fwt[p]
        if (a >= 1) continue
        const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / 2 - 0.5))
        const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / 2 - 0.5))
        const ix = Math.floor(gx)
        const iy = Math.floor(gy)
        const jx = Math.min(gw - 1, ix + 1)
        const jy = Math.min(gh - 1, iy + 1)
        const ax = gx - ix
        const ay = gy - iy
        const q = [iy * gw + ix, iy * gw + jx, jy * gw + ix, jy * gw + jx]
        const f = [(1 - ax) * (1 - ay), ax * (1 - ay), (1 - ax) * ay, ax * ay]
        let ww = 0
        let r = 0
        let g = 0
        let b = 0
        for (let k = 0; k < 4; k++) {
          ww += gwt[q[k]] * f[k]
          r += gc[q[k] * 3] * f[k]
          g += gc[q[k] * 3 + 1] * f[k]
          b += gc[q[k] * 3 + 2] * f[k]
        }
        // Premultiplied colours: normalise the coarse colour, then blend in the missing share.
        const inv = ww > 1e-6 ? 1 / ww : 0
        fc[p * 3] += (1 - a) * r * inv
        fc[p * 3 + 1] += (1 - a) * g * inv
        fc[p * 3 + 2] += (1 - a) * b * inv
        fwt[p] = 1
      }
  }
  // Smooth the filled area (Laplace, Gauss-Seidel), keeping known pixels fixed.
  const f = C[0]
  const iters = Math.min(200, 20 + Math.round(Math.max(rw, rh) / 4))
  for (let it = 0; it < iters; it++)
    for (let y = 1; y < rh - 1; y++)
      for (let x = 1; x < rw - 1; x++) {
        if (!mask[(y + y0) * w + x + x0]) continue
        const p = y * rw + x
        for (let k = 0; k < 3; k++) f[p * 3 + k] = (f[(p - 1) * 3 + k] + f[(p + 1) * 3 + k] + f[(p - rw) * 3 + k] + f[(p + rw) * 3 + k]) / 4
      }
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const mi = (y + y0) * w + x + x0
      if (!mask[mi]) continue
      const p = y * rw + x
      d[mi * 4] = f[p * 3]
      d[mi * 4 + 1] = f[p * 3 + 1]
      d[mi * 4 + 2] = f[p * 3 + 2]
    }
}

/** A brush stroke in page coordinates normalised to the page width (x 0..1, y 0..h/w). */
export interface Stroke {
  pts: { x: number; y: number }[]
  /** Brush radius as a fraction of the page width. */
  r: number
}

/** Rasterises strokes into a mask for a picture of size w×h. */
export function strokesMask(strokes: Stroke[], w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h)
  const disc = (cx: number, cy: number, r: number) => {
    const r2 = r * r
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) m[y * w + x] = 1
  }
  for (const s of strokes) {
    const r = Math.max(1, s.r * w)
    const P = s.pts.map((p) => ({ x: p.x * w, y: p.y * w }))
    for (let i = 0; i < P.length; i++) {
      const a = P[i]
      const b = P[Math.min(P.length - 1, i + 1)]
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r / 3)))
      for (let k = 0; k <= n; k++) disc(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, r)
    }
  }
  return m
}

export interface Edits {
  auto: AutoOptions | null
  strokes: Stroke[]
}

/** Applies a page's edits to its RGBA picture, in place: auto first, then the brushed areas. */
export function applyEdits(d: Uint8ClampedArray, w: number, h: number, e: Edits): void {
  if (e.auto) removeLightMarks(d, w, h, e.auto)
  if (e.strokes.length) inpaint(d, w, h, strokesMask(e.strokes, w, h))
}
