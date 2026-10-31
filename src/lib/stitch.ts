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
  !!o && o.detail >= 5 && o.b1 - o.b0 >= minRows && o.b0 >= window[0] && o.b0 <= window[1] && o.b1 + o.offset >= a.h * 0.5

/** Finds where b continues a (b scrolled further down): the offset with the most shared text. */
export function findOverlap(a: Gray, b: Gray, cmp: Compare = exactRows, window: [number, number] = [0, b.h * 0.4]): Overlap | null {
  const bDetail = Array.from({ length: b.h }, (_, y) => rowDetail(b, y))
  let best: Overlap | null = null
  for (let offset = 1; offset < a.h - 4; offset++) {
    const o = stretchAt(a, b, offset, bDetail, cmp)
    if (o && isReal(o, a, 10, window) && (!best || o.detail > best.detail || (o.detail === best.detail && o.b1 - o.b0 > best.b1 - best.b0))) best = o
  }
  return best
}

/** Rows j of the shared stretch (b's rows) where a and b differ. */
function differences(a: Gray, b: Gray, o: Overlap): number[] {
  const out: number[] = []
  for (let j = o.b0; j < o.b1; j++) if (exactRows(a, j + o.offset, b, j) !== 0) out.push(j)
  return out
}

/**
 * Where to cut inside the shared stretch. Rows above the cut come from a, rows below from b, so
 * every row where the two differ must be taken from the one that isn't covered there: b's header
 * (a see-through one, or its bottom line) lies near b's top, a's input bar or floating button near
 * a's bottom. `aCovered` says which it is, if known; otherwise the nearer edge decides. The cut
 * goes in the middle of the longest clean run between b's covers and a's.
 */
function chooseCut(a: Gray, b: Gray, o: Overlap, aCovered?: (j: number) => boolean | undefined): number {
  let lastB = o.b0 - 1
  let firstA = o.b1
  const clean: boolean[] = []
  for (let j = o.b0; j < o.b1; j++) {
    const ok = exactRows(a, j + o.offset, b, j) === 0
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

/** Searches offsets within ±radius of `guess` at full resolution and returns the best exact overlap. */
export function refineOverlap(a: Gray, b: Gray, guess: number, radius: number, window: [number, number] = [0, b.h * 0.4]): Overlap | null {
  const bDetail = Array.from({ length: b.h }, (_, y) => rowDetail(b, y))
  let best: Overlap | null = null
  for (let offset = Math.max(1, guess - radius); offset <= Math.min(a.h - 5, guess + radius); offset++) {
    const o = stretchAt(a, b, offset, bDetail, exactRows)
    if (o && isReal(o, a, 10, window) && (!best || o.detail > best.detail)) best = o
  }
  return best && { ...best, cut: chooseCut(a, b, best) }
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
  const h = full[0]?.h ?? 0
  const search = (n: number, window: [number, number]) => {
    // Roughly where the overlap is, on the small copies; then exactly, at full resolution.
    const rough = findOverlap(small[n], small[n + 1], k === 1 ? exactRows : scaledRows, [window[0] / k, window[1] / k])
    return rough && refineOverlap(full[n], full[n + 1], Math.round(rough.offset * k), Math.ceil(k) + 2, window)
  }
  // First pass: the shared stretch may start anywhere under the bars that never change.
  let found = small.slice(1).map((_, n) => search(n, [bands.top, bands.top + h * 0.4]))
  // In a real set every join's stretch starts at the same height, just under the header (solid or
  // see-through alike). Where most joins agree, search again for the ones that don't: those were
  // coincidences (a repeated message) or missed.
  const starts = found.filter((o): o is Overlap => !!o).map((o) => o.b0)
  if (starts.length >= 2) {
    const usual = median(starts)
    const near = (o: Overlap | null) => !!o && Math.abs(o.b0 - usual) <= h * 0.03
    if (starts.filter((b0) => Math.abs(b0 - usual) <= h * 0.03).length >= 2)
      found = found.map((o, n) => (near(o) ? o : search(n, [usual - h * 0.03, usual + h * 0.03])))
  }
  // Overlays stay put on the screen: a button over the upper screenshot shows up as a difference at
  // the same screen rows in every join, while the lower one's content there changes from join to
  // join (and the other way round for a see-through header). Vote across joins to tell them apart.
  const bin = (y: number) => y >> 2
  const votesA = new Map<number, number>()
  const votesB = new Map<number, number>()
  const diffs = found.map((o, n) => (o ? differences(full[n], full[n + 1], o) : []))
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
    return { ...o, cut: chooseCut(full[n], full[n + 1], o, aCovered) }
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
