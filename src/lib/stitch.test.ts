import { describe, expect, it } from 'vitest'
import { findOverlap, fixedBands, makePlan, slices, type Gray } from './stitch'

const W = 60
/** A long page with text-like detail: dark blobs at pseudo-random places on light rows. */
function page(h: number, seed = 1): Uint8Array {
  const d = new Uint8Array(W * h).fill(235)
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) if ((Math.floor(y / 6) + Math.floor(x / 7)) % 3 === 0 && rnd() > 0.35) d[y * W + x] = 40 + Math.floor(rnd() * 60)
  return d
}

/** A screenshot of the page scrolled to y0: a status bar (clock differs per shot), the content, a tab bar. */
function shot(content: Uint8Array, y0: number, clock: number, H = 200, top = 20, bottom = 15): Gray {
  const d = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v: number
      if (y < top) v = y % 5 === 0 ? 30 : 250
      else if (y >= H - bottom) v = x % 10 < 5 ? 90 : 200
      else v = content[(y0 + y - top) * W + x]
      d[y * W + x] = v
    }
  // The clock: one small changing patch in the status bar.
  d[8 * W + 3] = clock
  return { w: W, h: H, data: d }
}

/** Assembles the stitched image from a plan. */
function assemble(imgs: Gray[], plan: ReturnType<typeof makePlan>): Uint8Array {
  const parts = slices(imgs.map((g) => g.h), plan).map(([y0, y1], i) => imgs[i].data.slice(y0 * W, y1 * W))
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) out.set(p, (o += p.length) - p.length)
  return out
}

describe('long screenshots', () => {
  const content = page(700)
  const shots = [shot(content, 0, 10), shot(content, 100, 200), shot(content, 230, 90)]

  it('finds the status bar and tab bar even though the clock changes', () => {
    expect(fixedBands(shots)).toEqual({ top: 20, bottom: 15 })
  })

  it('finds each overlap', () => {
    // Bodies are 165 rows; scrolling 100 then 130 rows leaves 65 and 35 rows of overlap.
    expect(findOverlap(shots[0], 20, 185, shots[1], 20, 185)).toBe(65)
    expect(findOverlap(shots[1], 20, 185, shots[2], 20, 185)).toBe(35)
  })

  it('rebuilds the page exactly: one status bar, the content once, one tab bar', () => {
    const plan = makePlan(shots, shots, 1)
    expect(plan).toEqual({ top: 20, bottom: 15, overlaps: [65, 35] })
    const out = assemble(shots, plan)
    const expected = new Uint8Array([...shots[0].data.slice(0, 20 * W), ...content.slice(0, (230 + 165) * W), ...shots[2].data.slice(185 * W)])
    expect(out.length).toBe(expected.length)
    expect(out).toEqual(expected)
  })

  it('screenshots that do not overlap are simply joined', () => {
    const far = [shot(content, 0, 10), shot(content, 400, 20)]
    expect(makePlan(far, far, 1).overlaps).toEqual([0])
  })

  it('refines at full resolution from a half-size analysis', () => {
    const half = (g: Gray): Gray => {
      const d = new Uint8Array((g.w / 2) * Math.floor(g.h / 2))
      for (let y = 0; y < Math.floor(g.h / 2); y++) for (let x = 0; x < g.w / 2; x++) d[y * (g.w / 2) + x] = g.data[y * 2 * g.w + x * 2]
      return { w: g.w / 2, h: Math.floor(g.h / 2), data: d }
    }
    const plan = makePlan(shots.map(half), shots, 2)
    expect(plan.overlaps).toEqual([65, 35])
  })
})
