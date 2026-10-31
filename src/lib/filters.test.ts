import { describe, expect, it } from 'vitest'
import { filterPixels } from './image'

const W = 400
const H = 300

describe('whiteboard filter', () => {
  // A board lit unevenly (darker to the right), with a glare spot, blue marker strokes and a red one.
  const d = new Uint8ClampedArray(W * H * 4)
  const isBlue = (x: number, y: number) => (y % 40 >= 20 && y % 40 < 24 && x > 40 && x < 360) || (x % 60 >= 30 && x % 60 < 33 && y > 30 && y < 270)
  const isRed = (x: number, y: number) => y >= 140 && y < 145 && x > 180 && x < 300
  const isGreen = (x: number, y: number) => y >= 250 && y < 256 && x > 60 && x < 360
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const light = 0.55 + 0.4 * (1 - x / W) // 0.95 → 0.55
      const glare = Math.max(0, 1 - Math.hypot(x - 250, y - 120) / 50) * 0.6 // bright reflection
      let rgb = [225, 228, 222]
      if (isBlue(x, y)) rgb = [40, 70, 170]
      if (isRed(x, y)) rgb = [190, 40, 40]
      if (isGreen(x, y)) rgb = [20, 120, 60]
      const i = (y * W + x) * 4
      for (let k = 0; k < 3; k++) d[i + k] = rgb[k] * light + 255 * glare
      d[i + 3] = 255
    }
  filterPixels(d, W, H, 'whiteboard')
  const px = (x: number, y: number) => Array.from(d.slice((y * W + x) * 4, (y * W + x) * 4 + 3))

  it('turns the board white everywhere, also in the shade and around the glare', () => {
    for (const [x, y] of [
      [15, 10],
      [390, 10],
      [390, 290],
      [250, 120],
      [222, 108],
      [120, 200],
    ]) {
      expect(Math.min(...px(x, y))).toBeGreaterThan(235)
    }
  })

  it('keeps the strokes dark and in their colour', () => {
    const blue = px(100, 21) // left, well lit
    const blueDark = px(340, 21) // right, in the shade
    for (const c of [blue, blueDark]) {
      expect(c[2] - c[0]).toBeGreaterThan(60)
      expect(c[0]).toBeLessThan(110)
    }
    const red = px(200, 142)
    expect(red[0] - red[2]).toBeGreaterThan(60)
    // A mid-tone marker keeps its colour instead of turning black.
    for (const x of [100, 340]) {
      const green = px(x, 253)
      expect(green[1] - Math.max(green[0], green[2])).toBeGreaterThan(40)
    }
  })
})

describe('slides filter', () => {
  // A white slide with dark text bars, photographed off a screen: coloured moiré ripples on top.
  const d = new Uint8ClampedArray(W * H * 4)
  const text = (x: number, y: number) => y % 30 >= 10 && y % 30 < 18 && x > 30 && x < 330
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const base = text(x, y) ? 50 : 215
      const ph = (x + y * 0.7) * 0.9
      const i = (y * W + x) * 4
      // Colour fringes out of phase per channel, plus a faint brightness ripple.
      d[i] = base + 22 * Math.sin(ph) + 6 * Math.sin(x * 0.05)
      d[i + 1] = base + 22 * Math.sin(ph + 2.1) + 6 * Math.sin(x * 0.05)
      d[i + 2] = base + 22 * Math.sin(ph + 4.2) + 6 * Math.sin(x * 0.05)
      d[i + 3] = 255
    }
  const spread = (a: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number) => {
    // Average colourfulness (max − min channel) over a background area.
    let s = 0
    let n = 0
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4
        s += Math.max(a[i], a[i + 1], a[i + 2]) - Math.min(a[i], a[i + 1], a[i + 2])
        n++
      }
    return s / n
  }
  const before = spread(d, 40, 1, 320, 8)
  const out = d.slice()
  filterPixels(out, W, H, 'slides')

  it('removes most of the colour ripples', () => {
    expect(before).toBeGreaterThan(30)
    expect(spread(out, 40, 1, 320, 8)).toBeLessThan(before * 0.25)
  })

  it('keeps the text sharp: background near white, text dark, a crisp edge', () => {
    const g = (x: number, y: number) => out[(y * W + x) * 4 + 1]
    expect(g(100, 4)).toBeGreaterThan(225)
    expect(g(100, 14)).toBeLessThan(60)
    // From background to text within 3 px.
    expect(g(100, 8) - g(100, 11)).toBeGreaterThan(110)
  })
})

describe('slides filter on a dark theme', () => {
  it('keeps a dark background dark and light text light', () => {
    const d = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = y % 30 >= 10 && y % 30 < 18 && x > 30 && x < 330 ? 220 : 35 + 8 * Math.sin(x * 0.9)
        const i = (y * W + x) * 4
        d[i] = d[i + 1] = d[i + 2] = v
        d[i + 3] = 255
      }
    filterPixels(d, W, H, 'slides')
    expect(d[(4 * W + 100) * 4]).toBeLessThan(25)
    expect(d[(14 * W + 100) * 4]).toBeGreaterThan(220)
  })
})
