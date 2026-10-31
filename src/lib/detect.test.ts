import { describe, expect, it } from 'vitest'
import { quadAspect, sidesOnFrame } from './detect'
import type { Quad } from './image'

const q = (...p: number[]) => [0, 1, 2, 3].map((i) => ({ x: p[i * 2], y: p[i * 2 + 1] })) as Quad

describe('sidesOnFrame', () => {
  it('a screen photographed with the wall around it has no side on the picture edge', () => {
    expect(sidesOnFrame(q(0.2, 0.25, 0.82, 0.29, 0.81, 0.67, 0.2, 0.66), 1, 1)).toBe(0)
  })
  it('the white part under a title bar of a slide that fills the picture runs along three edges', () => {
    expect(sidesOnFrame(q(0, 0.19, 1, 0.19, 1, 0.99, 0.01, 1), 1, 1)).toBe(3)
  })
  it('a title bar strip runs along two edges', () => {
    expect(sidesOnFrame(q(0.01, 0.09, 1, 0.09, 0.99, 0.19, 0.02, 0.19), 1, 1)).toBe(2)
  })
  it('works in pixels', () => {
    expect(sidesOnFrame(q(0, 100, 800, 100, 800, 480, 0, 480), 800, 484)).toBe(3)
  })
})

describe('quadAspect', () => {
  it('tells a slide from a title-bar strip', () => {
    expect(quadAspect(q(0, 0, 1600, 0, 1600, 900, 0, 900))).toBeCloseTo(16 / 9)
    expect(quadAspect(q(24, 44, 793, 44, 785, 92, 24, 92))).toBeGreaterThan(5)
  })
})
