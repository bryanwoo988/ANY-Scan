// A picture you can look at closely: pinch or double-tap to zoom, drag to move around, and — when
// not zoomed — swipe left/right to go to the next or previous page. The picture is fitted with CSS
// and moved with a transform only, so it stays smooth on phones.
import { useEffect, useRef, useState, type ReactNode } from 'react'

const MAX = 5
const SWIPE = 60 // px of horizontal drag that turns a page

interface View {
  s: number
  x: number
  y: number
}

export function ZoomView({
  src,
  resetKey,
  onPrev,
  onNext,
  onZoom,
  children,
  className = '',
  onLoad,
}: {
  src?: string
  /** Changing this (e.g. the page shown) zooms back out. */
  resetKey?: unknown
  onPrev?: () => void
  onNext?: () => void
  /** Called with the zoom level when it settles, so a sharper picture can be made for close-ups. */
  onZoom?: (s: number) => void
  children?: ReactNode
  className?: string
  onLoad?: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [v, setV] = useState<View>({ s: 1, x: 0, y: 0 })
  const [drag, setDrag] = useState(0) // page-swipe offset while dragging at 1×
  const [anim, setAnim] = useState(false)
  const view = useRef(v)
  view.current = v
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const g = useRef<{ kind: 'pan' | 'pinch' | 'swipe' | null; sx: number; sy: number; v: View; d: number; mx: number; my: number; moved: boolean }>({
    kind: null, sx: 0, sy: 0, v, d: 1, mx: 0, my: 0, moved: false,
  })
  const lastTap = useRef({ t: 0, x: 0, y: 0 })

  useEffect(() => {
    setV({ s: 1, x: 0, y: 0 })
    setDrag(0)
  }, [resetKey])

  useEffect(() => {
    onZoom?.(v.s)
  }, [v.s, onZoom])

  /** Keeps the picture covering the box (or centred when smaller) at zoom s. */
  const clamp = (n: View): View => {
    const b = box.current
    const i = img.current
    if (!b || !i) return n
    const s = Math.min(MAX, Math.max(1, n.s))
    const mx = Math.max(0, (i.offsetWidth * s - b.clientWidth) / 2)
    const my = Math.max(0, (i.offsetHeight * s - b.clientHeight) / 2)
    return { s, x: Math.min(mx, Math.max(-mx, n.x)), y: Math.min(my, Math.max(-my, n.y)) }
  }

  /** Point relative to the box centre (the transform origin). */
  const local = (x: number, y: number) => {
    const r = box.current!.getBoundingClientRect()
    return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 }
  }

  /** Zoom to s keeping the picture point under (px, py) where it is. */
  const zoomAt = (from: View, s: number, px: number, py: number): View => {
    const k = Math.min(MAX, Math.max(1, s)) / from.s
    return clamp({ s: from.s * k, x: px - (px - from.x) * k, y: py - (py - from.y) * k })
  }

  const start = () => {
    const p = [...pts.current.values()]
    const cur = view.current
    if (p.length >= 2) {
      const c = local((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2)
      g.current = { kind: 'pinch', sx: 0, sy: 0, v: cur, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, mx: c.x, my: c.y, moved: true }
    } else if (p.length === 1) {
      g.current = { kind: cur.s > 1.01 ? 'pan' : 'swipe', sx: p[0].x, sy: p[0].y, v: cur, d: 1, mx: 0, my: 0, moved: false }
    }
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    box.current?.setPointerCapture(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setAnim(false)
    start()
  }

  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const s = g.current
    const p = [...pts.current.values()]
    if (s.kind === 'pinch' && p.length >= 2) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
      const c = local((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2)
      // Zoom about the starting midpoint, then follow the fingers as they move together.
      const z = zoomAt(s.v, s.v.s * (d / s.d), s.mx, s.my)
      setV(clamp({ ...z, x: z.x + c.x - s.mx, y: z.y + c.y - s.my }))
    } else if (p.length === 1) {
      const dx = p[0].x - s.sx
      const dy = p[0].y - s.sy
      if (Math.hypot(dx, dy) > 6) s.moved = true
      if (s.kind === 'pan') setV(clamp({ s: s.v.s, x: s.v.x + dx, y: s.v.y + dy }))
      else if (s.kind === 'swipe' && (onPrev || onNext) && Math.abs(dx) > Math.abs(dy)) {
        // Resist at the ends, so it's clear there is no page that way.
        setDrag((dx > 0 && !onPrev) || (dx < 0 && !onNext) ? dx / 4 : dx)
      }
    }
  }

  const onUp = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.delete(e.pointerId)
    const s = g.current
    if (pts.current.size) return start() // one finger lifted from a pinch: carry on panning
    setAnim(true)
    if (s.kind === 'swipe') {
      const dx = e.clientX - s.sx
      setDrag(0)
      if (s.moved && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(e.clientY - s.sy)) {
        if (dx < 0) onNext?.()
        else onPrev?.()
        g.current.kind = null
        return
      }
    }
    if (!s.moved && e.type === 'pointerup') {
      // Double tap: zoom in on that spot, or back out.
      const now = performance.now()
      const lt = lastTap.current
      if (now - lt.t < 300 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
        const c = local(e.clientX, e.clientY)
        setV(view.current.s > 1.01 ? { s: 1, x: 0, y: 0 } : zoomAt(view.current, 2.5, c.x, c.y))
        lastTap.current.t = 0
        g.current.kind = null
        return
      } else lastTap.current = { t: now, x: e.clientX, y: e.clientY }
    }
    if (view.current.s < 1.02) setV({ s: 1, x: 0, y: 0 })
    g.current.kind = null
  }

  // Ctrl/trackpad wheel zoom on computers. Added by hand: React's wheel listener is passive.
  useEffect(() => {
    const b = box.current
    if (!b) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && view.current.s <= 1.01 && Math.abs(e.deltaY) < 40) return
      e.preventDefault()
      setAnim(false)
      const r = b.getBoundingClientRect()
      const px = e.clientX - r.left - r.width / 2
      const py = e.clientY - r.top - r.height / 2
      if (e.ctrlKey || e.deltaMode || Math.abs(e.deltaY) >= 40) setV(zoomAt(view.current, view.current.s * Math.exp(-e.deltaY / (e.ctrlKey ? 100 : 400)), px, py))
      else setV(clamp({ ...view.current, x: view.current.x - e.deltaX, y: view.current.y - e.deltaY }))
    }
    b.addEventListener('wheel', wheel, { passive: false })
    return () => b.removeEventListener('wheel', wheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={box}
      className={`zoom-view ${className}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {src && (
        <img
          ref={img}
          src={src}
          alt=""
          draggable={false}
          onLoad={onLoad}
          className={anim ? 'anim' : ''}
          style={{ transform: `translate(${v.x + drag}px, ${v.y}px) scale(${v.s})` }}
        />
      )}
      {children}
    </div>
  )
}
