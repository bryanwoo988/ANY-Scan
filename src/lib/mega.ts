// Mega Scan: joins overlapping photos of something too big for one shot (a poster, a map, a
// blueprint) into one picture. Photos can be taken in any order and in a grid; each is matched
// to the others by local features, related by a homography (so a slightly tilted or closer
// photo still lines up), and drawn into one canvas with the exposure evened out.
//
// The pipeline is the standard one for panoramas of flat scenes: corners → patch descriptors →
// ratio-test matching → RANSAC homography → spanning tree from the best-connected photo.
import { boxBlur } from './image'

export type Mat3 = number[] // row-major 3×3
export interface GrayF {
  w: number
  h: number
  data: Float32Array
}
export interface Features {
  x: Float32Array
  y: Float32Array
  /** DESC values per feature, zero mean, unit length. */
  desc: Float32Array
  /** Smoothed brightness at each feature (for exposure matching). */
  level: Float32Array
  n: number
}

const P = 8 // descriptor is P×P samples…
const STEP = 2 // …taken STEP px apart
const DESC = P * P
const MARGIN = (P / 2) * STEP + 2

export function grayFromRGBA(d: Uint8ClampedArray | Uint8Array, w: number, h: number): GrayF {
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  return { w, h, data: g }
}

/** Shi–Tomasi corners, spread over the picture (best few per grid cell), with patch descriptors. */
export function features(img: GrayF, max = 700): Features {
  const { w, h } = img
  const s = img.data.slice()
  boxBlur(s, w, h, 1)
  const ixx = new Float32Array(w * h)
  const iyy = new Float32Array(w * h)
  const ixy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = s[i + 1] - s[i - 1]
      const gy = s[i + w] - s[i - w]
      ixx[i] = gx * gx
      iyy[i] = gy * gy
      ixy[i] = gx * gy
    }
  boxBlur(ixx, w, h, 2)
  boxBlur(iyy, w, h, 2)
  boxBlur(ixy, w, h, 2)
  const R = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = ixx[i]
    const c = iyy[i]
    const b = ixy[i]
    R[i] = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b) // smaller eigenvalue
  }
  // Grid cells so features cover the whole photo, not just its busiest corner.
  const cell = Math.max(12, Math.round(Math.sqrt((w * h) / max) * 1.4))
  const perCell = Math.max(1, Math.round((max * cell * cell) / (w * h)))
  const pts: { x: number; y: number; r: number; sx: number; sy: number }[] = []
  let maxR = 0
  for (let i = 0; i < w * h; i++) if (R[i] > maxR) maxR = R[i]
  const floor = maxR * 0.002
  for (let cy = MARGIN; cy < h - MARGIN; cy += cell)
    for (let cx = MARGIN; cx < w - MARGIN; cx += cell) {
      const local: { x: number; y: number; r: number; sx: number; sy: number }[] = []
      for (let y = cy; y < Math.min(h - MARGIN, cy + cell); y++)
        for (let x = cx; x < Math.min(w - MARGIN, cx + cell); x++) {
          const i = y * w + x
          const r = R[i]
          if (r <= floor) continue
          if (r < R[i - 1] || r < R[i + 1] || r < R[i - w] || r < R[i + w] || r < R[i - w - 1] || r < R[i - w + 1] || r < R[i + w - 1] || r < R[i + w + 1]) continue
          // Sub-pixel position: peak of a parabola through the neighbours.
          const dx = (R[i + 1] - R[i - 1]) / (2 * (2 * r - R[i + 1] - R[i - 1]) || 1)
          const dy = (R[i + w] - R[i - w]) / (2 * (2 * r - R[i + w] - R[i - w]) || 1)
          local.push({ x, y, r, sx: x + Math.max(-0.5, Math.min(0.5, dx)), sy: y + Math.max(-0.5, Math.min(0.5, dy)) })
        }
      local.sort((a, b) => b.r - a.r)
      pts.push(...local.slice(0, perCell))
    }
  // Descriptors from a more blurred copy (tolerates small rotation and scale changes).
  const b = img.data.slice()
  boxBlur(b, w, h, 1)
  boxBlur(b, w, h, 1)
  const n = pts.length
  const out: Features = { x: new Float32Array(n), y: new Float32Array(n), desc: new Float32Array(n * DESC), level: new Float32Array(n), n }
  let k = 0
  for (const p of pts) {
    const o = k * DESC
    let mean = 0
    for (let j = 0; j < P; j++)
      for (let i = 0; i < P; i++) {
        const v = b[(p.y + (j - P / 2 + 0.5) * STEP) * w + p.x + (i - P / 2 + 0.5) * STEP] ?? b[p.y * w + p.x]
        out.desc[o + j * P + i] = v
        mean += v
      }
    mean /= DESC
    let norm = 0
    for (let i = 0; i < DESC; i++) {
      out.desc[o + i] -= mean
      norm += out.desc[o + i] ** 2
    }
    if (norm < 1) continue // flat patch
    norm = Math.sqrt(norm)
    for (let i = 0; i < DESC; i++) out.desc[o + i] /= norm
    out.x[k] = p.sx
    out.y[k] = p.sy
    out.level[k] = mean
    k++
  }
  out.n = k
  return out
}

/** Mutual nearest neighbours that pass Lowe's ratio test. Returns pairs [indexA, indexB]. */
export function matchFeatures(a: Features, b: Features, ratio = 0.8): [number, number][] {
  const bestB = new Int32Array(b.n).fill(-1)
  const bestBScore = new Float32Array(b.n).fill(-2)
  const fwd: { j: number; ok: boolean }[] = []
  for (let i = 0; i < a.n; i++) {
    let s1 = -2
    let s2 = -2
    let j1 = -1
    const oa = i * DESC
    for (let j = 0; j < b.n; j++) {
      const ob = j * DESC
      let s = 0
      for (let k = 0; k < DESC; k++) s += a.desc[oa + k] * b.desc[ob + k]
      if (s > s1) {
        s2 = s1
        s1 = s
        j1 = j
      } else if (s > s2) s2 = s
      if (s > bestBScore[j]) {
        bestBScore[j] = s
        bestB[j] = i
      }
    }
    // Distances between unit vectors: d² = 2 − 2·score.
    const d1 = 2 - 2 * s1
    const d2 = 2 - 2 * s2
    fwd.push({ j: j1, ok: j1 >= 0 && s1 > 0.75 && d1 < ratio * ratio * d2 })
  }
  const out: [number, number][] = []
  fwd.forEach((m, i) => m.ok && bestB[m.j] === i && out.push([i, m.j]))
  return out
}

// ---------------------------------------------------------------- homographies

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}

export function inv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

export function apply(m: Mat3, x: number, y: number): [number, number] {
  const z = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z]
}

export const scale = (sx: number, sy = sx): Mat3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1]
export const translate = (tx: number, ty: number): Mat3 => [1, 0, tx, 0, 1, ty, 0, 0, 1]

/** Solves an n×n linear system in place (Gaussian elimination, partial pivoting). */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-10) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    ;[b[c], b[p]] = [b[p], b[c]]
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]
      if (!f) continue
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]
    x[r] = s / A[r][r]
  }
  return x
}

/** Least-squares homography mapping src[i] → dst[i] (≥ 4 points), with Hartley normalisation. */
export function fitHomography(src: [number, number][], dst: [number, number][]): Mat3 | null {
  const norm = (pts: [number, number][]): Mat3 => {
    let mx = 0
    let my = 0
    for (const [x, y] of pts) {
      mx += x
      my += y
    }
    mx /= pts.length
    my /= pts.length
    let d = 0
    for (const [x, y] of pts) d += Math.hypot(x - mx, y - my)
    const s = Math.SQRT2 / Math.max(1e-9, d / pts.length)
    return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1]
  }
  const Ts = norm(src)
  const Td = norm(dst)
  const ATA = Array.from({ length: 8 }, () => new Array(8).fill(0))
  const ATb = new Array(8).fill(0)
  const add = (row: number[], v: number) => {
    for (let i = 0; i < 8; i++) {
      ATb[i] += row[i] * v
      for (let j = 0; j < 8; j++) ATA[i][j] += row[i] * row[j]
    }
  }
  for (let k = 0; k < src.length; k++) {
    const [u, v] = apply(Ts, src[k][0], src[k][1])
    const [x, y] = apply(Td, dst[k][0], dst[k][1])
    add([u, v, 1, 0, 0, 0, -u * x, -v * x], x)
    add([0, 0, 0, u, v, 1, -u * y, -v * y], y)
  }
  const h = solve(ATA, ATb)
  if (!h || h.some((v) => !Number.isFinite(v))) return null
  const Hn = [...h, 1]
  const H = mul(inv(Td), mul(Hn, Ts))
  return H.map((v) => v / H[8])
}

/** Whether H maps a w×h photo to a sane shape: convex, not mirrored, not wildly scaled. */
export function plausible(H: Mat3, w: number, h: number): boolean {
  const c = [apply(H, 0, 0), apply(H, w, 0), apply(H, w, h), apply(H, 0, h)]
  if (c.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return false
  let sign = 0
  let area = 0
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i]
    const [bx, by] = c[(i + 1) % 4]
    const [cx, cy] = c[(i + 2) % 4]
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
    area += ax * by - bx * ay
  }
  const ratio = Math.abs(area / 2) / (w * h)
  return sign > 0 && ratio > 0.35 && ratio < 3
}

/** Simple seeded generator so results are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export interface PairFit {
  H: Mat3 // maps photo A's coordinates to photo B's
  inliers: number
  /** B's brightness ÷ A's on the matched spots (median). */
  gain: number
}

/** RANSAC homography between two photos' features. */
export function fitPair(a: Features, b: Features, size: { w: number; h: number }, thresh = 3): PairFit | null {
  const m = matchFeatures(a, b)
  if (m.length < 12) return null
  const src = m.map(([i]) => [a.x[i], a.y[i]] as [number, number])
  const dst = m.map(([, j]) => [b.x[j], b.y[j]] as [number, number])
  const rand = rng(m.length * 7919)
  const t2 = thresh * thresh
  let best: number[] = []
  const iters = 1500
  for (let it = 0; it < iters; it++) {
    const pick = new Set<number>()
    while (pick.size < 4) pick.add(Math.floor(rand() * m.length))
    const idx = [...pick]
    const H = fitHomography(
      idx.map((i) => src[i]),
      idx.map((i) => dst[i]),
    )
    if (!H) continue
    const inl: number[] = []
    for (let k = 0; k < m.length; k++) {
      const [x, y] = apply(H, src[k][0], src[k][1])
      if ((x - dst[k][0]) ** 2 + (y - dst[k][1]) ** 2 < t2) inl.push(k)
    }
    if (inl.length > best.length) best = inl
    if (best.length > m.length * 0.8) break
  }
  if (best.length < 12) return null
  // Refit on the inliers, then tighten: refit on what agrees within 2 px, then 1.5 px.
  let H = fitHomography(
    best.map((k) => src[k]),
    best.map((k) => dst[k]),
  )
  if (!H) return null
  for (const t of [thresh, 2, 1.5]) {
    const inl: number[] = []
    for (let k = 0; k < m.length; k++) {
      const [x, y] = apply(H, src[k][0], src[k][1])
      if ((x - dst[k][0]) ** 2 + (y - dst[k][1]) ** 2 < t * t) inl.push(k)
    }
    if (inl.length < 12 || inl.length < best.length * 0.6) break
    const H2 = fitHomography(
      inl.map((k) => src[k]),
      inl.map((k) => dst[k]),
    )
    if (!H2) break
    H = H2
    if (t === thresh) best = inl
  }
  // Enough agreeing matches, and a fair share of all matches (random textures give few).
  if (best.length < Math.max(12, m.length * 0.15) || !plausible(H, size.w, size.h)) return null
  const ratios = best.map((k) => (b.level[m[k][1]] + 1) / (a.level[m[k][0]] + 1)).sort((x, y) => x - y)
  return { H, inliers: best.length, gain: ratios[ratios.length >> 1] }
}

export interface Mosaic {
  /** For each photo: maps its (analysis) coordinates to the reference photo's, or null if it didn't fit. */
  H: (Mat3 | null)[]
  /** Brightness multiplier per photo so the overlaps match. */
  gain: number[]
  ref: number
  /** Bounding box of all placed photos in reference coordinates. */
  box: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Relates every photo to the best-connected one. `sizes` are the analysis sizes. Photos that
 * share no reliable overlap with the rest get H = null.
 */
export function planMosaic(feats: Features[], sizes: { w: number; h: number }[], onProgress?: (f: number) => void): Mosaic {
  const n = feats.length
  const fits: (PairFit | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null))
  const total = (n * (n - 1)) / 2
  let done = 0
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const f = fitPair(feats[i], feats[j], sizes[i])
      if (f) {
        fits[i][j] = f
        const Hi = inv(f.H)
        fits[j][i] = { H: Hi.map((v) => v / Hi[8]), inliers: f.inliers, gain: 1 / f.gain }
      }
      onProgress?.(++done / Math.max(1, total))
    }
  // Reference: the photo with the most matched points in total (usually a middle one).
  let ref = 0
  let bestSum = -1
  for (let i = 0; i < n; i++) {
    const s = fits[i].reduce((t, f) => t + (f?.inliers ?? 0), 0)
    if (s > bestSum) {
      bestSum = s
      ref = i
    }
  }
  // Maximum spanning tree (Prim) by inlier count, growing from the reference.
  const H: (Mat3 | null)[] = new Array(n).fill(null)
  const gain = new Array(n).fill(1)
  H[ref] = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const inTree = new Set([ref])
  for (;;) {
    let pick: [number, number] | null = null
    let best = 0
    for (const t of inTree)
      for (let k = 0; k < n; k++) {
        if (inTree.has(k)) continue
        const f = fits[k][t]
        if (f && f.inliers > best) {
          best = f.inliers
          pick = [k, t]
        }
      }
    if (!pick) break
    const [k, t] = pick
    const f = fits[k][t]!
    const m = mul(H[t]!, f.H)
    H[k] = m.map((v) => v / m[8])
    gain[k] = gain[t] / f.gain // brightness of k relative to the reference
    inTree.add(k)
  }
  // Exposure: use every overlap, not just the tree's, so small errors don't add up along a chain.
  // Least squares on log brightness (Gauss–Seidel), starting from the tree's values.
  const B = gain.map((g) => Math.log(g))
  for (let it = 0; it < 60; it++)
    for (let i = 0; i < n; i++) {
      if (!H[i]) continue
      let sw = 0
      let sb = 0
      for (let j = 0; j < n; j++) {
        const f = fits[i][j] // f.gain = brightness of j ÷ brightness of i
        if (!f || !H[j]) continue
        sw += f.inliers
        sb += f.inliers * (B[j] - Math.log(f.gain))
      }
      if (sw) B[i] = sb / sw
    }
  // Even out exposure around the average instead of around the reference.
  const placed = B.filter((_, i) => H[i])
  const mean = placed.reduce((s, b) => s + b, 0) / placed.length
  for (let i = 0; i < n; i++) gain[i] = H[i] ? Math.exp(mean - B[i]) : 1
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  H.forEach((m, i) => {
    if (!m) return
    const { w, h } = sizes[i]
    for (const [x, y] of [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)]) {
      box.x0 = Math.min(box.x0, x)
      box.y0 = Math.min(box.y0, y)
      box.x1 = Math.max(box.x1, x)
      box.y1 = Math.max(box.y1, y)
    }
  })
  return { H, gain, ref, box }
}

/**
 * Draws one photo into the output. `toSrc` maps output pixels to the photo's pixels. Each output
 * pixel keeps the photo whose centre it is nearest to (no ghosting where photos disagree a
 * little); near the seams the two are blended over a narrow band so the join doesn't show.
 */
export function composite(out: Uint8ClampedArray, best: Float32Array, ow: number, oh: number, src: Uint8ClampedArray, sw: number, sh: number, toSrc: Mat3, gain: number): void {
  const fromSrc = inv(toSrc)
  let x0 = ow
  let y0 = oh
  let x1 = 0
  let y1 = 0
  for (const [x, y] of [apply(fromSrc, 0, 0), apply(fromSrc, sw, 0), apply(fromSrc, sw, sh), apply(fromSrc, 0, sh)]) {
    x0 = Math.min(x0, Math.floor(x))
    y0 = Math.min(y0, Math.floor(y))
    x1 = Math.max(x1, Math.ceil(x))
    y1 = Math.max(y1, Math.ceil(y))
  }
  x0 = Math.max(0, x0)
  y0 = Math.max(0, y0)
  x1 = Math.min(ow, x1)
  y1 = Math.min(oh, y1)
  const half = Math.min(sw, sh) / 2
  const BAND = 0.08
  const [a, b, c, d, e, f, g, h, k] = toSrc
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const z = g * x + h * y + k
      const sx = (a * x + b * y + c) / z
      const sy = (d * x + e * y + f) / z
      if (sx < 0 || sy < 0 || sx > sw - 1.001 || sy > sh - 1.001) continue
      const wgt = Math.min(sx, sy, sw - 1 - sx, sh - 1 - sy) / half
      const o = y * ow + x
      const cur = best[o]
      // Blend weight for this photo: 1 well inside it, 0 well inside the other, ramp at the seam.
      const alpha = cur <= 0 ? 1 : Math.min(1, Math.max(0, (wgt - cur) / BAND + 0.5))
      if (alpha <= 0) continue
      const ix = sx | 0
      const iy = sy | 0
      const fx = sx - ix
      const fy = sy - iy
      const i00 = (iy * sw + ix) * 4
      const i10 = i00 + 4
      const i01 = i00 + sw * 4
      const i11 = i01 + 4
      const oi = o * 4
      for (let q = 0; q < 3; q++) {
        const top = src[i00 + q] + (src[i10 + q] - src[i00 + q]) * fx
        const bot = src[i01 + q] + (src[i11 + q] - src[i01 + q]) * fx
        const v = (top + (bot - top) * fy) * gain
        out[oi + q] = alpha >= 1 ? v : out[oi + q] + (v - out[oi + q]) * alpha
      }
      out[oi + 3] = 255
      if (wgt > cur) best[o] = wgt
    }
}
