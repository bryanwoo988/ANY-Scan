// Long screenshots: joins screenshots taken while scrolling into one tall image. Finds the bars
// that stay put (status bar, app header, tab bar) so they appear once, and the overlap between
// each pair of screenshots so repeated content is cut out.

/** A grayscale image. */
export interface Gray {
  w: number
  h: number
  data: Uint8Array
}

export function toGray(img: ImageData): Gray {
  const { width: w, height: h, data } = img
  const g = new Uint8Array(w * h)
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
  return { w, h, data: g }
}

/** Fraction of pixels in row `ya` of a and row `yb` of b that clearly differ. */
function rowDiff(a: Gray, ya: number, b: Gray, yb: number, step = 1): number {
  let n = 0
  let d = 0
  const ra = ya * a.w
  const rb = yb * b.w
  for (let x = 0; x < a.w; x += step, n++) if (Math.abs(a.data[ra + x] - b.data[rb + x]) > 24) d++
  return d / n
}

/**
 * Height of the bands at the top and bottom that look the same on every screenshot. Up to 3% of
 * a row may differ, so a status bar whose clock changed still counts. Each band is at most 30%.
 */
export function fixedBands(imgs: Gray[]): { top: number; bottom: number } {
  if (imgs.length < 2) return { top: 0, bottom: 0 }
  const h = Math.min(...imgs.map((g) => g.h))
  const same = (row: (g: Gray) => number) => imgs.every((g, i) => i === 0 || rowDiff(imgs[0], row(imgs[0]), g, row(g), 2) <= 0.03)
  let top = 0
  while (top < h * 0.3 && same(() => top)) top++
  let bottom = 0
  while (bottom < h * 0.3 && same((g) => g.h - 1 - bottom)) bottom++
  // A screen that never changed at all isn't a scroll; keep everything.
  if (top + bottom >= h) return { top: 0, bottom: 0 }
  return { top, bottom }
}

/** Mean absolute difference between the last L rows of a's range and the first L rows of b's range. */
function overlapScore(a: Gray, aEnd: number, b: Gray, bStart: number, L: number, rowStep: number, colStep: number): number {
  let sum = 0
  let n = 0
  for (let k = 0; k < L; k += rowStep) {
    const ra = (aEnd - L + k) * a.w
    const rb = (bStart + k) * b.w
    for (let x = 0; x < a.w; x += colStep, n++) sum += Math.abs(a.data[ra + x] - b.data[rb + x])
  }
  return n ? sum / n : Infinity
}

/** Whether a range of rows has any detail (a blank band matches anything). */
function hasDetail(g: Gray, y0: number, y1: number): boolean {
  let min = 255
  let max = 0
  for (let y = y0; y < y1; y += 2)
    for (let x = 0; x < g.w; x += 3) {
      const v = g.data[y * g.w + x]
      if (v < min) min = v
      if (v > max) max = v
    }
  return max - min > 30
}

/**
 * How many rows at the top of b's body repeat the bottom of a's body. a's body is rows
 * [aStart, aEnd), b's body rows [bStart, bEnd). Returns 0 when nothing lines up.
 * Larger overlaps win ties, which is what a normal scroll produces.
 */
export function findOverlap(a: Gray, aStart: number, aEnd: number, b: Gray, bStart: number, bEnd: number): number {
  const maxL = Math.min(aEnd - aStart, bEnd - bStart) - 1
  const minL = Math.max(4, Math.round(maxL * 0.04))
  let best = 0
  let bestScore = Infinity
  for (let L = maxL; L >= minL; L--) {
    const s = overlapScore(a, aEnd, b, bStart, L, 2, 2)
    if (s < bestScore - 0.05) (bestScore = s), (best = L)
  }
  if (bestScore > 6 || !best) return 0
  // Ignore a "match" made only of blank space.
  if (!hasDetail(b, bStart, bStart + best)) return 0
  return best
}

/** Refines an overlap found at low resolution: searches ±radius rows around `guess` at full resolution. */
export function refineOverlap(a: Gray, aEnd: number, b: Gray, bStart: number, bEnd: number, guess: number, radius: number): number {
  const maxL = Math.min(aEnd, bEnd - bStart)
  let best = guess
  let bestScore = Infinity
  for (let L = Math.max(1, guess - radius); L <= Math.min(maxL, guess + radius); L++) {
    const s = overlapScore(a, aEnd, b, bStart, L, 3, Math.max(1, Math.floor(a.w / 300)))
    if (s < bestScore) (bestScore = s), (best = L)
  }
  return best
}

/** Which rows of each screenshot go into the long image, top to bottom. */
export interface Plan {
  /** Fixed bars, in full-resolution rows. */
  top: number
  bottom: number
  /** For each screenshot after the first, rows at the top of its body that repeat the previous one. */
  overlaps: number[]
}

/** Row ranges [y0, y1) taken from each screenshot for a plan. */
export function slices(heights: number[], plan: Plan): [number, number][] {
  const n = heights.length
  return heights.map((h, i): [number, number] => {
    const y0 = i === 0 ? 0 : plan.top + plan.overlaps[i - 1]
    const y1 = i === n - 1 ? h : h - plan.bottom
    return [Math.min(y0, y1), y1]
  })
}

/**
 * Works out a plan. `small` are the screenshots scaled down to the same narrow width (for speed),
 * `full` the same at full resolution and width; `k` is full height ÷ small height.
 */
export function makePlan(small: Gray[], full: Gray[], k: number): Plan {
  // Bars are measured at full resolution (the check stops at the first changing row, so it's cheap);
  // rounding them from the small copies would let a row of the tab bar into the overlap search.
  const { top, bottom } = fixedBands(full)
  const sTop = Math.ceil(top / k)
  const sBottom = Math.ceil(bottom / k)
  const overlaps: number[] = []
  for (let i = 1; i < small.length; i++) {
    const a = small[i - 1]
    const b = small[i]
    const L = findOverlap(a, sTop, a.h - sBottom, b, sTop, b.h - sBottom)
    if (!L) {
      overlaps.push(0)
      continue
    }
    const A = full[i - 1]
    const B = full[i]
    overlaps.push(refineOverlap(A, A.h - bottom, B, top, B.h - bottom, Math.round(L * k), Math.ceil(k * 2) + 2))
  }
  return { top, bottom, overlaps }
}
