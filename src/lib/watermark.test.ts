import { describe, expect, it } from 'vitest'
import { contentRegions, cornerCentre, rotatedBox } from './watermark'

/** White w×h page with filled rectangles of colour `rgb`. */
function page(w: number, h: number, rects: { x: number; y: number; w: number; h: number; rgb?: number[] }[]) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255)
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * w + x) * 4
        ;[d[i], d[i + 1], d[i + 2]] = r.rgb ?? [235, 205, 195]
      }
  return d
}

describe('contentRegions', () => {
  it('finds a pale ID card in the middle of an A4 page', () => {
    const r = contentRegions(page(226, 320, [{ x: 70, y: 120, w: 86, h: 54 }]), 226, 320)
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({ x: 70, y: 120, w: 86, h: 54 })
  })
  it('finds front and back of a card as two regions', () => {
    const r = contentRegions(page(226, 320, [{ x: 70, y: 60, w: 86, h: 54 }, { x: 70, y: 190, w: 86, h: 54, rgb: [200, 220, 240] }]), 226, 320)
    expect(r.map((x) => x.y)).toEqual([60, 190])
  })
  it('finds two photos side by side', () => {
    const r = contentRegions(page(226, 320, [{ x: 20, y: 100, w: 80, h: 60, rgb: [40, 40, 40] }, { x: 130, y: 110, w: 70, h: 90, rgb: [40, 40, 40] }]), 226, 320)
    expect(r).toHaveLength(2)
    expect(r[1]).toEqual({ x: 130, y: 110, w: 70, h: 90 })
  })
  it('treats an ordinary text page as a whole page (no regions)', () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({ x: 20, y: 20 + i * 9, w: 180 - (i % 4) * 20, h: 4, rgb: [30, 30, 30] }))
    expect(contentRegions(page(226, 320, lines), 226, 320)).toEqual([])
  })
  it('returns nothing for a blank page', () => {
    expect(contentRegions(page(100, 140, []), 100, 140)).toEqual([])
  })
})

describe('placement', () => {
  it('rotated box of a 100×20 block at 90° is 20×100', () => {
    const b = rotatedBox(100, 20, Math.PI / 2)
    expect(b.w).toBeCloseTo(20)
    expect(b.h).toBeCloseTo(100)
  })
  it('keeps a corner block inside the area', () => {
    const r = { x: 100, y: 50, w: 200, h: 100 }
    const c = cornerCentre(r, 60, 20, 'br')
    expect(c.x + 30).toBeLessThanOrEqual(r.x + r.w)
    expect(c.y + 10).toBeLessThanOrEqual(r.y + r.h)
    expect(cornerCentre(r, 60, 20, 'tl').x - 30).toBeGreaterThanOrEqual(r.x)
  })
})
