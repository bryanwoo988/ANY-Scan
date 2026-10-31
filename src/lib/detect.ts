// Document edge detection for Smart Scan.
//
// The photo is segmented several ways (brighter than the background, different colour from
// the table, darker than the background, low saturation). Each candidate region is fitted
// with the largest quadrilateral inside its convex hull and scored on how rectangular it is,
// how strong the image edges are along that quadrilateral, and whether it runs off the frame.
// The winner's sides are then refined by fitting straight lines to the region boundary.
import type { Point, Quad } from './image'

type Mask = Uint8Array

const WORK_SIDE = 360

function otsu(values: Float32Array, lo: number, hi: number): number {
  const bins = 256
  const hist = new Float64Array(bins)
  const span = hi - lo || 1
  for (let i = 0; i < values.length; i++) hist[Math.min(bins - 1, Math.max(0, Math.floor(((values[i] - lo) / span) * bins)))]++
  let sum = 0
  for (let i = 0; i < bins; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = -1
  let thr = bins / 2
  for (let i = 0; i < bins; i++) {
    wB += hist[i]
    if (!wB) continue
    const wF = values.length - wB
    if (!wF) break
    sumB += i * hist[i]
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
    if (between > best) {
      best = between
      thr = i
    }
  }
  return lo + ((thr + 0.5) / bins) * span
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1)
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1)
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

function morph(m: Mask, w: number, h: number, r: number, dilate: boolean): Mask {
  // Separable square structuring element.
  const pass = (src: Mask, horizontal: boolean): Mask => {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x
          const yy = horizontal ? y : y + k
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const s = src[yy * w + xx]
          if (dilate ? s : !s) {
            v = dilate ? 1 : 0
            break
          }
        }
        out[y * w + x] = v
      }
    return out
  }
  return pass(pass(m, true), false)
}

/** Labels 4-connected components; returns labels and their sizes (largest first). */
function components(m: Mask, w: number, h: number): { label: Int32Array; comps: { id: number; size: number }[] } {
  const label = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  const comps: { id: number; size: number }[] = []
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || label[s] !== -1) continue
    const id = comps.length
    let head = 0
    let tail = 0
    queue[tail++] = s
    label[s] = id
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      if (x > 0 && m[p - 1] && label[p - 1] === -1) (label[p - 1] = id), (queue[tail++] = p - 1)
      if (x < w - 1 && m[p + 1] && label[p + 1] === -1) (label[p + 1] = id), (queue[tail++] = p + 1)
      if (p >= w && m[p - w] && label[p - w] === -1) (label[p - w] = id), (queue[tail++] = p - w)
      if (p < w * (h - 1) && m[p + w] && label[p + w] === -1) (label[p + w] = id), (queue[tail++] = p + w)
    }
    comps.push({ id, size: tail })
  }
  comps.sort((a, b) => b.size - a.size)
  return { label, comps }
}

/** Fills holes (text, photos on an ID card) by flooding the background from the image border. */
function fillHoles(m: Mask, w: number, h: number): Mask {
  const outside = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let tail = 0
  const seed = (p: number) => {
    if (!m[p] && !outside[p]) (outside[p] = 1), (queue[tail++] = p)
  }
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x)
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1)
  let head = 0
  while (head < tail) {
    const p = queue[head++]
    const x = p % w
    if (x > 0) seed(p - 1)
    if (x < w - 1) seed(p + 1)
    if (p >= w) seed(p - w)
    if (p < w * (h - 1)) seed(p + w)
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = outside[i] ? 0 : 1
  return out
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

function convexHull(pts: Point[]): Point[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const lower: Point[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Point[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

export function polygonArea(q: Point[]): number {
  let a = 0
  for (let i = 0; i < q.length; i++) {
    const n = q[(i + 1) % q.length]
    a += q[i].x * n.y - n.x * q[i].y
  }
  return Math.abs(a) / 2
}

/** Largest-area quadrilateral whose corners are hull vertices. */
function maxAreaQuad(hull: Point[]): Point[] | null {
  let h = hull
  if (h.length < 4) return null
  if (h.length > 48) {
    const step = h.length / 48
    h = Array.from({ length: 48 }, (_, i) => h[Math.floor(i * step)])
  }
  const n = h.length
  let best = -1
  let res: Point[] | null = null
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const t1 = Math.abs(cross(h[i], h[j], h[k]))
        for (let l = k + 1; l < n; l++) {
          const a = t1 + Math.abs(cross(h[i], h[k], h[l]))
          if (a > best) {
            best = a
            res = [h[i], h[j], h[k], h[l]]
          }
        }
      }
  return res
}

/** Orders corners as top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(pts: Point[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0
  for (let i = 1; i < 4; i++) if (byAngle[i].x + byAngle[i].y < byAngle[start].x + byAngle[start].y) start = i
  return [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4]) as Quad
}

function anglesOk(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4]
    const b = q[i]
    const c = q[(i + 1) % 4]
    const v1 = { x: a.x - b.x, y: a.y - b.y }
    const v2 = { x: c.x - b.x, y: c.y - b.y }
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
    if (deg < 45 || deg > 135) return false
  }
  return true
}

/** Fits a line to points (total least squares) → point on line + unit direction. */
function fitLine(pts: Point[]): { p: Point; d: Point } | null {
  if (pts.length < 6) return null
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of pts) {
    sxx += (p.x - mx) ** 2
    sxy += (p.x - mx) * (p.y - my)
    syy += (p.y - my) ** 2
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } }
}

function intersect(a: { p: Point; d: Point }, b: { p: Point; d: Point }): Point | null {
  const den = a.d.x * b.d.y - a.d.y * b.d.x
  if (Math.abs(den) < 1e-6) return null
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / den
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t }
}

const distToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t }
}

/** Moves each side onto the best straight line through the nearby region boundary. */
function refine(q: Quad, boundary: Point[], tol: number): Quad {
  const lines = q.map((a, i) => {
    const b = q[(i + 1) % 4]
    const near = boundary.filter((p) => {
      const r = distToSegment(p, a, b)
      return r.d < tol && r.t > 0.12 && r.t < 0.88
    })
    return fitLine(near)
  })
  if (lines.some((l) => !l)) return q
  const out = q.map((p, i) => intersect(lines[(i + 3) % 4]!, lines[i]!) ?? p)
  // Reject refinements that moved a corner implausibly far.
  return out.every((p, i) => Math.hypot(p.x - q[i].x, p.y - q[i].y) < tol * 4) ? (out as Quad) : q
}

/**
 * Mean edge strength across a line segment, counting only gradients whose direction matches
 * `polarity` (+1: brighter inside the document, -1: darker inside). Text lines inside the page
 * alternate polarity, so they score lower than the continuous page border.
 */
function lineSupport(a: Point, b: Point, inward: Point, polarity: number, GX: Float32Array, GY: Float32Array, w: number, h: number): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const steps = Math.max(8, Math.round(len / 1.5))
  let sum = 0
  let count = 0
  for (let s = 1; s < steps; s++) {
    const t = s / steps
    const x = Math.round(a.x + (b.x - a.x) * t)
    const y = Math.round(a.y + (b.y - a.y) * t)
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue
    const i = y * w + x
    // Gradient points from dark to bright; project onto the inward normal.
    const proj = (GX[i] * inward.x + GY[i] * inward.y) * polarity
    sum += Math.max(0, proj)
    count++
  }
  return count ? sum / count : 0
}

/** Nudges each side onto the strongest nearby straight edge, then re-derives the corners. */
function snapSides(q: Quad, L: Float32Array, GX: Float32Array, GY: Float32Array, w: number, h: number): Quad {
  const R = Math.max(4, Math.round(Math.min(w, h) * 0.06))
  const cx = q.reduce((s, p) => s + p.x, 0) / 4
  const cy = q.reduce((s, p) => s + p.y, 0) / 4
  const lines: { p: Point; d: Point }[] = []
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    let nrm = { x: -d.y, y: d.x }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if ((cx - mid.x) * nrm.x + (cy - mid.y) * nrm.y < 0) nrm = { x: -nrm.x, y: -nrm.y }
    // Use the middle 80% of the side so neighbouring sides don't interfere.
    const a0 = { x: a.x + (b.x - a.x) * 0.1, y: a.y + (b.y - a.y) * 0.1 }
    const b0 = { x: a.x + (b.x - a.x) * 0.9, y: a.y + (b.y - a.y) * 0.9 }
    // Polarity from the current estimate: is the inside brighter than the outside?
    const sample = (pt: Point, off: number) => {
      const x = Math.round(pt.x + nrm.x * off)
      const y = Math.round(pt.y + nrm.y * off)
      return x >= 0 && y >= 0 && x < w && y < h ? L[y * w + x] : NaN
    }
    let inside = 0
    let outside = 0
    let k = 0
    for (let s = 0; s <= 10; s++) {
      const pt = { x: a0.x + (b0.x - a0.x) * (s / 10), y: a0.y + (b0.y - a0.y) * (s / 10) }
      const vi = sample(pt, 4)
      const vo = sample(pt, -4)
      if (Number.isNaN(vi) || Number.isNaN(vo)) continue
      inside += vi
      outside += vo
      k++
    }
    const polarity = k && inside < outside ? -1 : 1
    let best = { score: lineSupport(a0, b0, nrm, polarity, GX, GY, w, h), oa: 0, ob: 0 }
    const base = best.score
    for (let oa = -R; oa <= R; oa++)
      for (let ob = -R; ob <= R; ob++) {
        const pa = { x: a0.x + nrm.x * oa, y: a0.y + nrm.y * oa }
        const pb = { x: b0.x + nrm.x * ob, y: b0.y + nrm.y * ob }
        // Small preference for staying put avoids jumping to a parallel text line of equal strength.
        const sc = lineSupport(pa, pb, nrm, polarity, GX, GY, w, h) * (1 - 0.004 * (Math.abs(oa) + Math.abs(ob)))
        if (sc > best.score) best = { score: sc, oa, ob }
      }
    // Only move if the new edge is clearly better than the current one.
    if (best.score < base * 1.15) (best.oa = 0), (best.ob = 0)
    const pa = { x: a0.x + nrm.x * best.oa, y: a0.y + nrm.y * best.oa }
    const pb = { x: b0.x + nrm.x * best.ob, y: b0.y + nrm.y * best.ob }
    const l = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1
    lines.push({ p: pa, d: { x: (pb.x - pa.x) / l, y: (pb.y - pa.y) / l } })
  }
  const out = q.map((p, i) => intersect(lines[(i + 3) % 4], lines[i]) ?? p) as Quad
  const ok = out.every((p) => p.x > -w * 0.05 && p.y > -h * 0.05 && p.x < w * 1.05 && p.y < h * 1.05) && anglesOk(out)
  return ok ? out : q
}

/**
 * Pushes sides that are not on a real edge outwards to the nearest continuous edge. Shading (a
 * vignette, a hand shadow) can split a page into pieces; a piece's box has weak sides that cut
 * across the paper, and the true page border lies further out. Text rows also make edges but have
 * gaps between words, so they don't pass the continuity threshold.
 */
function expandWeakSides(q: Quad, GX: Float32Array, GY: Float32Array, E: Float32Array, eRef: number, w: number, h: number): Quad {
  const cx = q.reduce((s, p) => s + p.x, 0) / 4
  const cy = q.reduce((s, p) => s + p.y, 0) / 4
  const R = Math.round(Math.min(w, h) * 0.35)
  const support = (a: Point, b: Point, nrm: Point) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(10, Math.round(len / 2))
    let pos = 0
    let neg = 0
    let n = 0
    for (let s = 1; s < steps; s++) {
      const t = 0.1 + (0.8 * s) / steps
      const x = Math.round(a.x + (b.x - a.x) * t)
      const y = Math.round(a.y + (b.y - a.y) * t)
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue
      n++
      let best = 0
      for (let k = -1; k <= 1; k++) {
        const i = (y + Math.round(nrm.y * k)) * w + x + Math.round(nrm.x * k)
        if (E[i] > Math.abs(best)) best = GX[i] * nrm.x + GY[i] * nrm.y
      }
      if (best > eRef * 0.3) pos++
      else if (best < -eRef * 0.3) neg++
    }
    return n < 6 ? 0 : Math.max(pos, neg) / n
  }
  const lines = q.map((a, i) => {
    const b = q[(i + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    let nrm = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if ((mid.x - cx) * nrm.x + (mid.y - cy) * nrm.y < 0) nrm = { x: -nrm.x, y: -nrm.y } // outward
    const here = support(a, b, nrm)
    let off = 0
    if (here < 0.7) {
      for (let o = 2; o <= R; o++) {
        const a2 = { x: a.x + nrm.x * o, y: a.y + nrm.y * o }
        const b2 = { x: b.x + nrm.x * o, y: b.y + nrm.y * o }
        if (a2.x < 0 || a2.y < 0 || a2.x > w || a2.y > h || b2.x < 0 || b2.y < 0 || b2.x > w || b2.y > h) break
        if (support(a2, b2, nrm) >= 0.85) {
          off = o
          break
        }
      }
    }
    const p = { x: a.x + nrm.x * off, y: a.y + nrm.y * off }
    return { p, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } }
  })
  const out = q.map((p, i) => intersect(lines[(i + 3) % 4], lines[i]) ?? p) as Quad
  return anglesOk(out) ? out : q
}

interface Candidate {
  quad: Quad
  boundary: Point[]
  score: number
  /** Score without the edge term, used to re-rank after snapping. */
  shape: number
}

/** Per side: samples on a strong image edge, samples taken, and samples lying on the frame border. */
function sideSupport(quad: Quad, E: Float32Array, eRef: number, w: number, h: number) {
  return quad.map((a, i) => {
    const bq = quad[(i + 1) % 4]
    const len = Math.hypot(bq.x - a.x, bq.y - a.y)
    const nx = -(bq.y - a.y) / (len || 1)
    const ny = (bq.x - a.x) / (len || 1)
    const steps = Math.max(8, Math.round(len / 2))
    let hits = 0
    let onBorder = 0
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      const px = a.x + (bq.x - a.x) * t
      const py = a.y + (bq.y - a.y) * t
      if (px < 3 || py < 3 || px > w - 4 || py > h - 4) {
        onBorder++
        continue
      }
      let m = 0
      for (let k = -2; k <= 2; k++) {
        const xx = Math.round(px + nx * k)
        const yy = Math.round(py + ny * k)
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) m = Math.max(m, E[yy * w + xx])
      }
      if (m > eRef * 0.25) hits++
    }
    return { hits, samples: steps - 1, onBorder }
  })
}

/**
 * Finds a document in an RGBA buffer. Returns corners in buffer coordinates, or null if no
 * convincing document is found (the caller then falls back to the whole photo).
 */
export function detectQuadRGBA(rgba: Uint8ClampedArray, w: number, h: number): Quad | null {
  const n = w * h
  const R = new Float32Array(n)
  const G = new Float32Array(n)
  const B = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    R[i] = rgba[i * 4]
    G[i] = rgba[i * 4 + 1]
    B[i] = rgba[i * 4 + 2]
  }
  const r = boxBlur(R, w, h, 2)
  const g = boxBlur(G, w, h, 2)
  const b = boxBlur(B, w, h, 2)
  const L = new Float32Array(n)
  const S = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    L[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i]
    S[i] = Math.max(r[i], g[i], b[i]) - Math.min(r[i], g[i], b[i])
  }

  // Background colour estimate: median of a thin band around the frame.
  const band: number[][] = [[], [], []]
  const bw = Math.max(2, Math.round(Math.min(w, h) * 0.02))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x < bw || y < bw || x >= w - bw || y >= h - bw) {
        const i = y * w + x
        band[0].push(r[i])
        band[1].push(g[i])
        band[2].push(b[i])
      }
  const med = band.map((a) => a.sort((p, q) => p - q)[a.length >> 1])
  const D = new Float32Array(n)
  for (let i = 0; i < n; i++) D[i] = Math.hypot(r[i] - med[0], g[i] - med[1], b[i] - med[2])

  // Edge strength (Sobel on luminance) for scoring sides.
  const E = new Float32Array(n)
  const GX = new Float32Array(n)
  const GY = new Float32Array(n)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1]
      const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1]
      GX[i] = gx
      GY[i] = gy
      E[i] = Math.hypot(gx, gy)
    }
  const sortedE = Float32Array.from(E).sort()
  const eRef = Math.max(20, sortedE[Math.floor(n * 0.97)])

  const tL = otsu(L, 0, 255)
  const tD = otsu(D, 0, 442)
  const tS = otsu(S, 0, 255)
  // Local contrast: brighter than the neighbourhood average catches white paper on a light table.
  const Lbig = boxBlur(L, w, h, Math.round(Math.max(w, h) / 6))
  const masks: Mask[] = [
    Uint8Array.from(L, (v) => (v > tL ? 1 : 0)),
    Uint8Array.from(D, (v) => (v > tD ? 1 : 0)),
    Uint8Array.from(L, (v) => (v < tL ? 1 : 0)),
    Uint8Array.from(S, (v, i) => (v < tS && L[i] > tL * 0.8 ? 1 : 0)),
    Uint8Array.from(L, (v, i) => (v > Lbig[i] + 4 ? 1 : 0)),
  ]

  const candidates: Candidate[] = []
  const minSide = Math.min(w, h)
  for (const raw of masks) {
    // Open to cut thin bridges to the background, close to heal text gaps, then fill holes.
    const opened = morph(morph(raw, w, h, 2, false), w, h, 2, true)
    const cleaned = fillHoles(morph(morph(opened, w, h, 3, true), w, h, 3, false), w, h)
    const { label, comps } = components(cleaned, w, h)
    for (const c of comps.slice(0, 3)) {
      const frac = c.size / n
      if (frac < 0.06 || frac > 0.985) continue
      const boundary: Point[] = []
      let touch = 0
      for (let p = 0; p < n; p++) {
        if (label[p] !== c.id) continue
        const x = p % w
        const y = (p - x) / w
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || label[p - 1] !== c.id || label[p + 1] !== c.id || label[p - w] !== c.id || label[p + w] !== c.id
        if (!edge) continue
        boundary.push({ x: x + 0.5, y: y + 0.5 })
        if (x < 2 || y < 2 || x > w - 3 || y > h - 3) touch++
      }
      const hullQuad = maxAreaQuad(convexHull(boundary))
      if (!hullQuad) continue
      let quad = orderQuad(hullQuad)
      if (!anglesOk(quad)) continue
      quad = refine(quad, boundary, minSide * 0.03)
      const qa = polygonArea(quad)
      if (qa < n * 0.05) continue
      const rect = Math.min(c.size / qa, qa / c.size)

      // Edge support: share of samples along the four sides that sit on a real image edge.
      const sides = sideSupport(quad, E, eRef, w, h)
      const hits = sides.reduce((a, x) => a + x.hits, 0)
      const samples = sides.reduce((a, x) => a + x.samples, 0)
      const onBorder = sides.reduce((a, x) => a + x.onBorder, 0)
      const edge = hits / Math.max(1, samples - onBorder)
      const borderFrac = onBorder / samples
      const area = qa / n
      const areaScore = area < 0.15 ? area / 0.15 : 1
      // Regions hugging the frame are usually the table; keep them only if their inner edges are strong.
      const touchFrac = touch / Math.max(1, boundary.length)
      const shape = rect ** 3 * (1 - 0.8 * borderFrac) * (1 - 0.5 * touchFrac) * areaScore
      const score = shape * (0.25 + 0.75 * edge)
      candidates.push({ quad, boundary, score, shape })
    }
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score)
  if (candidates[0].score < 0.3) return null
  // Several segmentations can produce plausible boxes (e.g. a vignette shrinks the bright area).
  // Snap the leading ones to real edges and prefer the box whose weakest sides are best supported:
  // a true page border is a continuous edge on all four sides, a truncated box cuts across the page.
  let snapped = snapSides(candidates[0].quad, L, GX, GY, w, h)
  let bestFinal = -1
  for (const c of candidates.slice(0, 5)) {
    if (c.score < candidates[0].score * 0.4) break
    const q = snapSides(expandWeakSides(snapSides(c.quad, L, GX, GY, w, h), GX, GY, E, eRef, w, h), L, GX, GY, w, h)
    const ratios = sideSupport(q, E, eRef, w, h)
      .map((x) => (x.samples - x.onBorder < x.samples * 0.3 ? 0.6 : x.hits / Math.max(1, x.samples - x.onBorder)))
      .sort((a, b) => a - b)
    const weakest = (ratios[0] + ratios[1]) / 2
    const final = c.shape * (0.2 + 0.8 * weakest)
    if (final > bestFinal) {
      bestFinal = final
      snapped = q
    }
  }
  return snapped.map((p) => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) })) as Quad
}

/**
 * Number of the box's sides that lie along an edge of the picture. A projected slide or a
 * whiteboard that fills the picture has no border of its own, and detection then finds a part
 * of it instead (the white area under a dark title bar, or the title bar alone): such a box runs
 * along two or more picture edges.
 */
export function sidesOnFrame(q: Quad, w: number, h: number, tol = 0.03): number {
  const tx = w * tol
  const ty = h * tol
  let n = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    if ((a.x < tx && b.x < tx) || (a.x > w - tx && b.x > w - tx) || (a.y < ty && b.y < ty) || (a.y > h - ty && b.y > h - ty)) n++
  }
  return n
}

/** Longer side over shorter side of a box (opposite sides averaged). */
export function quadAspect(q: Quad): number {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const wq = (d(q[0], q[1]) + d(q[3], q[2])) / 2
  const hq = (d(q[0], q[3]) + d(q[1], q[2])) / 2
  return Math.max(wq, hq) / Math.max(1e-6, Math.min(wq, hq))
}

/** Best-effort automatic detection of a document in a photo; coordinates are in `src` pixels. */
export function detectDocument(src: HTMLCanvasElement): Quad | null {
  const s = Math.min(1, WORK_SIDE / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * s))
  c.height = Math.max(1, Math.round(src.height * s))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  const q = detectQuadRGBA(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)
  if (!q) return null
  const sx = src.width / c.width
  const sy = src.height / c.height
  return q.map((p) => ({ x: Math.min(src.width, p.x * sx), y: Math.min(src.height, p.y * sy) })) as Quad
}
