import { describe, expect, it } from 'vitest'
import { changed, SlideWatcher, thumb, THUMB_H, THUMB_W } from './slides'

const F = 4 // pictures are made at 4× the thumbnail size, like the camera's
const W = THUMB_W * F
const H = THUMB_H * F

/**
 * A camera picture of a projected slide on a darker wall: a title bar and `bullets` lines of
 * text (thin strokes), with optional shake (whole pixels at camera size), exposure and noise.
 */
function frame(bullets: number, opts: { shift?: number; bright?: number; noise?: number; seed?: number; title?: number; person?: number } = {}): Uint8ClampedArray {
  const { shift = 0, bright = 1, noise = 0, title = 0, person } = opts
  let s = opts.seed ?? 1
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = x - shift
      let v = 70 // wall
      if (sx >= 120 && sx < 520 && y >= 80 && y < 320) {
        v = 240 // screen
        if (y >= 92 && y < 130) v = 60 // title bar
        if (y >= 100 && y < 120 && sx >= 140 + title * 20 && sx < 300 + title * 20 && (sx >> 2) % 3) v = 245 // title text
        for (let b = 0; b < bullets; b++) if (y >= 150 + b * 36 && y < 166 + b * 36 && sx >= 150 && sx < 380 + ((b * 37) % 90) && (sx >> 1) % 3 === 0) v = 30 // text strokes
      }
      if (person != null && Math.abs(x - person) < 40 && y > 160) v = 45 // someone in front
      v = v * bright + (rnd() - 0.5) * noise
      const i = (y * W + x) * 4
      d[i] = d[i + 1] = d[i + 2] = v
      d[i + 3] = 255
    }
  return d
}
const tb = (f: Uint8ClampedArray) => thumb(f, W)

describe('slides auto-capture', () => {
  it('ignores hand shake, exposure changes and noise, but sees one new line of text', () => {
    const a = tb(frame(3))
    for (const shift of [1, 2, 3, 5]) expect(changed(a, tb(frame(3, { shift, bright: 0.9, noise: 10, seed: shift })))).toBeLessThan(0.004)
    expect(changed(a, tb(frame(4)))).toBeGreaterThan(0.005)
  })

  it('takes one photo per slide once the picture has settled', () => {
    const w = new SlideWatcher()
    const feed = (fs: Uint8ClampedArray[]) => fs.map((f) => w.push(tb(f)))
    const n = (seed: number) => ({ noise: 8, seed, shift: seed % 3 })
    // Slide 1 held for a while → exactly one photo.
    expect(feed([1, 2, 3, 4, 5, 6].map((i) => frame(2, n(i)))).filter(Boolean)).toHaveLength(1)
    // A line of text appears → one more photo after it settles.
    expect(feed([7, 8, 9, 10, 11].map((i) => frame(3, n(i)))).filter(Boolean)).toHaveLength(1)
    // The lecturer walks across → nothing while moving…
    expect(feed([100, 220, 340, 460, 580].map((p) => frame(3, { person: p })))).not.toContain(true)
    // …and once out of the way, the same slide is not taken again.
    expect(feed([12, 13, 14, 15].map((i) => frame(3, n(i))))).not.toContain(true)
    // Next slide.
    expect(feed([16, 17, 18, 19].map((i) => frame(1, { title: 2, ...n(i) }))).filter(Boolean)).toHaveLength(1)
  })

  it('a slide photographed by hand is not taken again automatically', () => {
    const w = new SlideWatcher()
    w.taken(tb(frame(2)))
    expect([1, 2, 3, 4, 5].map((s) => w.push(tb(frame(2, { noise: 8, seed: s, shift: s % 3 }))))).not.toContain(true)
  })
})
