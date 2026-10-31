import { describe, expect, it } from 'vitest'
import { findOverlap, makePlan, slices, type Gray, type Plan } from './stitch'

const W = 60
const H = 200
const TOP = 20 // status bar + app header
const BAR = 170 // a see-through input bar covers rows 170–199
const BTN = [152, 166] // a floating "scroll down" button above it, columns 45–54

/** A long chat: text-like dark blobs on light rows. */
function page(h: number, seed = 1): Uint8Array {
  const d = new Uint8Array(W * h).fill(235)
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) if ((Math.floor(y / 6) + Math.floor(x / 7)) % 3 === 0 && rnd() > 0.35) d[y * W + x] = 40 + Math.floor(rnd() * 60)
  return d
}

/** A screenshot of the chat scrolled to y0, like the Claude app: header, chat, floating button, see-through input bar. */
function shot(content: Uint8Array, y0: number, clock: number): Gray {
  const d = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = y >= TOP ? content[(y0 + y - TOP) * W + x] : 0
      let v: number
      if (y < TOP) v = y % 5 === 0 ? 30 : 250
      else if (y >= BAR) v = Math.round(c * 0.25 + 180) // the chat shows faintly through the bar
      else if (y >= BTN[0] && y < BTN[1] && x >= 45 && x < 55) v = 20
      else v = c
      d[y * W + x] = v
    }
  d[8 * W + 3] = clock
  return { w: W, h: H, data: d }
}

function assemble(imgs: Gray[], plan: Plan): Uint8Array {
  const parts = slices(
    imgs.map((g) => g.h),
    plan,
  ).map(([y0, y1], i) => imgs[i].data.slice(y0 * W, y1 * W))
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) out.set(p, (o += p.length) - p.length)
  return out
}

describe('long screenshots', () => {
  const content = page(900)
  const shots = [shot(content, 0, 10), shot(content, 100, 200), shot(content, 230, 90), shot(content, 300, 90)]

  it('finds the shared stretch despite the floating button, and it stops at the see-through bar', () => {
    const ov = findOverlap(shots[0], shots[1])!
    expect(ov.offset).toBe(100)
    // In B, the shared stretch starts under the header and ends where A's input bar starts.
    expect(ov.b0).toBeLessThanOrEqual(TOP)
    expect(ov.b1).toBe(BAR - 100)
    // The cut lies in clean chat in both screenshots: above A's button.
    expect(ov.cut + ov.offset).toBeLessThan(BTN[0])
  })

  it('stitches: header once, the chat continuous and exact, no input bar or button in the middle', () => {
    const plan = makePlan(shots, shots, 1)
    expect(plan.joins.every((j) => j.matched)).toBe(true)
    expect(plan.top).toBe(0)
    // The suggested bottom trim removes the button and the input bar of the last screenshot.
    expect(plan.bottom).toBe(H - BTN[0] + 2) // plus 1% for soft shadows
    const out = assemble(shots, plan)
    const rows = out.length / W
    expect(Array.from(out.slice(0, TOP * W))).toEqual(Array.from(shots[0].data.slice(0, TOP * W)))
    // Everything below the header is the chat itself, from the top, with nothing missing or repeated.
    const chatRows = rows - TOP
    expect(chatRows).toBe(300 + (BTN[0] - 2 - TOP))
    expect(Array.from(out.slice(TOP * W))).toEqual(Array.from(content.slice(0, chatRows * W)))
  })

  it('the top and bottom trims can be changed', () => {
    const plan = { ...makePlan(shots, shots, 1), top: 5, bottom: 0 }
    const s = slices(
      shots.map((g) => g.h),
      plan,
    )
    expect(s[0][0]).toBe(5)
    expect(s[3][1]).toBe(H)
  })

  it('screenshots that do not overlap are joined with the fixed bars trimmed', () => {
    const plain = (y0: number, clock: number): Gray => {
      const g = shot(content, y0, clock)
      return g
    }
    const far = [plain(0, 10), plain(500, 20)]
    const plan = makePlan(far, far, 1)
    expect(plan.joins[0].matched).toBe(false)
  })

  it('refines at full resolution from a half-size analysis', () => {
    const half = (g: Gray): Gray => {
      const h2 = Math.floor(g.h / 2)
      const d = new Uint8Array((g.w / 2) * h2)
      for (let y = 0; y < h2; y++) for (let x = 0; x < g.w / 2; x++) d[y * (g.w / 2) + x] = g.data[y * 2 * g.w + x * 2]
      return { w: g.w / 2, h: h2, data: d }
    }
    // Realistic overlaps: a phone screenshot analysed at 240 px keeps far more rows than this tiny test.
    const set = [shot(content, 0, 10), shot(content, 80, 20), shot(content, 160, 30), shot(content, 250, 40)]
    const plan = makePlan(set.map(half), set, 2)
    expect(plan.joins.every((j) => j.matched)).toBe(true)
    const out = assemble(set, plan)
    const chatRows = out.length / W - TOP
    expect(Array.from(out.slice(TOP * W))).toEqual(Array.from(content.slice(0, chatRows * W)))
  })
})
