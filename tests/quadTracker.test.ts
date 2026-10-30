import { describe, expect, it } from 'vitest'
import { QuadTracker, quadDistance } from '../src/lib/quadTracker'
import type { Quad } from '../src/lib/image'

const box = (x: number, y: number, s = 0.6): Quad => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
]
const noisy = (q: Quad, n: number, seed: number): Quad => q.map((p, i) => ({ x: p.x + Math.sin(seed * 7 + i) * n, y: p.y + Math.cos(seed * 5 + i) * n })) as Quad

describe('QuadTracker', () => {
  it('appears only after two agreeing detections', () => {
    const t = new QuadTracker()
    expect(t.update(box(0.2, 0.2)).quad).toBeNull()
    expect(t.update(box(0.2, 0.2)).quad).not.toBeNull()
  })

  it('does not appear for a single stray detection', () => {
    const t = new QuadTracker()
    t.update(box(0.2, 0.2))
    expect(t.update(null).quad).toBeNull()
    expect(t.update(box(0.1, 0.3)).quad).toBeNull()
  })

  it('survives short misses but hides after several', () => {
    const t = new QuadTracker()
    t.update(box(0.2, 0.2))
    t.update(box(0.2, 0.2))
    expect(t.update(null).quad).not.toBeNull()
    expect(t.update(null).quad).not.toBeNull()
    expect(t.update(null).quad).toBeNull()
  })

  it('damps jitter: output moves much less than the noisy input', () => {
    const t = new QuadTracker()
    const truth = box(0.2, 0.2)
    let prev: Quad | null = null
    let prevIn: Quad | null = null
    let inMove = 0
    let outMove = 0
    for (let i = 0; i < 40; i++) {
      // About the frame-to-frame noise measured on noisy camera feeds (0.3–0.7% of the frame).
      const q = noisy(truth, 0.005, i)
      const out = t.update(q).quad
      if (prevIn) inMove += quadDistance(prevIn, q)
      if (prev && out) outMove += quadDistance(prev, out)
      prevIn = q
      prev = out
    }
    expect(outMove).toBeLessThan(inMove * 0.4)
  })

  it('ignores a one-frame outlier jump', () => {
    const t = new QuadTracker()
    t.update(box(0.2, 0.2))
    t.update(box(0.2, 0.2))
    const before = t.update(box(0.2, 0.2)).quad!
    const after = t.update(box(0.05, 0.35)).quad!
    expect(quadDistance(before, after)).toBeLessThan(0.001)
    expect(quadDistance(t.update(box(0.2, 0.2)).quad!, box(0.2, 0.2))).toBeLessThan(0.01)
  })

  it('follows a real move to another place once it repeats', () => {
    const t = new QuadTracker()
    for (let i = 0; i < 3; i++) t.update(box(0.2, 0.2))
    for (let i = 0; i < 4; i++) t.update(box(0.05, 0.35))
    expect(quadDistance(t.update(box(0.05, 0.35)).quad!, box(0.05, 0.35))).toBeLessThan(0.01)
  })

  it('locks after the outline holds still, unlocks when it moves', () => {
    const t = new QuadTracker()
    let locked = false
    for (let i = 0; i < 8; i++) locked = t.update(noisy(box(0.2, 0.2), 0.002, i)).locked
    expect(locked).toBe(true)
    expect(t.update(box(0.23, 0.2)).locked).toBe(false)
  })
})

describe('QuadTracker median filter', () => {
  it('a single slightly-off frame barely moves the outline', () => {
    const t = new QuadTracker()
    for (let i = 0; i < 5; i++) t.update(box(0.2, 0.2))
    const before = t.update(box(0.2, 0.2)).quad!
    const after = t.update(box(0.2, 0.245)).quad! // 4.5% off: inside the "same document" range
    expect(quadDistance(before, after)).toBeLessThan(0.005)
  })
})
