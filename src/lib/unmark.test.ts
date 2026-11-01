import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTO, inpaint, removeLightMarks, strokesMask } from './unmark'

const W = 400
const H = 300

/** A scanned page: slightly uneven paper, black text lines, a light grey diagonal watermark band. */
function page(mark: [number, number, number] = [200, 200, 200]) {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const paper = 235 - (x / W) * 25 // shade across the page
      let v: [number, number, number] = [paper, paper, paper * 0.97]
      const onMark = Math.abs(x - 1.3 * y - 20) < 14 && x > 60 && x < 340
      if (onMark) v = mark.map((m) => (m / 255) * paper) as [number, number, number]
      const text = y % 30 > 20 && y % 30 < 25 && x > 40 && x < 360 && (x >> 2) % 3 !== 0
      if (text) v = [25, 25, 25]
      d[i] = v[0]
      d[i + 1] = v[1]
      d[i + 2] = v[2]
      d[i + 3] = 255
    }
  return d
}
const px = (d: Uint8ClampedArray, x: number, y: number) => [d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]]
// (150, 100) is on the watermark band and not on a text line; (150, 112) is text over the band.

describe('auto watermark removal', () => {
  it('turns a light grey watermark and shaded paper white, keeps the text', () => {
    const d = page()
    expect(px(d, 150, 100)[0]).toBeLessThan(200)
    removeLightMarks(d, W, H, DEFAULT_AUTO)
    for (const v of px(d, 150, 100)) expect(v).toBeGreaterThanOrEqual(250) // watermark
    for (const v of px(d, 380, 10)) expect(v).toBeGreaterThanOrEqual(250) // shaded paper
    for (const v of px(d, 150, 112)) expect(v).toBeLessThan(50) // text over the watermark
    for (const v of px(d, 304, 22)) expect(v).toBeLessThan(50) // text elsewhere
  })

  it('a darker grey mark needs a higher strength', () => {
    const d = page([150, 150, 150])
    removeLightMarks(d, W, H, { strength: 0.1, color: false })
    expect(px(d, 150, 100)[0]).toBeLessThan(200)
    const e = page([150, 150, 150])
    removeLightMarks(e, W, H, { strength: 0.9, color: false })
    expect(px(e, 150, 100)[0]).toBeGreaterThanOrEqual(250)
    for (const v of px(e, 150, 112)) expect(v).toBeLessThan(50)
  })

  it('a strong red stamp is kept unless coloured marks are removed too; black text always stays', () => {
    const d = page([210, 30, 30])
    removeLightMarks(d, W, H, DEFAULT_AUTO)
    expect(px(d, 150, 100)[1]).toBeLessThan(80) // still red
    const e = page([210, 30, 30])
    removeLightMarks(e, W, H, { ...DEFAULT_AUTO, color: true })
    for (const v of px(e, 150, 100)) expect(v).toBeGreaterThanOrEqual(240)
    for (const v of px(e, 150, 112)) expect(v).toBeLessThan(50)
  })
})

describe('brush fill', () => {
  it('fills a painted-over mark from the background around it', () => {
    const d = new Uint8ClampedArray(W * H * 4)
    const bg = (x: number, y: number) => [80 + x * 0.4, 120 + y * 0.3, 200 - x * 0.2]
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const mark = x > 150 && x < 250 && y > 120 && y < 170
        const v = mark ? [0, 0, 0] : bg(x, y)
        d.set([v[0], v[1], v[2], 255], i)
      }
    const mask = strokesMask([{ pts: [{ x: 145 / W, y: 145 / W }, { x: 255 / W, y: 145 / W }], r: 32 / W }], W, H)
    inpaint(d, W, H, mask)
    let worst = 0
    for (let y = 121; y < 170; y++)
      for (let x = 151; x < 250; x++) {
        const e = bg(x, y)
        const p = px(d, x, y)
        worst = Math.max(worst, ...p.map((v, k) => Math.abs(v - e[k])))
      }
    expect(worst).toBeLessThan(8)
  })

  it('leaves pixels outside the mask alone', () => {
    const d = new Uint8ClampedArray(W * H * 4).fill(100)
    const before = d.slice()
    const mask = new Uint8Array(W * H)
    mask[150 * W + 200] = 1
    inpaint(d, W, H, mask)
    let changed = 0
    for (let i = 0; i < W * H; i++) if (!mask[i] && d[i * 4] !== before[i * 4]) changed++
    expect(changed).toBe(0)
  })
})
