// Long screenshots from a screen recording: sample the video, follow how far the content has
// scrolled from frame to frame, and pick a few sharp frames that overlap, for the stitcher.
import { createCanvas, ctx2d } from './image'
import { toGray, type Gray } from './stitch'

// ---------------------------------------------------------------- following the scroll

const BANDS = 12
// Per band: its mean brightness, and how much brightness changes along the row (text has a lot).
const FEATURES = BANDS * 2

/**
 * Each row summarised per vertical band (12 of them) by its mean brightness and its amount of
 * detail, smoothed over a few rows: cheap to compare, robust to video noise, and text lines stand
 * out even where bubbles barely differ from the background.
 */
export function signature(g: Gray): Float32Array {
  // Not a parameter: signature is used with Array.map, which would pass the index as a second argument.
  const smooth = 1
  const raw = new Float32Array(g.h * FEATURES)
  const bw = g.w / BANDS
  for (let y = 0; y < g.h; y++)
    for (let k = 0; k < BANDS; k++) {
      let sum = 0
      let edge = 0
      const x0 = Math.floor(k * bw)
      const x1 = Math.floor((k + 1) * bw)
      for (let x = x0; x < x1; x++) {
        const v = g.data[y * g.w + x]
        sum += v
        if (x > 0) edge += Math.abs(v - g.data[y * g.w + x - 1])
      }
      raw[y * FEATURES + k] = sum / Math.max(1, x1 - x0)
      raw[y * FEATURES + BANDS + k] = (edge / Math.max(1, x1 - x0)) * 2
    }
  const sig = new Float32Array(g.h * FEATURES)
  for (let y = 0; y < g.h; y++)
    for (let k = 0; k < FEATURES; k++) {
      let sum = 0
      let n = 0
      for (let d = -smooth; d <= smooth; d++) if (y + d >= 0 && y + d < g.h) (sum += raw[(y + d) * FEATURES + k]), n++
      sig[y * FEATURES + k] = sum / n
    }
  return sig
}

/** How crisp a frame is: frames caught mid-scroll are smeared vertically. */
export function sharpness(g: Gray): number {
  let sum = 0
  let n = 0
  for (let y = Math.floor(g.h * 0.15); y < g.h * 0.85 - 1; y++)
    for (let x = 0; x < g.w; x += 2, n++) sum += Math.abs(g.data[(y + 1) * g.w + x] - g.data[y * g.w + x])
  return n ? sum / n : 0
}

/**
 * How far the content moved between two frames: b's row y shows a's row y + shift (positive when
 * scrolling down). Only rows in the middle of both screens are compared, so a header and an input
 * bar that stay put neither pull the answer to 0 nor count as differences. `err` is the mean
 * difference at the best shift.
 */
export function estimateShift(a: Float32Array, b: Float32Array, h: number, maxShift: number, minShift = -maxShift): { shift: number; err: number } {
  const lo = Math.floor(h * 0.15)
  const hi = Math.floor(h * 0.85)
  let best = { shift: 0, err: Infinity }
  for (let s = minShift; s <= maxShift; s++) {
    let sum = 0
    let n = 0
    // Every other row: plenty to tell shifts apart, at half the cost.
    // Rows in the middle of both frames, so neither one's header or input bar is compared.
    for (let y = Math.max(lo, lo - s); y < Math.min(hi, hi - s); y += 2) {
      const ra = (y + s) * FEATURES
      const rb = y * FEATURES
      for (let k = 0; k < FEATURES; k++, n++) sum += Math.abs(a[ra + k] - b[rb + k])
    }
    // The compared stretch must stay a good part of the screen.
    // Too few rows left to compare reliably (frames about half a screen or more apart).
    if (n < (hi - lo) * 0.15 * FEATURES) continue
    const err = sum / n
    if (err < best.err - 1e-9 || (Math.abs(err - best.err) < 1e-9 && Math.abs(s) < Math.abs(best.shift))) best = { shift: s, err }
  }
  return best
}

/** What the picker asks for: keep the current frame in a slot, use a slot's frame, or start over. */
export type PickerAction = { hold: Slot } | { pick: Slot } | { restart: true }
export type Slot = 'top' | 'crisp' | 'loose' | 'furthest'

/**
 * Chooses frames from a recording as it plays, one frame at a time, keeping only a few candidates.
 * Each frame is measured directly against the last frame picked (nothing is added up, so nothing
 * drifts). From the top (the sharpest frame before the scroll starts), it picks the sharpest
 * frame 1/4–1/2 of a screen further on (so neighbours overlap well and none is caught mid-scroll),
 * and so on to the end. Frames that are unrelated for a while (Control Center at the start or end)
 * start a new run; the longest run is the scroll.
 *
 * `add` returns actions: `hold` = keep the current frame in that slot (replacing what was there),
 * `pick` = the frame in that slot is the next frame of the long image, `restart` = a new run.
 */
export class FramePicker {
  /** The frames picked in each run (as the ids passed to add). */
  runs: number[][] = [[]]
  private slots = new Map<Slot, { id: number; sig: Float32Array; sharp: number; adv: number }>()
  private anchor: Float32Array | null = null
  private first: Float32Array | null = null
  private lost = 0
  private h: number
  private maxErr: number
  private looseErr: number

  /** Where `sig` is relative to `from` (a full search: narrowing it down risks a wrong match). */
  private measure(from: Float32Array, sig: Float32Array): { shift: number; err: number } {
    return estimateShift(from, sig, this.h, Math.round(this.h * 0.5), -Math.round(this.h * 0.1))
  }

  constructor(h: number, maxErr = 6, looseErr = 12) {
    this.h = h
    this.maxErr = maxErr
    this.looseErr = looseErr
  }

  private hold(slot: Slot, id: number, sig: Float32Array, sharp: number, adv: number, out: PickerAction[]) {
    this.slots.set(slot, { id, sig, sharp, adv })
    out.push({ hold: slot })
  }

  private use(slot: Slot, out: PickerAction[]) {
    const c = this.slots.get(slot)!
    this.runs[this.runs.length - 1].push(c.id)
    this.anchor = c.sig
    out.push({ pick: slot })
  }

  /**
   * The scroll was interrupted (frames stopped matching, or the recording ended): use the best
   * candidate, and the furthest one too if it got further, so neither quality nor progress is lost.
   */
  private interrupt(out: PickerAction[], minGain = 0.05): boolean {
    const best = (['crisp', 'loose'] as Slot[]).find((s) => this.slots.has(s))
    const far = this.slots.get('furthest')
    const bestAdv = best ? this.slots.get(best)!.adv : 0
    if (best) this.use(best, out)
    const gain = far ? far.adv - bestAdv : 0
    if (far && (!best || gain > this.h * minGain)) {
      this.use('furthest', out)
      this.slots.clear()
    } else {
      this.slots.clear()
      // Not worth a frame yet, but don't lose it: it stays a candidate, measured from the new pick,
      // in case the recording ends here.
      if (far && gain > 0) this.slots.set('furthest', { ...far, adv: gain })
    }
    return !!(best || far)
  }

  /** Uses the best candidate as the next frame; returns whether there was one. */
  private commit(out: PickerAction[]): boolean {
    const slot = (['crisp', 'loose', 'furthest'] as Slot[]).find((s) => this.slots.has(s))
    if (!slot) return false
    const c = this.slots.get(slot)!
    this.runs[this.runs.length - 1].push(c.id)
    this.anchor = c.sig
    out.push({ pick: slot })
    this.slots.clear()
    return true
  }

  private restart(id: number, sig: Float32Array, sharp: number, out: PickerAction[]) {
    this.interrupt(out)
    this.runs.push([])
    out.push({ restart: true })
    this.anchor = null
    this.first = sig
    this.slots.clear()
    this.lost = 0
    this.hold('top', id, sig, sharp, 0, out)
  }

  add(id: number, sig: Float32Array, sharp: number): PickerAction[] {
    const out: PickerAction[] = []
    const h = this.h
    // The top: until the scroll starts, keep the sharpest frame.
    if (!this.anchor) {
      if (!this.first) {
        this.first = sig
        this.hold('top', id, sig, sharp, 0, out)
        return out
      }
      const r = this.measure(this.first, sig)
      if (r.err > this.looseErr) {
        // Before the scroll starts, a change of screen (Control Center closing) means start over
        // right away, so the top of the content isn't missed.
        if (++this.lost > 2) this.restart(id, sig, sharp, out)
        return out
      }
      this.lost = 0
      if (Math.abs(r.shift) <= h * 0.03) {
        // The topmost frame (a recording isn't blurred; the scroll may already have begun a little).
        const top = this.slots.get('top')!
        if (r.shift < top.adv - 1 || (r.shift <= top.adv + 1 && sharp > top.sharp * 1.02)) this.hold('top', id, sig, sharp, r.shift, out)
        return out
      }
      // The scroll has started: the top frame is the first frame of the long image.
      const top = this.slots.get('top')!
      this.runs[this.runs.length - 1].push(top.id)
      this.anchor = top.sig
        out.push({ pick: 'top' })
      this.slots.clear()
    }
    // Only forward (and a little back, for a bounce at the end of a flick).
    const r = this.measure(this.anchor, sig)
    if (r.err > this.looseErr) {
      // Too far from the last pick to measure (the scroll went on): use the best candidate, then
      // measure from there.
      const f = this.slots.get('furthest')
      // (Mid-scroll, the furthest frame is only worth an extra frame if it's clearly further on.)
      if (f && f.adv >= h * 0.2 && this.interrupt(out, 0.15)) {
            const again = this.measure(this.anchor!, sig)
        if (again.err <= this.looseErr) {
          this.lost = 0
          if (again.shift <= h * 0.5) this.consider(id, sig, sharp, again, out)
          return out
        }
      }
      // A glitch, or something else on screen (Control Center): after a while, start over.
      if (++this.lost > 12) this.restart(id, sig, sharp, out)
      return out
    }
    this.lost = 0
    if (r.shift > h * 0.5) {
      // Gone too far from the last pick: use the best candidate, then measure from there.
      if (this.commit(out)) {
            const again = this.measure(this.anchor!, sig)
        if (again.err <= this.looseErr && again.shift <= h * 0.5) this.consider(id, sig, sharp, again, out)
      } else {
        // Nothing in between (a very fast flick): this frame is the best there is.
        this.hold('furthest', id, sig, sharp, r.shift, out)
        this.commit(out)
      }
      return out
    }
    this.consider(id, sig, sharp, r, out)
    return out
  }

  private consider(id: number, sig: Float32Array, sharp: number, r: { shift: number; err: number }, out: PickerAction[]) {
    const h = this.h
    const better = (slot: Slot) => {
      const c = this.slots.get(slot)
      return !c || sharp > c.sharp * 1.02 || (sharp >= c.sharp * 0.98 && r.shift > c.adv)
    }
    if (r.shift >= h * 0.25) {
      // Crisp frames (match well) are preferred; smeared ones only if there's nothing else.
      const slot: Slot = r.err <= this.maxErr ? 'crisp' : 'loose'
      if (better(slot)) this.hold(slot, id, sig, sharp, r.shift, out)
    }
    const f = this.slots.get('furthest')
    // On a tie the later frame wins: after a bounce, the content settles at the true end.
    if (r.shift > h * 0.05 && (!f || r.shift >= f.adv)) this.hold('furthest', id, sig, sharp, r.shift, out)
  }

  /** The recording ended: use the last candidate. Returns the frames of the longest run. */
  finish(): { actions: PickerAction[]; picks: number[] } {
    const out: PickerAction[] = []
    if (!this.anchor && this.slots.has('top')) {
      this.runs[this.runs.length - 1].push(this.slots.get('top')!.id)
      out.push({ pick: 'top' })
    } else this.interrupt(out)
    return { actions: out, picks: this.runs.reduce((a, b) => (b.length > a.length ? b : a)) }
  }
}

// ---------------------------------------------------------------- reading the video

const SMALL_W = 240

/**
 * A 2D context for full-size frames, which are only copied and saved, never read pixel by pixel:
 * without "will read frequently" they stay on the GPU, which is far faster for 12-megabyte frames.
 */
function gpu(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  return ctx
}

/**
 * Plays the recording once (decoding forward is fast; jumping around isn't when keyframes are
 * rare) and lets the picker choose frames as they go by, keeping full-size copies only of its
 * current candidates. Returns the chosen frames as JPEG files for the stitcher.
 */
export async function framesFromVideo(file: File, name: string, onProgress: (f: number) => void): Promise<File[]> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      v.addEventListener('loadeddata', () => resolve(), { once: true })
      v.addEventListener('error', () => reject(new Error('Video could not be read')), { once: true })
    })
    // Each frame is first copied at full size; it's analysed and kept from that copy, because during
    // playback the video may already show the next frame by the time the analysis is done.
    const now = createCanvas(v.videoWidth, v.videoHeight)
    const nctx = gpu(now)
    const small = createCanvas(SMALL_W, Math.round((v.videoHeight * SMALL_W) / v.videoWidth))
    const sctx = ctx2d(small)
    const picker = new FramePicker(small.height)
    const slots = new Map<Slot, HTMLCanvasElement>()
    const runs: Promise<File>[][] = [[]]
    let n = 0
    const act = (actions: PickerAction[]) => {
      for (const a of actions) {
        if ('hold' in a) {
          // The frame just analysed, at full size.
          const c = slots.get(a.hold) ?? createCanvas(v.videoWidth, v.videoHeight)
          gpu(c).drawImage(now, 0, 0)
          slots.set(a.hold, c)
        } else if ('pick' in a) {
          const c = slots.get(a.pick)!
          slots.delete(a.pick)
          const k = runs[runs.length - 1].length + 1
          runs[runs.length - 1].push(
            new Promise<File>((resolve, reject) =>
              c.toBlob((b) => (b ? resolve(new File([b], `${name}-${k}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })) : reject(new Error('Frame could not be saved'))), 'image/jpeg', 0.95),
            ),
          )
        } else runs.push([])
      }
    }
    const step = 1 / 15
    let last = -Infinity
    const frame = (t: number) => {
      if (t - last < step * 0.95) return
      // Frames are being skipped (a slower phone): play slower, below normal speed if need be, so a
      // quick flick isn't missed. A slow phone just takes longer.
      if (last >= 0 && t - last > 0.15) v.playbackRate = Math.max(0.25, v.playbackRate * 0.6)
      last = t
      nctx.drawImage(v, 0, 0)
      sctx.drawImage(now, 0, 0, small.width, small.height)
      const g = toGray(sctx.getImageData(0, 0, small.width, small.height))
      act(picker.add(n++, signature(g), sharpness(g)))
      onProgress(Math.min(1, t / v.duration))
    }
    if (typeof v.requestVideoFrameCallback === 'function') {
      // Play it through, looking at the frames as they're shown.
      await new Promise<void>((resolve, reject) => {
        const onFrame = (_: number, meta: { mediaTime: number }) => {
          frame(meta.mediaTime)
          if (!v.ended) v.requestVideoFrameCallback(onFrame)
        }
        v.requestVideoFrameCallback(onFrame)
        v.addEventListener('ended', () => resolve(), { once: true })
        v.addEventListener('error', () => reject(new Error('Video could not be read')), { once: true })
        // Faster than real time, but not so fast that frames get skipped during a quick flick.
        v.playbackRate = 2
        v.play().catch(reject)
      })
    } else {
      // Older browsers: step through by seeking.
      await v.play().catch(() => {})
      v.pause()
      for (let t = 0; t < v.duration; t += step) {
        await seek(v, t)
        frame(t)
      }
    }
    const { actions } = picker.finish()
    act(actions)
    const best = runs.reduce((a, b) => (b.length > a.length ? b : a))
    return Promise.all(best)
  } finally {
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  }
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      v.removeEventListener('seeked', done)
      v.removeEventListener('error', fail)
      resolve()
    }
    const fail = () => reject(new Error('Video could not be read'))
    v.addEventListener('seeked', done)
    v.addEventListener('error', fail)
    v.currentTime = t
  })
}
