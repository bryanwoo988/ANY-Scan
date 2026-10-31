import { describe, expect, it } from 'vitest'
import { estimateShift, FramePicker, sharpness, signature } from './video'
import type { Gray } from './stitch'

const W = 60
const H = 120
/** A long chat: bubbles of different heights and widths on either side, with text lines inside. */
function page(h: number): Uint8Array {
  const d = new Uint8Array(W * h).fill(240)
  let s = 7
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let y = 4; y < h; ) {
    const bh = 10 + Math.floor(rnd() * 30)
    const bw = 20 + Math.floor(rnd() * 30)
    const left = rnd() > 0.5
    const x0 = left ? 3 : W - 3 - bw
    for (let r = 0; r < bh && y + r < h; r++)
      for (let x = x0; x < x0 + bw; x++) d[(y + r) * W + x] = r > 2 && r < bh - 2 && r % 6 > 1 && r % 6 < 5 && rnd() > 0.45 ? 40 : left ? 215 : 120
    y += bh + 3 + Math.floor(rnd() * 6)
  }
  return d
}
const content = page(800)

/** A frame of the recording scrolled to y (fractional while moving), with a fixed header and input bar; `blur` smears it like motion. */
function frame(y: number, blur = 0, noise = 3): Gray {
  const d = new Uint8Array(W * H)
  let s = Math.round(y * 977)
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let r = 0; r < H; r++)
    for (let x = 0; x < W; x++) {
      let v: number
      if (r < 12) v = r === 11 ? 150 : 250
      else if (r >= H - 14) v = 230
      else {
        let sum = 0
        const taps = blur ? 5 : 1
        for (let k = 0; k < taps; k++) sum += content[Math.min(799, Math.max(0, Math.round(y + r + (k - (taps - 1) / 2) * (blur / taps)))) * W + x]
        v = sum / taps
      }
      d[r * W + x] = Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 2 * noise)))
    }
  return { w: W, h: H, data: d }
}
/** Control Center: something unrelated. */
const other = (seed: number): Gray => ({ w: W, h: H, data: Uint8Array.from({ length: W * H }, (_, i) => (i * seed * 31) % 256) })

describe('screen recordings', () => {
  it('measures the scroll between two frames despite fixed bars and noise', () => {
    expect(estimateShift(signature(frame(100)), signature(frame(137)), H, 70).shift).toBe(37)
    expect(estimateShift(signature(frame(200)), signature(frame(180)), H, 70).shift).toBe(-20)
  })

  it('blurred (mid-scroll) frames are less sharp', () => {
    expect(sharpness(frame(100, 12))).toBeLessThan(sharpness(frame(100)) * 0.8)
  })

  // A recording: Control Center, a pause at the top, scrolling with pauses, the bottom, Control Center.
  const plan: [number, number][] = [] // [position, blur]
  const add = (from: number, to: number, steps: number) => {
    for (let i = 1; i <= steps; i++) {
      const p = from + ((to - from) * i) / steps
      // A screen recording captures exactly what was drawn: no motion blur, only compression noise.
      plan.push([p, 0])
    }
  }
  for (let i = 0; i < 4; i++) plan.push([0, 0])
  add(0, 90, 6)
  for (let i = 0; i < 3; i++) plan.push([90, 0])
  add(90, 200, 8)
  add(200, 260, 4)
  for (let i = 0; i < 3; i++) plan.push([260, 0])
  add(260, 400, 10)
  for (let i = 0; i < 4; i++) plan.push([400, 0])
  const frames = [other(3), other(5), ...plan.map(([p, b]) => frame(p, b)), other(7), other(11)]

  /** Feeds frames to the picker one by one, as during playback. */
  const pick = (fs: Gray[]) => {
    const p = new FramePicker(H)
    fs.forEach((g, i) => p.add(i, signature(g), sharpness(g)))
    return p.finish().picks
  }

  it('picks sharp frames that overlap, from the top to the bottom, leaving out Control Center', () => {
    const picks = pick(frames)
    // Control Center frames (0, 1 and the last two) are not used.
    for (const i of picks) expect(i >= 2 && i < frames.length - 2).toBe(true)
    const pos = picks.map((i) => plan[i - 2][0])
    expect(pos[0]).toBe(0)
    expect(pos[pos.length - 1]).toBe(400)
    // Steps of 1/4 to 1/2 a screen, so neighbours overlap well without stitching more frames than needed.
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i] - pos[i - 1]).toBeLessThanOrEqual(H * 0.5 + 2)
      if (i < pos.length - 1) expect(pos[i] - pos[i - 1]).toBeGreaterThanOrEqual(H * 0.25 - 2)
    }
  })

  it('copes with frames smeared by fast scrolling', () => {
    const smeared = [other(3), ...plan.map(([p], i) => frame(p, i > 0 && plan[i - 1][0] !== p ? Math.abs(p - plan[i - 1][0]) * 0.5 : 0)), other(7)]
    const pos = pick(smeared).map((i) => plan[i - 1][0])
    expect(pos[0]).toBe(0)
    expect(pos[pos.length - 1]).toBe(400)
    for (let i = 1; i < pos.length; i++) expect(pos[i] - pos[i - 1]).toBeLessThanOrEqual(H * 0.5 + 2)
  })

  it('a recording without scrolling gives a single frame', () => {
    expect(pick([frame(100), frame(100), frame(100), frame(100)])).toHaveLength(1)
  })
})
