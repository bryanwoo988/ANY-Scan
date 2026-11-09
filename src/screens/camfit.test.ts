import { describe, expect, it } from 'vitest'
import { fitWhole } from './Camera'

describe('camera preview fit', () => {
  it('fills the screen with a portrait frame on a portrait screen', () => {
    expect(fitWhole(393, 620, 3024, 4032)).toBe(false)
  })
  it('shows the whole frame when a landscape frame would be cropped by half on a portrait screen', () => {
    expect(fitWhole(393, 620, 4032, 3024)).toBe(true)
  })
  it('fills when the shapes are close, and before the sizes are known', () => {
    expect(fitWhole(800, 600, 1920, 1080)).toBe(false)
    expect(fitWhole(393, 620, 0, 0)).toBe(false)
  })
})
