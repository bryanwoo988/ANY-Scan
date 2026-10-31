// Long screenshots: joins screenshots taken while scrolling into one tall image.
//
// For each pair of screenshots it finds the longest stretch of rows that shows the same content in
// both (the overlap), then cuts in the middle of that stretch. Anything near the edges of a
// screenshot — status bar, app header, a see-through input bar, a floating "scroll down" button —
// never lies in the middle of the overlap, so it is left out without having to be recognised.

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

/** Fraction of pixels in row `ya` of a and row `yb` of b that differ by more than `tol`. */
function rowDiff(a: Gray, ya: number, b: Gray, yb: number, step = 1, tol = 24): number {
  let n = 0
  let d = 0
  const ra = ya * a.w
  const rb = yb * b.w
  for (let x = 0; x < a.w; x += step, n++) if (Math.abs(a.data[ra + x] - b.data[rb + x]) > tol) d++
  return d / n
}

/** Whether a row has visible detail (text, edges); blank rows match anything. */
function rowDetail(g: Gray, y: number): boolean {
  let min = 255
  let max = 0
  for (let x = 0, r = y * g.w; x < g.w; x++) {
    const v = g.data[r + x]
    if (v < min) min = v
    if (v > max) max = v
  }
  return max - min > 30
}

/**
 * Height of the bands at the top and bottom that look the same on every screenshot (up to 3% of a
 * row may differ, e.g. the clock). Used only when two screenshots don't overlap at all.
 */
export function fixedBands(imgs: Gray[]): { top: number; bottom: number } {
  if (imgs.length < 2) return { top: 0, bottom: 0 }
  const h = Math.min(...imgs.map((g) => g.h))
  const same = (row: (g: Gray) => number) => imgs.every((g, i) => i === 0 || rowDiff(imgs[0], row(imgs[0]), g, row(g), 2) <= 0.03)
  let top = 0
  while (top < h * 0.3 && same(() => top)) top++
  let bottom = 0
  while (bottom < h * 0.3 && same((g) => g.h - 1 - bottom)) bottom++
  if (top + bottom >= h) return { top: 0, bottom: 0 }
  return { top, bottom }
}

/** The overlap between two screenshots: B's row j shows what A shows at row j + offset. */
export interface Overlap {
  offset: number
  /** The shared stretch, in B's rows [b0, b1); it starts and ends on rows that match exactly. */
  b0: number
  b1: number
  /** Where to cut (a B row); see chooseCut. */
  cut: number
  /** Text rows that match exactly (how convincing the match is). */
  detail: number
}

/** Mean absolute difference between row `ya` of a and row `yb` of b. */
function rowMad(a: Gray, ya: number, b: Gray, yb: number, step = 1): number {
  let n = 0
  let sum = 0
  const ra = ya * a.w
  const rb = yb * b.w
  for (let x = 0; x < a.w; x += step, n++) sum += Math.abs(a.data[ra + x] - b.data[rb + x])
  return sum / n
}

/** How well a row of a matches a row of b: 0 exactly, 1 roughly (part covered, e.g. by a button), 2 not. */
type Compare = (a: Gray, ya: number, b: Gray, yb: number) => 0 | 1 | 2

/**
 * At full resolution a scroll moves content by whole pixels, so rows match exactly: at most 2% of a
 * row may differ (exact), or 20% clearly (roughly: a floating button over part of it).
 */
const exactRows: Compare = (a, ya, b, yb) => {
  // "Exact" uses a fine threshold so a faint overlay (a white button on a light page) isn't missed.
  if (rowDiff(a, ya, b, yb, 2, 12) <= 0.02) return 0
  return rowDiff(a, ya, b, yb, 2) <= 0.2 ? 1 : 2
}

/** How rows are judged at full resolution: whether they match, and whether a row is free of any overlay. */
export interface Matcher {
  exact: Compare
  clean: (a: Gray, ya: number, b: Gray, yb: number) => boolean
}

/** Screenshots are lossless: identical content is identical pixels. */
const SCREENSHOTS: Matcher = {
  exact: exactRows,
  clean: (a, ya, b, yb) => rowDiff(a, ya, b, yb, 1, 10) <= 0.005,
}

/**
 * Frames of a screen recording are compressed, and the same content is compressed differently in
 * each frame, so differences of up to ~30 grey levels are noise. Overlays still differ far more.
 */
export const VIDEO: Matcher = {
  exact: (a, ya, b, yb) => (rowDiff(a, ya, b, yb, 2, 32) <= 0.03 ? 0 : rowDiff(a, ya, b, yb, 2, 44) <= 0.25 ? 1 : 2),
  clean: (a, ya, b, yb) => rowDiff(a, ya, b, yb, 1, 32) <= 0.01,
}

/**
 * Scaled-down copies shift by fractions of a row, which blurs text edges, so they are compared by
 * average difference instead.
 */
const scaledRows: Compare = (a, ya, b, yb) => {
  const m = rowMad(a, ya, b, yb)
  return m <= 7 ? 0 : m <= 16 ? 1 : 2
}

/**
 * The stretch of content that a (above) and b (scrolled further down) share when b's row j shows
 * a's row j + offset. It may bridge a few rough rows (a floating button) and an odd mismatching
 * row, but not a whole bar. It is
 * scored by text rows that match exactly; at least a quarter of its text rows must (the rest may be
 * under a button), so repetitive content can't line up by coincidence.
 */
function stretchAt(a: Gray, b: Gray, offset: number, bDetail: boolean[], cmp: Compare): Overlap | null {
  const bridge = Math.max(3, Math.round(b.h * 0.08))
  const n = Math.min(b.h, a.h - offset)
  let best: Overlap | null = null
  let start = -1
  let last = -1
  let exact = 0
  let textRows = 0
  let pendingText = 0
  let rough = 0
  let bad = 0
  const close = () => {
    if (start >= 0 && exact >= textRows * 0.25 && (!best || exact > best.detail || (exact === best.detail && last + 1 - start > best.b1 - best.b0)))
      best = { offset, b0: start, b1: last + 1, cut: Math.floor((start + last + 1) / 2), detail: exact }
    start = -1
    exact = textRows = pendingText = rough = bad = 0
  }
  for (let j = 0; j < n; j++) {
    const c = cmp(a, j + offset, b, j)
    if (c === 0) {
      if (start < 0) start = j
      last = j
      rough = bad = 0
      if (bDetail[j]) exact++, textRows++
      textRows += pendingText
      pendingText = 0
      continue
    }
    if (start < 0) continue
    // Bridge rough rows (a button) and the odd mismatching row (resampling blur on a small copy).
    if (++rough <= bridge && (c === 1 || ++bad <= 2)) {
      if (bDetail[j]) pendingText++
      continue
    }
    close()
  }
  close()
  return best
}

/**
 * A real overlap has text in it, and lies where a scroll puts it: it starts right under b's header
 * (by `maxB0`) and reaches towards the bottom of a. A match elsewhere is a coincidence (the same
 * message twice, repeated rows of a table).
 */
/**
 * A real overlap has text in it and lies where a scroll puts it: it starts just under b's header
 * (b0 within `window`, in b's rows) and reaches towards the bottom of a. A match elsewhere is a
 * coincidence (the same message twice, repeated rows of a table).
 */
const isReal = (o: Overlap | null, a: Gray, minRows: number, window: [number, number]): o is Overlap =>
  // Starting a little higher is fine as long as it runs on past the window (a see-through header
  // can match the content behind it); starting lower than the window isn't.
  !!o && o.detail >= 5 && o.b1 - o.b0 >= minRows && o.b0 <= window[1] && (o.b0 >= window[0] || o.b1 >= window[0] + minRows) && o.b1 + o.offset >= a.h * 0.5

/**
 * Finds where b continues a (b scrolled further down): the offset with the most shared text.
 * A quick, sparse comparison of every offset picks the likeliest few for the full matching; if
 * none of those holds up, every offset is tried.
 */
export function findOverlap(a: Gray, b: Gray, cmp: Compare = exactRows, window: [number, number] = [0, b.h * 0.4]): Overlap | null {
  const bDetail = Array.from({ length: b.h }, (_, y) => rowDetail(b, y))
  const bestOf = (offsets: Iterable<number>) => {
    let best: Overlap | null = null
    for (const offset of offsets) {
      const o = stretchAt(a, b, offset, bDetail, cmp)
      if (o && isReal(o, a, 10, window) && (!best || o.detail > best.detail || (o.detail === best.detail && o.b1 - o.b0 > best.b1 - best.b0))) best = o
    }
    return best
  }
  const quick: { offset: number; d: number }[] = []
  const y0 = Math.round(Math.max(0, window[0]))
  for (let offset = 1; offset < a.h - 4; offset++) {
    let sum = 0
    let n = 0
    for (let j = y0; j < Math.min(b.h, a.h - offset); j += 3) {
      const ra = (j + offset) * a.w
      const rb = j * b.w
      for (let x = 0; x < a.w; x += 4, n++) sum += Math.abs(a.data[ra + x] - b.data[rb + x])
    }
    // Enough rows compared to mean something.
    if (n >= ((b.h * 0.1) / 3) * (a.w / 4)) quick.push({ offset, d: sum / n })
  }
  quick.sort((p, q) => p.d - q.d)
  const near = new Set<number>()
  for (const q of quick.slice(0, 6)) for (let o = q.offset - 1; o <= q.offset + 1; o++) if (o >= 1 && o < a.h - 4) near.add(o)
  return bestOf(near) ?? bestOf(Array.from({ length: Math.max(0, a.h - 5) }, (_, i) => i + 1))
}

/** Rows j of the shared stretch (b's rows) where a and b differ. */
function differences(a: Gray, b: Gray, o: Overlap, m: Matcher): number[] {
  const out: number[] = []
  for (let j = o.b0; j < o.b1; j++) if (m.exact(a, j + o.offset, b, j) !== 0) out.push(j)
  return out
}

/**
 * Where to cut inside the shared stretch. Rows above the cut come from a, rows below from b, so
 * every row where the two differ must be taken from the one that isn't covered there: b's header
 * (a see-through one, or its bottom line) lies near b's top, a's input bar or floating button near
 * a's bottom. `aCovered` says which it is, if known; otherwise the nearer edge decides. The cut
 * goes in the middle of the longest clean run between b's covers and a's.
 */
function chooseCut(a: Gray, b: Gray, o: Overlap, m: Matcher, aCovered?: (j: number) => boolean | undefined): number {
  let lastB = o.b0 - 1
  let firstA = o.b1
  const clean: boolean[] = []
  for (let j = o.b0; j < o.b1; j++) {
    const ok = m.exact(a, j + o.offset, b, j) === 0
    clean.push(ok)
    if (ok) continue
    if (aCovered?.(j) ?? a.h - (j + o.offset) < j) firstA = Math.min(firstA, j)
    else lastB = Math.max(lastB, j)
  }
  if (lastB >= firstA) return Math.floor((o.b0 + o.b1) / 2)
  let best: [number, number] = [lastB + 1, lastB + 1]
  for (let j = lastB + 1, run = -1; j <= firstA; j++) {
    if (j < firstA && clean[j - o.b0]) {
      if (run < 0) run = j
      continue
    }
    if (run >= 0 && j - run > best[1] - best[0]) best = [run, j]
    run = -1
  }
  return best[1] > best[0] ? Math.floor((best[0] + best[1]) / 2) : Math.floor((lastB + 1 + firstA) / 2)
}

/** Mean difference between b's rows [b0, b1) and a's rows at `offset` (sampled). */
function overlapMad(a: Gray, b: Gray, offset: number, b0: number, b1: number): number {
  let sum = 0
  let n = 0
  const step = Math.max(1, Math.floor(a.w / 300))
  for (let j = b0; j < b1; j += 2) {
    const ra = (j + offset) * a.w
    const rb = j * b.w
    for (let x = 0; x < a.w; x += step, n++) sum += Math.abs(a.data[ra + x] - b.data[rb + x])
  }
  return n ? sum / n : Infinity
}

/**
 * Searches offsets within ±radius of `guess` at full resolution and returns the best overlap.
 * With a forgiving matcher (video) neighbouring offsets can match about as many rows, so among the
 * offsets that match nearly the most, the one whose pixels differ least wins.
 */
export function refineOverlap(a: Gray, b: Gray, guess: number, radius: number, window: [number, number] = [0, b.h * 0.4], m: Matcher = SCREENSHOTS): Overlap | null {
  const bDetail = Array.from({ length: b.h }, (_, y) => rowDetail(b, y))
  const lo = Math.max(1, guess - radius)
  const hi = Math.min(a.h - 5, guess + radius)
  // A quick, sparse comparison of every offset in range first; the full row-by-row matching then
  // only runs around the three most alike (a fraction of the work, on a phone that matters).
  const quick: { offset: number; d: number }[] = []
  const y0 = Math.round(Math.max(window[0], 0))
  for (let offset = lo; offset <= hi; offset++) {
    let sum = 0
    let n = 0
    const end = Math.min(b.h, a.h - offset)
    for (let j = y0; j < end; j += 6) {
      const ra = (j + offset) * a.w
      const rb = j * b.w
      for (let x = 0; x < a.w; x += 8, n++) sum += Math.abs(a.data[ra + x] - b.data[rb + x])
    }
    if (n) quick.push({ offset, d: sum / n })
  }
  quick.sort((p, q) => p.d - q.d)
  const tryOffsets = new Set<number>()
  for (const q of quick.slice(0, 3)) for (let o = q.offset - 2; o <= q.offset + 2; o++) if (o >= lo && o <= hi) tryOffsets.add(o)
  const cands: Overlap[] = []
  for (const offset of tryOffsets) {
    const o = stretchAt(a, b, offset, bDetail, m.exact)
    if (o && isReal(o, a, 10, window)) cands.push(o)
  }
  if (!cands.length) return null
  const most = Math.max(...cands.map((o) => o.detail))
  let best: Overlap | null = null
  let bestMad = Infinity
  for (const o of cands) {
    if (o.detail < most * 0.8) continue
    const d = overlapMad(a, b, o.offset, o.b0, o.b1)
    if (d < bestMad) (bestMad = d), (best = o)
  }
  return best && { ...best, cut: chooseCut(a, b, best, m) }
}

/**
 * Walking down from B row `from`, the first row where A is covered: `upTo` 0 stops at anything
 * (a floating button), 1 only at a row that doesn't match at all (an input bar across the width).
 */
function coveredFrom(a: Gray, b: Gray, offset: number, from: number, upTo: 0 | 1, m: Matcher): number {
  let j = from
  let miss = 0
  let lastGood = from
  while (j < b.h && j + offset < a.h) {
    // Clean rows match almost perfectly, so even a faint white button on a light background shows
    // up here; a bar across the width doesn't match even roughly.
    const ok = upTo === 0 ? m.clean(a, j + offset, b, j) : m.exact(a, j + offset, b, j) <= 1
    if (ok) (lastGood = j), (miss = 0)
    else if (++miss > 1) break
    j++
  }
  return lastGood + 1
}

const median = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1]

/** Where one screenshot ends and the next begins, in full-resolution rows. */
export interface Join {
  /** Rows of the upper screenshot are used up to here… */
  aEnd: number
  /** …and the lower one continues from here. */
  bStart: number
  /** Whether content overlap was found (otherwise the bars were trimmed and the two butted together). */
  matched: boolean
}

export interface Plan {
  joins: Join[]
  /** Rows trimmed off the top of the first screenshot and the bottom of the last. */
  top: number
  bottom: number
}

/** Row ranges [y0, y1) taken from each screenshot. */
export function slices(heights: number[], plan: Plan): [number, number][] {
  const n = heights.length
  return heights.map((h, i): [number, number] => {
    const y0 = i === 0 ? plan.top : plan.joins[i - 1].bStart
    const y1 = i === n - 1 ? h - plan.bottom : plan.joins[i].aEnd
    return [Math.max(0, Math.min(y0, y1)), Math.max(0, y1)]
  })
}

/**
 * Works out how to join the screenshots. `small` are copies scaled down to a narrow width (for
 * speed), `full` the originals; `k` is full height ÷ small height. The suggested bottom trim
 * removes whatever covers the content at the bottom (an input bar, a "scroll down" button),
 * measured on the joins; the top is kept.
 */
export function makePlan(small: Gray[], full: Gray[], k: number, m: Matcher = SCREENSHOTS): Plan {
  const bands = fixedBands(full)
  const h = full[0]?.h ?? 0
  const search = (n: number, window: [number, number]) => {
    // Roughly where the overlap is, on the small copies; then exactly, at full resolution.
    const rough = findOverlap(small[n], small[n + 1], k === 1 ? exactRows : scaledRows, [window[0] / k, window[1] / k])
    return rough && refineOverlap(full[n], full[n + 1], Math.round(rough.offset * k), Math.ceil(k * 4) + 4, window, m)
  }
  // First pass: the shared stretch may start anywhere under the bars that never change.
  // (A little above them too: the rows just under a header can match as well, and in video the
  // edge of the bars is blurred by compression.)
  let found = small.slice(1).map((_, n) => search(n, [Math.max(0, bands.top - h * 0.15), bands.top + h * 0.4]))
  // In a real set every join's stretch starts at the same height, just under the header (solid or
  // see-through alike). Where most joins agree, search again for the ones that don't: those were
  // coincidences (a repeated message) or missed.
  const starts = found.filter((o): o is Overlap => !!o).map((o) => o.b0)
  if (starts.length >= 2) {
    const usual = median(starts)
    // Video frames are noisier, so where a stretch starts is less exact.
    const slack = h * (m === SCREENSHOTS ? 0.03 : 0.08)
    const near = (o: Overlap | null) => !!o && Math.abs(o.b0 - usual) <= slack
    if (starts.filter((b0) => Math.abs(b0 - usual) <= slack).length >= 2)
      found = found.map((o, n) => (near(o) ? o : search(n, [usual - slack, usual + slack])))
  }
  // Overlays stay put on the screen: a button over the upper screenshot shows up as a difference at
  // the same screen rows in every join, while the lower one's content there changes from join to
  // join (and the other way round for a see-through header). Vote across joins to tell them apart.
  const bin = (y: number) => y >> 2
  const votesA = new Map<number, number>()
  const votesB = new Map<number, number>()
  const diffs = found.map((o, n) => (o ? differences(full[n], full[n + 1], o, m) : []))
  found.forEach((o, n) => {
    if (!o) return
    for (const j of diffs[n]) {
      votesA.set(bin(j + o.offset), (votesA.get(bin(j + o.offset)) ?? 0) + 1)
      votesB.set(bin(j), (votesB.get(bin(j)) ?? 0) + 1)
    }
  })
  found = found.map((o, n) => {
    if (!o) return o
    const aCovered = (j: number) => {
      const va = votesA.get(bin(j + o.offset)) ?? 0
      const vb = votesB.get(bin(j)) ?? 0
      return va === vb ? undefined : va > vb
    }
    return { ...o, cut: chooseCut(full[n], full[n + 1], o, m, aCovered) }
  })
  // What covers the screenshots, learned from the joins that matched: the header (where the shared
  // stretch starts in the lower one), anything over the bottom (a button), and the bar itself.
  const headers: number[] = []
  const covers: number[] = []
  const bars: number[] = []
  found.forEach((ov, n) => {
    if (!ov) return
    const A = full[n]
    const B = full[n + 1]
    headers.push(ov.b0)
    covers.push(A.h - (coveredFrom(A, B, ov.offset, ov.cut, 0, m) + ov.offset))
    bars.push(A.h - (coveredFrom(A, B, ov.offset, ov.cut, 1, m) + ov.offset))
  })
  const top = headers.length ? median(headers) : bands.top
  const bar = bars.length ? median(bars) : bands.bottom
  const joins: Join[] = found.map((ov, n) =>
    ov
      ? // Cut in the clean run at the top of the shared stretch: both screenshots show the same thing there.
        { aEnd: ov.cut + ov.offset, bStart: ov.cut, matched: true }
      : // No overlap: butt the two together without the bar and the header; nothing else shows that content.
        { aEnd: full[n].h - bar, bStart: top, matched: false },
  )
  // The suggested bottom trim removes everything covering the last screenshot's bottom. A light
  // button is invisible over a light part of the page, so each join may see less of it: take the most.
  // A little extra catches soft shadows too faint to measure.
  const lastH = full[full.length - 1]?.h ?? 0
  // Take the largest cover that another join agrees with (within 3%), so one noisy measurement
  // (video compression) can't trim away content; with fewer than three joins, simply the largest.
  const agreed = covers.filter((c) => covers.filter((d) => Math.abs(d - c) <= lastH * 0.03).length >= 2)
  const cover = !covers.length ? 0 : covers.length < 3 ? Math.max(...covers) : agreed.length ? Math.max(...agreed) : median(covers)
  const bottom = covers.length ? cover + (cover > 0 ? Math.round(lastH * 0.01) : 0) : bands.bottom
  return { joins, top: 0, bottom: Math.max(0, Math.min(bottom, Math.round(lastH * 0.35))) }
}
