import { useEffect, useRef, useState } from 'react'
import { ctx2d, type Point, type Quad } from '../lib/image'

/** Shows `src` with a draggable four-corner frame. Coordinates are in source pixels. */
export function CropEditor({ src, quad, onChange }: { src: HTMLCanvasElement; quad: Quad; onChange: (q: Quad) => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState<number | null>(null)
  const loupeRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      // clientWidth includes padding; the image must fit inside it.
      const cs = getComputedStyle(el)
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      setBox({ w: el.clientWidth - padX, h: el.clientHeight - padY })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = box.w && box.h ? Math.min(box.w / src.width, box.h / src.height) : 0
  const dw = src.width * scale
  const dh = src.height * scale

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !scale) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(dw * dpr)
    c.height = Math.round(dh * dpr)
    const ctx = ctx2d(c)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, c.width, c.height)
  }, [src, dw, dh, scale])

  const toSrc = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.min(src.width, Math.max(0, ((e.clientX - r.left) / r.width) * src.width)),
      y: Math.min(src.height, Math.max(0, ((e.clientY - r.top) / r.height) * src.height)),
    }
  }

  const drawLoupe = (p: Point) => {
    const l = loupeRef.current
    if (!l) return
    const ctx = ctx2d(l)
    const zoomSrc = 60 / scale / 2.5 // source pixels shown across the loupe
    ctx.clearRect(0, 0, l.width, l.height)
    ctx.drawImage(src, p.x - zoomSrc / 2, p.y - zoomSrc / 2, zoomSrc, zoomSrc, 0, 0, l.width, l.height)
    ctx.strokeStyle = '#2fbf8f'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(l.width / 2, 0)
    ctx.lineTo(l.width / 2, l.height)
    ctx.moveTo(0, l.height / 2)
    ctx.lineTo(l.width, l.height / 2)
    ctx.stroke()
  }

  const onMove = (e: React.PointerEvent) => {
    if (drag == null) return
    const p = toSrc(e)
    const q = quad.map((pt, i) => (i === drag ? p : pt)) as Quad
    onChange(q)
    drawLoupe(p)
  }

  const handleR = 22 / (scale || 1)
  const pts = quad.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="crop-box" ref={boxRef}>
      <div className="crop-stage" style={{ width: dw, height: dh }} onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        <canvas ref={canvasRef} style={{ width: dw, height: dh }} />
        <svg className="crop-svg" viewBox={`0 0 ${src.width} ${src.height}`} width={dw} height={dh} preserveAspectRatio="none">
          <path d={`M0,0H${src.width}V${src.height}H0Z M${pts.replace(/ /g, ' L')}Z`} fill="rgba(0,0,0,.45)" fillRule="evenodd" />
          <polygon points={pts} fill="rgba(47,191,143,.12)" stroke="#2fbf8f" strokeWidth={2.5 / (scale || 1)} />
          {quad.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={handleR * 0.5} fill="#fff" stroke="#2fbf8f" strokeWidth={3 / (scale || 1)} />
              <circle
                cx={p.x}
                cy={p.y}
                r={handleR}
                fill="transparent"
                style={{ cursor: 'grab', touchAction: 'none' }}
                onPointerDown={(e) => {
                  ;(e.currentTarget.ownerSVGElement?.parentElement as HTMLElement).setPointerCapture(e.pointerId)
                  setDrag(i)
                  drawLoupe(p)
                }}
              />
            </g>
          ))}
        </svg>
        <canvas ref={loupeRef} className="loupe" width={120} height={120} style={{ display: drag == null ? 'none' : 'block', left: drag != null && quad[drag].x < src.width / 2 ? 'auto' : 8, right: drag != null && quad[drag].x < src.width / 2 ? 8 : 'auto' }} />
      </div>
    </div>
  )
}
