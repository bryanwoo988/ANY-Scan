// Remove Watermark: Auto (light / coloured marks behind the text) and Brush (paint over a mark,
// it is filled in from around it). Saved as a new copy; the original document is not changed.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Screen, Segmented } from '../components/ui'
import { createDoc, getPages, type PageRec } from '../lib/db'
import { blobToCanvas, canvasToBlob, ctx2d } from '../lib/image'
import { loadJSON, saveJSON } from '../lib/settings'
import { applyEdits, DEFAULT_AUTO, type AutoOptions, type Stroke } from '../lib/unmark'
import { useApp } from '../state'
import { useDoc } from './Doc'

/** Longest side the pages are shown and edited at; saving works on the full pages. */
const VIEW = 1400
const PREFS_KEY = 'anyscan.unmark'
/** Shared empty list, so a page without strokes doesn't look changed on every render. */
const NO_STROKES: Stroke[] = []

interface Prefs {
  mode: 'auto' | 'brush'
  autoOn: boolean
  auto: AutoOptions
  brush: number // radius in screen pixels
}
const DEFAULT_PREFS: Prefs = { mode: 'auto', autoOn: true, auto: DEFAULT_AUTO, brush: 14 }

export function UnmarkScreen({ docId }: { docId: string }) {
  const { t, setBusy, replace, toast } = useApp()
  const doc = useDoc(docId)
  const [pages, setPages] = useState<PageRec[]>([])
  const [cur, setCur] = useState(0)
  const [base, setBase] = useState<HTMLCanvasElement>()
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = loadJSON<Partial<Prefs>>(PREFS_KEY, {})
    return { ...DEFAULT_PREFS, ...p, auto: { ...DEFAULT_AUTO, ...p.auto } }
  })
  const update = (p: Partial<Prefs>) =>
    setPrefs((x) => {
      const n = { ...x, ...p }
      saveJSON(PREFS_KEY, n)
      return n
    })
  // Brush strokes per page id.
  const [strokes, setStrokes] = useState<Record<string, Stroke[]>>({})
  const [orig, setOrig] = useState(false)
  const [working, setWorking] = useState(false)
  const view = useRef<HTMLCanvasElement>(null)
  const ink = useRef<HTMLCanvasElement>(null)
  // On-screen size of the page: as large as fits the space, keeping its shape. A callback ref,
  // because the stage only appears once the document has loaded.
  const [room, setRoom] = useState({ w: 0, h: 0 })
  const ro = useRef<ResizeObserver | null>(null)
  const stage = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect()
    if (!el) return
    ro.current = new ResizeObserver(() => setRoom({ w: el.clientWidth - 24, h: el.clientHeight - 24 }))
    ro.current.observe(el)
  }, [])

  const docKey = doc?.pageIds.join(',')
  useEffect(() => {
    if (doc) getPages(doc).then(setPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  const page = pages[cur]
  useEffect(() => {
    if (!page) return
    let alive = true
    setBase(undefined)
    blobToCanvas(page.blob, VIEW).then((c) => alive && setBase(c))
    return () => {
      alive = false
    }
  }, [page])

  const auto = prefs.autoOn ? prefs.auto : null
  const pageStrokes = (page && strokes[page.id]) || NO_STROKES

  // Redraw the edited page (shortly after the last change, so dragging a slider stays smooth).
  useEffect(() => {
    const c = view.current
    if (!c || !base) return
    c.width = base.width
    c.height = base.height
    const x = ctx2d(c)
    if (orig) return void x.drawImage(base, 0, 0)
    setWorking(true)
    const h = window.setTimeout(() => {
      const img = ctx2d(base).getImageData(0, 0, base.width, base.height)
      applyEdits(img.data, base.width, base.height, { auto, strokes: pageStrokes })
      x.putImageData(img, 0, 0)
      setWorking(false)
    }, 60)
    return () => window.clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, orig, JSON.stringify(auto), pageStrokes])

  // ---- Brush: draw on the overlay while the finger moves; the fill happens when it lifts.
  const stroke = useRef<{ pts: { x: number; y: number }[]; r: number } | null>(null)
  const toCanvas = (e: React.PointerEvent) => {
    const c = ink.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height, k: c.width / r.width }
  }
  const drawInk = () => {
    const c = ink.current
    const s = stroke.current
    if (!c) return
    const x = ctx2d(c)
    x.clearRect(0, 0, c.width, c.height)
    if (!s) return
    x.strokeStyle = 'rgba(255, 64, 64, 0.55)'
    x.fillStyle = 'rgba(255, 64, 64, 0.55)'
    x.lineCap = x.lineJoin = 'round'
    x.lineWidth = s.r * 2
    x.beginPath()
    s.pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)))
    if (s.pts.length === 1) x.arc(s.pts[0].x, s.pts[0].y, s.r, 0, Math.PI * 2)
    s.pts.length === 1 ? x.fill() : x.stroke()
  }
  const brushOn = prefs.mode === 'brush'
  const down = (e: React.PointerEvent) => {
    if (!brushOn || !base) return
    ink.current!.setPointerCapture(e.pointerId)
    const p = toCanvas(e)
    stroke.current = { pts: [{ x: p.x, y: p.y }], r: prefs.brush * p.k }
    drawInk()
  }
  const move = (e: React.PointerEvent) => {
    if (!stroke.current) return
    const p = toCanvas(e)
    stroke.current.pts.push({ x: p.x, y: p.y })
    drawInk()
  }
  const up = () => {
    const s = stroke.current
    stroke.current = null
    drawInk()
    if (!s || !base || !page) return
    const w = base.width
    // Stored relative to the page width, so the same stroke fits the full-size page on saving.
    const st: Stroke = { pts: s.pts.map((p) => ({ x: p.x / w, y: p.y / w })), r: s.r / w }
    setStrokes((m) => ({ ...m, [page.id]: [...(m[page.id] ?? []), st] }))
  }
  useEffect(() => {
    if (ink.current && base) {
      ink.current.width = base.width
      ink.current.height = base.height
    }
  }, [base])

  const undo = () => page && setStrokes((m) => ({ ...m, [page.id]: (m[page.id] ?? []).slice(0, -1) }))
  const anyStrokes = Object.values(strokes).some((s) => s.length)
  const nothing = !auto && !anyStrokes

  const save = async () => {
    if (!doc) return
    setBusy({ text: t('processing'), progress: 0 })
    try {
      const out = []
      for (const [i, p] of pages.entries()) {
        setBusy({ text: t('processing'), progress: i / pages.length })
        await new Promise((r) => setTimeout(r, 0))
        const c = await blobToCanvas(p.blob, 10000)
        const s = strokes[p.id] ?? []
        if (auto || s.length) {
          const img = ctx2d(c).getImageData(0, 0, c.width, c.height)
          applyEdits(img.data, c.width, c.height, { auto, strokes: s })
          ctx2d(c).putImageData(img, 0, 0)
        }
        out.push({ blob: await canvasToBlob(c, 'image/jpeg', 0.92), w: c.width, h: c.height })
        c.width = c.height = 1
      }
      const d = await createDoc(`${doc.name} (${t('tool.unmark')})`, out)
      toast(t('savedAsCopy'))
      replace('doc', { id: d.id })
    } catch (e) {
      console.error(e)
      toast(t('saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  if (!doc) return <Screen title={t('tool.unmark')}>{null}</Screen>
  const n = pages.length
  const k = base ? Math.min(room.w / base.width, room.h / base.height) : 0
  const fit = { width: Math.max(1, Math.floor(base ? base.width * k : 1)), height: Math.max(1, Math.floor(base ? base.height * k : 1)) }

  return (
    <Screen
      title={t('tool.unmark')}
      right={
        <button className="btn primary sm" onClick={save} disabled={nothing || !n}>
          <Icon name="check" size={18} /> {t('save')}
        </button>
      }
      footer={
        <div className="stack-sm">
          <Segmented
            value={prefs.mode}
            onChange={(mode) => update({ mode })}
            options={[
              { value: 'auto', label: t('unmarkAuto') },
              { value: 'brush', label: t('unmarkBrush') },
            ]}
          />
          {prefs.mode === 'auto' ? (
            <>
              <label className="switch-row">
                <span>{t('unmarkAutoOn')}</span>
                <input type="checkbox" className="switch" checked={prefs.autoOn} onChange={(e) => update({ autoOn: e.target.checked })} />
              </label>
              {prefs.autoOn && (
                <>
                  <label className="slider">
                    <span>{t('unmarkStrength')}</span>
                    <input type="range" min={0} max={1} step={0.05} value={prefs.auto.strength} onChange={(e) => update({ auto: { ...prefs.auto, strength: +e.target.value } })} />
                  </label>
                  <label className="switch-row">
                    <span>{t('unmarkColor')}</span>
                    <input type="checkbox" className="switch" checked={prefs.auto.color} onChange={(e) => update({ auto: { ...prefs.auto, color: e.target.checked } })} />
                  </label>
                </>
              )}
              <p className="muted small">{t('unmarkAutoTip')}</p>
            </>
          ) : (
            <>
              <div className="row gap">
                <label className="slider grow">
                  <span>{t('brushSize')}</span>
                  <input type="range" min={4} max={40} step={1} value={prefs.brush} onChange={(e) => update({ brush: +e.target.value })} />
                </label>
                <button className="btn soft sm" onClick={undo} disabled={!pageStrokes.length}>
                  <Icon name="undo" size={18} /> {t('undo')}
                </button>
              </div>
              <p className="muted small">{t('unmarkBrushTip')}</p>
            </>
          )}
        </div>
      }
    >
      <div className="unmark">
        <div ref={stage} className={`unmark-stage ${brushOn ? 'brush' : ''}`}>
          {!base && <div className="spinner" />}
          <div className="unmark-pic" style={base ? fit : { display: 'none' }}>
            <canvas ref={view} />
            <canvas ref={ink} className="unmark-ink" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          </div>
          {working && base && <div className="unmark-working spinner" />}
        </div>
        <div className="unmark-bar">
          {n > 1 ? (
            <div className="row gap">
              <button className="icon-btn" disabled={cur === 0} onClick={() => setCur(cur - 1)} aria-label={t('prev')}>
                <Icon name="left" />
              </button>
              <span className="small">
                {cur + 1} / {n}
              </span>
              <button className="icon-btn" disabled={cur >= n - 1} onClick={() => setCur(cur + 1)} aria-label={t('next')}>
                <Icon name="right" />
              </button>
            </div>
          ) : (
            <span />
          )}
          <button
            className={`preview-tag btn-tag ${orig ? 'on' : ''}`}
            onPointerDown={() => setOrig(true)}
            onPointerUp={() => setOrig(false)}
            onPointerLeave={() => setOrig(false)}
            onPointerCancel={() => setOrig(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Icon name="compare" size={16} /> {t('holdOriginal')}
          </button>
        </div>
      </div>
    </Screen>
  )
}
