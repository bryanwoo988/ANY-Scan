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
  /**
   * Where to cut (a B row): the middle of the first run of exactly matching rows. Rows above the cut
   * come from A, so the cut must lie above anything covering A's lower part (a floating button);
   * the first mismatch inside the stretch is such a cover (B's header lies before the stretch).
   */
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
  // The run of exact rows the stretch starts with.
  let firstEnd = -1
  const close = () => {
    if (start >= 0 && exact >= textRows * 0.25 && (!best || exact > best.detail || (exact === best.detail && last + 1 - start > best.b1 - best.b0)))
      best = { offset, b0: start, b1: last + 1, cut: Math.floor((start + (firstEnd < 0 ? last + 1 : firstEnd)) / 2), detail: exact }
    start = -1
    exact = textRows = pendingText = rough = bad = 0
    firstEnd = -1
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
    if (firstEnd < 0) firstEnd = j
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
 * How far below the known header a real overlap may start. A solid header (found on every
 * screenshot) is followed directly by the shared content; a see-through one isn't found, only the
 * status bar is, so allow for the header below it.
 */
const headerSlack = (header: number, h: number) => (header >= h * 0.05 ? 0.04 : 0.15)

const isReal = (o: Overlap | null, a: Gray, minRows: number, maxB0: number): o is Overlap =>
  !!o && o.detail >= 5 && o.b1 - o.b0 >= minRows && o.b0 <= maxB0 && o.b1 + o.offset >= a.h * 0.5

/**
 * Finds where b continues a (b scrolled further down): the offset with the most shared text.
 * `header` is the height of the bar at the top that stays put, if known.
 */
export function findOverlap(a: Gray, b: Gray, cmp: Compare = exactRows, header = 0): Overlap | null {
  const maxB0 = header + b.h * headerSlack(header, b.h)
  const bDetail = Array.from({ length: b.h }, (_, y) => rowDetail(b, y))
  let best: Overlap | null = null
  for (let offset = 1; offset < a.h - 4; offset++) {
    const o = stretchAt(a, b, offset, bDetail, cmp)
    if (o && isReal(o, a, 10, maxB0) && (!best || o.detail > best.detail || (o.detail === best.detail && o.b1 - o.b0 > best.b1 - best.b0))) best = o
  }
  return best
}

/** Searches offsets within ±radius of `guess` at full resolution and returns the best exact overlap. */
export function refineOverlap(a: Gray, b: Gray, guess: number, radius: number, header = 0): Overlap | null {
  const maxB0 = header + b.h * headerSlack(header, b.h)
  const bDetail = Array.from({ length: b.h }, (_, y) => rowDetail(b, y))
  let best: Overlap | null = null
  for (let offset = Math.max(1, guess - radius); offset <= Math.min(a.h - 5, guess + radius); offset++) {
    const o = stretchAt(a, b, offset, bDetail, exactRows)
    if (o && isReal(o, a, 10, maxB0) && (!best || o.detail > best.detail)) best = o
  }
  return best
}

/**
 * Walking down from B row `from`, the first row where A is covered: `upTo` 0 stops at anything
 * (a floating button), 1 only at a row that doesn't match at all (an input bar across the width).
 */
function coveredFrom(a: Gray, b: Gray, offset: number, from: number, upTo: 0 | 1): number {
  let j = from
  let miss = 0
  let lastGood = from
  while (j < b.h && j + offset < a.h) {
    // Clean rows at full resolution match almost perfectly, so even a faint white button on a light
    // background shows up here; a bar across the width doesn't match even roughly.
    const ok = upTo === 0 ? rowDiff(a, j + offset, b, j, 1, 10) <= 0.005 : exactRows(a, j + offset, b, j) <= 1
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
export function makePlan(small: Gray[], full: Gray[], k: number): Plan {
  const bands = fixedBands(full)
  const found = small.slice(1).map((_, n) => {
    const A = full[n]
    const B = full[n + 1]
    // Roughly where the overlap is, on the small copies; then exactly, at full resolution.
    const rough = findOverlap(small[n], small[n + 1], k === 1 ? exactRows : scaledRows, bands.top / k)
    return rough && refineOverlap(A, B, Math.round(rough.offset * k), Math.ceil(k) + 2, bands.top)
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
    covers.push(A.h - (coveredFrom(A, B, ov.offset, ov.cut, 0) + ov.offset))
    bars.push(A.h - (coveredFrom(A, B, ov.offset, ov.cut, 1) + ov.offset))
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
  const bottom = covers.length ? Math.max(...covers) + (Math.max(...covers) > 0 ? Math.round(lastH * 0.01) : 0) : bands.bottom
  return { joins, top: 0, bottom: Math.max(0, Math.min(bottom, Math.round(lastH * 0.35))) }
}
