import { describe, expect, it } from 'vitest'
import { applyHomography, filterPixels, quadOutputSize, rotateQuad, solveHomography, type Quad } from '../src/lib/image'

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6)

describe('homography', () => {
  it('maps the four corners exactly', () => {
    const from: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }]
    const to: Quad = [{ x: 12, y: 30 }, { x: 410, y: 8 }, { x: 440, y: 590 }, { x: 5, y: 610 }]
    const h = solveHomography(from, to)
    from.forEach((p, i) => {
      const q = applyHomography(h, p)
      close(q.x, to[i].x)
      close(q.y, to[i].y)
    })
  })

  it('is the identity for identical quads', () => {
    const q: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    const h = solveHomography(q, q)
    const p = applyHomography(h, { x: 3.5, y: 7 })
    close(p.x, 3.5)
    close(p.y, 7)
  })

  it('throws on a degenerate quad', () => {
    const z = { x: 1, y: 1 }
    expect(() => solveHomography([z, z, z, z], [z, z, z, z])).toThrow()
  })

  it('sizes output from the longest edges', () => {
    const q: Quad = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 180, y: 300 }, { x: 20, y: 300 }]
    expect(quadOutputSize(q, 10000)).toEqual({ w: 200, h: 301 })
  })
})

describe('rotateQuad', () => {
  const q: Quad = [{ x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 60 }, { x: 10, y: 60 }]
  it('rotates 90° clockwise and keeps corner order', () => {
    // 100x80 image becomes 80x100.
    expect(rotateQuad(q, 100, 80, 90)).toEqual([{ x: 20, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 90 }, { x: 20, y: 90 }])
  })
  it('four quarter turns are the identity', () => {
    let r = q
    let w = 100
    let h = 80
    for (let i = 0; i < 4; i++) {
      r = rotateQuad(r, w, h, 90)
      ;[w, h] = [h, w]
    }
    expect(r).toEqual(q)
  })
  it('-90 undoes 90', () => {
    expect(rotateQuad(rotateQuad(q, 100, 80, 90), 80, 100, -90)).toEqual(q)
  })
})

describe('filterPixels', () => {
  it('B&W turns dark text black and paper white under uneven light', () => {
    const w = 64
    const h = 64
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const paper = 120 + x * 2 // gradient lighting
        const ink = x > 30 && x < 34
        const v = ink ? paper - 90 : paper
        d.set([v, v, v, 255], (y * w + x) * 4)
      }
    filterPixels(d, w, h, 'bw')
    expect(d[(32 * w + 32) * 4]).toBe(0)
    expect(d[(32 * w + 5) * 4]).toBe(255)
    expect(d[(32 * w + 60) * 4]).toBe(255)
  })
  it('magic brightens shaded paper towards white', () => {
    const w = 80
    const h = 80
    const d = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) d.set([150, 140, 130, 255], i * 4)
    filterPixels(d, w, h, 'magic')
    expect(d[0]).toBeGreaterThan(245)
    expect(d[2]).toBeGreaterThan(245)
  })
})
