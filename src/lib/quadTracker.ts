// Steadies the live document outline in the camera. Raw detections arrive a few times a second
// and wobble from frame to frame (sensor noise, hand shake), occasionally miss, and sometimes
// latch onto something else for a frame. The tracker:
//  - shows an outline only after two consecutive detections agree,
//  - smooths small movements, and follows real movement,
//  - ignores a single outlier jump unless it repeats,
//  - keeps the outline through short misses, hiding it only after several in a row,
//  - reports "locked" once the outline has been still for a while.
// Coordinates are normalised to 0..1 so the tracker is independent of frame size.
import type { Point, Quad } from './image'

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
/** Largest corner displacement between two quads, assuming the same corner order. */
export const quadDistance = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => dist(p, b[i])))
const lerpQuad = (a: Quad, b: Quad, t: number) => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t })) as Quad

export interface TrackerOptions {
  /** Max corner distance (fraction of frame) for two detections to count as the same document. */
  same: number
  /** Consecutive misses before the outline is hidden. */
  maxMisses: number
  /** Consecutive agreeing detections needed to accept a jump to a different place. */
  jumpConfirm: number
  /** Corner movement below which a detection counts as "still". */
  still: number
  /** Still detections in a row before reporting locked. */
  lockAfter: number
}

const DEFAULTS: TrackerOptions = { same: 0.06, maxMisses: 3, jumpConfirm: 4, still: 0.012, lockAfter: 3 }

export class QuadTracker {
  private o: TrackerOptions
  private current: Quad | null = null
  private pending: Quad | null = null
  private pendingCount = 0
  private misses = 0
  private stillCount = 0
  /** Recent detections of the current document, for a per-corner median. */
  private recent: Quad[] = []

  constructor(o: Partial<TrackerOptions> = {}) {
    this.o = { ...DEFAULTS, ...o }
  }

  /** Feeds one detection (normalised, or null for none) and returns what should be shown. */
  update(q: Quad | null): { quad: Quad | null; locked: boolean } {
    if (!q) {
      this.pending = null
      this.pendingCount = 0
      this.stillCount = 0
      if (this.current && ++this.misses >= this.o.maxMisses) {
        this.current = null
        this.recent = []
      }
      return this.state()
    }
    this.misses = 0

    if (!this.current) {
      // Appear only once two detections in a row agree.
      if (this.pending && quadDistance(this.pending, q) < this.o.same) {
        this.current = lerpQuad(this.pending, q, 0.5)
        this.recent = [this.pending, q]
        this.pending = null
        this.pendingCount = 0
      } else {
        this.pending = q
        this.pendingCount = 1
      }
      return this.state()
    }

    const d = quadDistance(this.current, q)
    if (d < this.o.same) {
      // Same document. The per-corner median of the last three detections removes one-off
      // bad frames that are only slightly off; then small jitter is damped hard and larger
      // moves are followed faster.
      this.recent = [...this.recent.slice(-2), q]
      const m = medianQuad(this.recent)
      const t = quadDistance(this.current, m) < this.o.still ? 0.2 : 0.55
      this.current = lerpQuad(this.current, m, t)
      this.stillCount = d < this.o.still * 2 ? this.stillCount + 1 : 0
      this.pending = null
      this.pendingCount = 0
      return this.state()
    }

    // Far away: either the phone moved to another document or this is a one-off mistake.
    this.stillCount = 0
    if (this.pending && quadDistance(this.pending, q) < this.o.same) this.pendingCount++
    else {
      this.pending = q
      this.pendingCount = 1
    }
    if (this.pendingCount >= this.o.jumpConfirm) {
      this.current = q
      this.recent = [q]
      this.pending = null
      this.pendingCount = 0
    }
    return this.state()
  }

  reset(): void {
    this.current = null
    this.pending = null
    this.pendingCount = 0
    this.misses = 0
    this.stillCount = 0
    this.recent = []
  }

  private state() {
    return { quad: this.current, locked: !!this.current && this.stillCount >= this.o.lockAfter }
  }
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const medianQuad = (qs: Quad[]) => [0, 1, 2, 3].map((i) => ({ x: median(qs.map((q) => q[i].x)), y: median(qs.map((q) => q[i].y)) })) as Quad

/** Moves `shown` a step towards `target` for smooth 60 fps animation between detections. */
export function approach(shown: Quad, target: Quad, step = 0.3): Quad {
  return lerpQuad(shown, target, step)
}
