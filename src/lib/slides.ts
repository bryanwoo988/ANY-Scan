// Slides auto-capture: watches small thumbnails of the camera picture and takes a photo each
// time a new slide has appeared and the picture has settled — so a student can rest the phone
// and get one photo per slide, without duplicates.
import { boxBlur } from './image'

export const THUMB_W = 160
export const THUMB_H = 120

/**
 * Grey thumbnail from an RGBA picture whose size is a whole multiple of the thumbnail's. Blocks
 * are averaged (not sampled), so sensor noise doesn't flicker through; the projected text is
 * still a few pixels tall at this size.
 */
export function thumb(rgba: Uint8ClampedArray | Uint8Array, w = THUMB_W): Float32Array {
  const f = Math.max(1, Math.round(w / THUMB_W))
  const g = new Float32Array(THUMB_W * THUMB_H)
  for (let y = 0; y < THUMB_H; y++)
    for (let x = 0; x < THUMB_W; x++) {
      let s = 0
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * w + x * f + dx) * 4
          s += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
        }
      g[y * THUMB_W + x] = s / (f * f)
    }
  // 5×5 box blur: a quarter-pixel shake moves sharp edges (the screen border, text) enough to
  // count as change otherwise; a new line of text is larger than this and still shows.
  boxBlur(g, THUMB_W, THUMB_H, 2)
  return g
}

const S = 2 // shake allowance, thumbnail pixels each way

/**
 * Share of the picture that differs by more than `level` grey levels between two thumbnails,
 * after evening out a change in exposure and lining them up within ±2 px (so a hand-held phone's
 * small shake does not count as change).
 */
export function changed(a: Float32Array, b: Float32Array, level = 24): number {
  const w = THUMB_W
  const h = THUMB_H
  let ma = 0
  let mb = 0
  for (let i = 0; i < a.length; i++) {
    ma += a[i]
    mb += b[i]
  }
  const k = mb > 0 ? ma / mb : 1
  let best = 1
  for (let dy = -S; dy <= S; dy++)
    for (let dx = -S; dx <= S; dx++) {
      let diff = 0
      let n = 0
      for (let y = S; y < h - S; y++)
        for (let x = S; x < w - S; x++) {
          n++
          if (Math.abs(a[y * w + x] - b[(y + dy) * w + x + dx] * k) > level) diff++
        }
      best = Math.min(best, diff / n)
      if (!best) return 0
    }
  return best
}

export class SlideWatcher {
  private prev: Float32Array | null = null
  private last: Float32Array | null = null
  private still = 0
  /**
   * @param stillFrames samples in a row that must be steady and new before a photo is taken
   * @param moveMax share of the picture that may change between samples and still count as steady
   * @param newMin share that must differ from the last photo for the slide to count as new (one
   *   added bullet line on a projected slide is about 1%)
   */
  constructor(
    private stillFrames = 3,
    private moveMax = 0.004,
    private newMin = 0.005,
  ) {}

  /** Feed one thumbnail; returns true when a photo should be taken now. */
  push(t: Float32Array): boolean {
    const steady = this.prev ? changed(t, this.prev) <= this.moveMax : false
    this.prev = t
    // Count samples in a row that are steady AND show something other than the last photo, so a
    // single odd sample (noise, a flicker) can't cause a duplicate.
    const novel = steady && (!this.last || changed(t, this.last) >= this.newMin)
    this.still = novel ? this.still + 1 : 0
    if (this.still < this.stillFrames) return false
    this.last = t
    this.still = 0
    return true
  }

  /** Remember a photo taken by hand so the same slide is not taken again automatically. */
  taken(t: Float32Array) {
    this.last = t
  }

  reset() {
    this.prev = this.last = null
    this.still = 0
  }
}
