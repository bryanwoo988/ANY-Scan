import { describe, expect, it } from 'vitest'
import { detectQuadRGBA, orderQuad, polygonArea } from '../src/lib/detect'

/** Renders a filled convex quad (point-in-polygon) onto a background, with deterministic noise. */
function scene(w: number, h: number, bg: number[], fg: number[], quad: [number, number][]) {
  const d = new Uint8ClampedArray(w * h * 4)
  let seed = 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 10
  const inside = (x: number, y: number) =>
    quad.every((a, i) => {
      const b = quad[(i + 1) % 4]
      return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0
    })
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = inside(x + 0.5, y + 0.5) ? fg : bg
      const n = rnd()
      d.set([c[0] + n, c[1] + n, c[2] + n, 255], (y * w + x) * 4)
    }
  return d
}

const maxErr = (q: { x: number; y: number }[], truth: [number, number][]) => {
  let best = Infinity
  for (let r = 0; r < 4; r++) best = Math.min(best, Math.max(...q.map((p, i) => Math.hypot(p.x - truth[(i + r) % 4][0], p.y - truth[(i + r) % 4][1]))))
  return best
}

describe('detectQuadRGBA', () => {
  it('finds white paper on a dark table under perspective', () => {
    const truth: [number, number][] = [[60, 50], [230, 40], [250, 320], [40, 330]]
    const q = detectQuadRGBA(scene(280, 360, [70, 50, 35], [240, 238, 230], truth), 280, 360)!
    expect(q).not.toBeNull()
    expect(maxErr(q, truth)).toBeLessThan(5)
  })

  it('finds a coloured card on a white desk (not brighter than the background)', () => {
    const truth: [number, number][] = [[120, 60], [270, 140], [200, 260], [50, 180]]
    const q = detectQuadRGBA(scene(320, 320, [236, 235, 232], [90, 140, 210], truth), 320, 320)!
    expect(q).not.toBeNull()
    expect(maxErr(q, truth)).toBeLessThan(5)
  })

  it('returns null when there is no document', () => {
    expect(detectQuadRGBA(scene(200, 260, [128, 128, 128], [128, 128, 128], [[0, 0], [1, 0], [1, 1], [0, 1]]), 200, 260)).toBeNull()
  })
})

describe('orderQuad', () => {
  it('orders corners clockwise from top-left', () => {
    const q = orderQuad([{ x: 10, y: 90 }, { x: 90, y: 10 }, { x: 10, y: 10 }, { x: 90, y: 90 }])
    expect(q).toEqual([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }])
    expect(polygonArea(q)).toBe(6400)
  })
})

describe('detectQuadRGBA under vignette (page split by shading)', () => {
  it('still finds the whole page, not a band of it', () => {
    const w = 270
    const h = 360
    const truth: [number, number][] = [[40, 45], [230, 50], [236, 316], [36, 311]]
    const d = scene(w, h, [222, 220, 216], [245, 244, 241], truth)
    // Darken towards the corners like a phone camera vignette.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2))
        const k = 1 - 0.45 * Math.max(0, r - 0.35)
        const i = (y * w + x) * 4
        for (let c = 0; c < 3; c++) d[i + c] *= k
      }
    const q = detectQuadRGBA(d, w, h)!
    expect(q).not.toBeNull()
    expect(maxErr(q, truth)).toBeLessThan(8)
  })
})
