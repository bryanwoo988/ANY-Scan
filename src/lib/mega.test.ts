import { describe, expect, it } from 'vitest'
import { apply, composite, features, fitHomography, inv, mul, planMosaic, translate, type GrayF, type Mat3 } from './mega'
import { boxBlur } from './image'

/** A "poster": smooth noise at several scales plus some text-like strokes. */
function poster(w: number, h: number, seed = 3): Float32Array {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const out = new Float32Array(w * h).fill(128)
  for (const r of [24, 8, 3]) {
    const layer = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) layer[i] = rnd() * 255 - 128
    boxBlur(layer, w, h, r)
    boxBlur(layer, w, h, r)
    for (let i = 0; i < w * h; i++) out[i] += layer[i] * (r === 24 ? 6 : r === 8 ? 4 : 2)
  }
  for (let k = 0; k < 400; k++) {
    const x = Math.floor(rnd() * (w - 30))
    const y = Math.floor(rnd() * (h - 10))
    const len = 5 + Math.floor(rnd() * 25)
    for (let i = 0; i < len; i++) for (let t = 0; t < 2; t++) out[(y + t) * w + x + i] = 20
  }
  for (let i = 0; i < w * h; i++) out[i] = Math.min(255, Math.max(0, out[i]))
  return out
}

/** Renders the photo whose pixels map to poster coordinates through `toPoster`. */
function photo(src: Float32Array, sw: number, w: number, h: number, toPoster: Mat3, gain = 1): GrayF {
  const d = new Float32Array(w * h)
  const sh = src.length / sw
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [px, py] = apply(toPoster, x, y)
      const ix = Math.min(sw - 2, Math.max(0, Math.floor(px)))
      const iy = Math.min(sh - 2, Math.max(0, Math.floor(py)))
      const fx = px - ix
      const fy = py - iy
      const v = src[iy * sw + ix] * (1 - fx) * (1 - fy) + src[iy * sw + ix + 1] * fx * (1 - fy) + src[(iy + 1) * sw + ix] * (1 - fx) * fy + src[(iy + 1) * sw + ix + 1] * fx * fy
      d[y * w + x] = Math.min(255, v * gain)
    }
  return { w, h, data: d }
}

/** A small rotation + zoom + slight tilt about the photo centre, then a move to (tx, ty). */
function view(tx: number, ty: number, deg: number, zoom: number, tilt: number, w: number, h: number): Mat3 {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r) / zoom
  const s = Math.sin(r) / zoom
  const core: Mat3 = [c, -s, 0, s, c, 0, tilt, 0, 1]
  return mul(translate(tx + w / 2, ty + h / 2), mul(core, translate(-w / 2, -h / 2)))
}

describe('mega scan', () => {
  const PW = 560
  const PH = 440
  const W = 320
  const H = 240
  const src = poster(PW, PH)
  // A 2×2 grid with about a third overlapping, each held a little differently.
  const truths = [view(20, 20, 0, 1, 0, W, H), view(220, 25, 3, 1.05, 0.0002, W, H), view(25, 180, -2, 0.96, 0, W, H), view(215, 175, 1.5, 1, -0.0002, W, H)]
  const gains = [1, 1.15, 0.9, 1.05]
  const photos = truths.map((t, i) => photo(src, PW, W, H, t, gains[i]))

  it('fits a homography from point pairs', () => {
    const H0: Mat3 = [1.02, 0.05, 10, -0.03, 0.98, 5, 0.0001, -0.0002, 1]
    const pts: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
      [50, 40],
      [20, 70],
    ]
    const H1 = fitHomography(
      pts,
      pts.map(([x, y]) => apply(H0, x, y)),
    )!
    for (const [x, y] of pts) {
      const [a, b] = apply(H0, x, y)
      const [c, d] = apply(H1, x, y)
      expect(Math.hypot(a - c, b - d)).toBeLessThan(1e-6)
    }
  })

  it('places every photo of a 2×2 grid within 1% (3 px of 320), whatever order they come in', () => {
    const order = [3, 0, 2, 1]
    const feats = order.map((i) => features(photos[i]))
    expect(feats.every((f) => f.n > 200)).toBe(true)
    const m = planMosaic(
      feats,
      order.map(() => ({ w: W, h: H })),
    )
    expect(m.H.every(Boolean)).toBe(true)
    // Compare each photo's placement with the truth, relative to the reference photo.
    const refTruth = truths[order[m.ref]]
    order.forEach((ti, k) => {
      const expected = mul(inv(refTruth), truths[ti]) // photo → reference photo
      let worst = 0
      for (const [x, y] of [
        [0, 0],
        [W, 0],
        [W, H],
        [0, H],
        [W / 2, H / 2],
      ]) {
        const [a, b] = apply(expected, x, y)
        const [c, d] = apply(m.H[k]!, x, y)
        worst = Math.max(worst, Math.hypot(a - c, b - d))
      }
      expect(worst).toBeLessThan(3) // worst at the far corners, outside the overlaps
    })
    // Exposure: the gains undo the brightness differences (relative to each other).
    const rel = order.map((ti, k) => m.gain[k] * gains[ti])
    for (const r of rel) expect(Math.abs(r / rel[0] - 1)).toBeLessThan(0.06)
  })

  it('leaves out a photo of something else', () => {
    const other = { w: W, h: H, data: poster(W, H, 99) }
    const feats = [photos[0], photos[1], other].map((p) => features(p))
    const m = planMosaic(
      feats,
      [0, 1, 2].map(() => ({ w: W, h: H })),
    )
    expect(m.H[0] && m.H[1]).toBeTruthy()
    expect(m.H[2]).toBeNull()
  })

  it('composites into a picture that matches the poster', () => {
    const feats = photos.map((p) => features(p))
    const m = planMosaic(
      feats,
      photos.map(() => ({ w: W, h: H })),
    )
    const ow = Math.ceil(m.box.x1 - m.box.x0)
    const oh = Math.ceil(m.box.y1 - m.box.y0)
    const out = new Uint8ClampedArray(ow * oh * 4)
    const best = new Float32Array(ow * oh)
    photos.forEach((p, i) => {
      const rgba = new Uint8ClampedArray(W * H * 4)
      for (let k = 0; k < W * H; k++) {
        rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = p.data[k]
        rgba[k * 4 + 3] = 255
      }
      // output → reference coords → photo coords
      const toSrc = mul(inv(m.H[i]!), translate(m.box.x0, m.box.y0))
      composite(out, best, ow, oh, rgba, W, H, toSrc, m.gain[i])
    })
    // Map output back to the poster through the reference photo's true placement and compare.
    const toPoster = mul(truths[m.ref], translate(m.box.x0, m.box.y0))
    const g0 = m.gain[m.ref] * gains[m.ref]
    let err = 0
    let cnt = 0
    for (let y = 0; y < oh; y += 3)
      for (let x = 0; x < ow; x += 3) {
        if (!best[y * ow + x] || best[y * ow + x] < 0.05) continue
        const [px, py] = apply(toPoster, x, y)
        if (px < 1 || py < 1 || px > PW - 2 || py > PH - 2) continue
        err += Math.abs(out[(y * ow + x) * 4] / g0 - src[Math.round(py) * PW + Math.round(px)])
        cnt++
      }
    expect(cnt).toBeGreaterThan(5000)
    expect(err / cnt).toBeLessThan(8)
  })
})
