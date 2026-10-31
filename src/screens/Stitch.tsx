// Long Screenshot: join screenshots taken while scrolling into one tall image.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Screen } from '../components/ui'
import { createDoc, defaultDocName } from '../lib/db'
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../lib/image'
import { shareOrDownload } from '../lib/share'
import { makePlan, slices, toGray, type Plan } from '../lib/stitch'
import { useApp } from '../state'

const SMALL_W = 240
// Canvases larger than this fail on iPhones.
const MAX_PIXELS = 16_000_000
const MAX_SIDE = 32_000
// One page of a saved document stays well inside those limits.
const PAGE_H = 12_000
const STEP = 8
const EDGE_STEP = 24

interface Shot {
  file: File
  canvas: HTMLCanvasElement
  url: string
}

/** Decodes the screenshots at one common width (the narrowest, at most 1440 px). */
async function loadShots(files: File[]): Promise<Shot[]> {
  const raw = await Promise.all(files.map((f) => blobToCanvas(f, 8000)))
  const w = Math.min(1440, ...raw.map((c) => c.width))
  return raw.map((c, i) => {
    let canvas = c
    if (c.width !== w) {
      canvas = createCanvas(w, (c.height * w) / c.width)
      ctx2d(canvas).drawImage(c, 0, 0, canvas.width, canvas.height)
    }
    return { file: files[i], canvas, url: URL.createObjectURL(files[i]) }
  })
}

function analyse(shots: Shot[]): Plan {
  const full = shots.map((s) => toGray(ctx2d(s.canvas).getImageData(0, 0, s.canvas.width, s.canvas.height)))
  const k = shots[0].canvas.width / SMALL_W
  const small = shots.map((s) => {
    const c = createCanvas(SMALL_W, Math.round(s.canvas.height / k))
    ctx2d(c).drawImage(s.canvas, 0, 0, c.width, c.height)
    return toGray(ctx2d(c).getImageData(0, 0, c.width, c.height))
  })
  return makePlan(small, full, k)
}

/** Draws rows [from, to) of the stitched image into a canvas of width `width`. */
function render(shots: Shot[], plan: Plan, width: number, from = 0, to = Infinity): HTMLCanvasElement {
  const parts = slices(
    shots.map((s) => s.canvas.height),
    plan,
  )
  const total = parts.reduce((n, [a, b]) => n + b - a, 0)
  const end = Math.min(total, to)
  const s = width / shots[0].canvas.width
  const out = createCanvas(width, Math.max(1, (end - from) * s))
  const ctx = ctx2d(out)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  let y = 0
  parts.forEach(([a, b], i) => {
    const y0 = Math.max(y, from)
    const y1 = Math.min(y + b - a, end)
    if (y1 > y0) ctx.drawImage(shots[i].canvas, 0, a + (y0 - y), shots[i].canvas.width, y1 - y0, 0, (y0 - from) * s, out.width, (y1 - y0) * s)
    y += b - a
  })
  return out
}

export function StitchScreen() {
  const { t, pickFiles, setBusy, toast, replace } = useApp()
  const [shots, setShots] = useState<Shot[]>([])
  const [auto, setAuto] = useState<Plan | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [preview, setPreview] = useState<{ url: string; seams: number[]; total: number } | null>(null)
  const name = useRef(defaultDocName(t('tool.stitch')))

  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots])

  const choose = async (more: boolean) => {
    const files = await pickFiles({ accept: 'image/*', multiple: true })
    if (!files.length) return
    setBusy({ text: t('stitching') })
    try {
      const all = more ? [...shots.map((s) => s.file), ...files] : files
      const loaded = await loadShots(all)
      if (loaded.length < 2) toast(t('stitchNeedTwo'))
      setShots(loaded)
    } catch (e) {
      console.error(e)
      toast(t('importFailed', { name: files.map((f) => f.name).join(', ') }))
    } finally {
      setBusy(null)
    }
  }

  // Re-analyse whenever the set or order of screenshots changes.
  useEffect(() => {
    if (shots.length < 2) {
      setAuto(null)
      setPlan(null)
      return
    }
    setBusy({ text: t('stitching') })
    // Let the busy overlay paint before the (synchronous) analysis.
    const id = window.setTimeout(() => {
      try {
        const p = analyse(shots)
        setAuto(p)
        setPlan(p)
      } finally {
        setBusy(null)
      }
    }, 30)
    return () => window.clearTimeout(id)
  }, [shots])

  useEffect(() => {
    if (!plan || shots.length < 2) return setPreview(null)
    const c = render(shots, plan, 480)
    const parts = slices(
      shots.map((s) => s.canvas.height),
      plan,
    )
    const total = parts.reduce((n, [a, b]) => n + b - a, 0)
    let y = 0
    const seams = parts.slice(0, -1).map(([a, b]) => (y += b - a))
    let url = ''
    let alive = true
    canvasToBlob(c, 'image/jpeg', 0.85).then((b) => {
      if (!alive) return
      url = URL.createObjectURL(b)
      setPreview({ url, seams, total })
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [plan, shots])

  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= shots.length) return
    const next = [...shots]
    ;[next[i], next[j]] = [next[j], next[i]]
    setShots(next)
  }
  const remove = (i: number) => setShots(shots.filter((_, k) => k !== i))
  /** ▲ at a join cuts more of the lower screenshot away (the content below moves up). */
  const nudge = (seam: number, d: number) => {
    if (!plan) return
    const h = shots[seam + 1].canvas.height
    const joins = plan.joins.map((j, i) => (i === seam ? { ...j, bStart: Math.max(0, Math.min(h - 1, j.bStart + d)) } : j))
    setPlan({ ...plan, joins })
  }
  /** Moves the top or bottom edge of the long image; the arrows move the edge. */
  const edge = (which: 'top' | 'bottom', d: number) => {
    if (!plan) return
    const h = shots[which === 'top' ? 0 : shots.length - 1].canvas.height
    setPlan({ ...plan, [which]: Math.max(0, Math.min(Math.round(h * 0.6), plan[which] + d)) })
  }

  const totalH = preview?.total ?? 0
  const w = shots[0]?.canvas.width ?? 0
  // A single image has to fit the canvas limits; scale it down if the result is very long.
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, w * totalH)), MAX_SIDE / Math.max(1, totalH))

  const saveImage = async () => {
    if (!plan) return
    setBusy({ text: t('processing') })
    try {
      const c = render(shots, plan, Math.round(w * scale))
      await shareOrDownload([{ blob: await canvasToBlob(c, 'image/jpeg', 0.9), name: `${name.current}.jpg` }])
    } finally {
      setBusy(null)
    }
  }
  const saveDoc = async () => {
    if (!plan) return
    setBusy({ text: t('processing') })
    try {
      // Full resolution, split into tall pages that stay within the canvas limits.
      const pages = []
      for (let y = 0; y < totalH; y += PAGE_H) {
        const c = render(shots, plan, w, y, y + PAGE_H)
        pages.push({ blob: await canvasToBlob(c, 'image/jpeg', 0.9), w: c.width, h: c.height })
      }
      const d = await createDoc(name.current, pages)
      toast(t('saved'))
      replace('doc', { id: d.id })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen
      title={t('tool.stitch')}
      footer={
        shots.length >= 2 && plan ? (
          <div className="row gap">
            <button className="btn soft grow" onClick={saveDoc}>
              <Icon name="docs" /> {t('saveToAnyScan')}
            </button>
            <button className="btn primary grow" onClick={saveImage}>
              <Icon name="share" /> {t('saveImage')}
            </button>
          </div>
        ) : (
          <button className="btn primary block" onClick={() => choose(false)}>
            <Icon name="image" /> {t('chooseScreenshots')}
          </button>
        )
      }
    >
      <div className="pad stack">
        {shots.length < 2 && (
          <div className="stitch-intro">
            <div className="stitch-art" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <h2>{t('stitchTitle')}</h2>
            <ol>
              <li>{t('stitchStep1')}</li>
              <li>{t('stitchStep2')}</li>
              <li>{t('stitchStep3')}</li>
            </ol>
          </div>
        )}

        {shots.length > 0 && (
          <div className="stitch-strip">
            {shots.map((s, i) => (
              <div key={s.url} className="stitch-thumb">
                <img src={s.url} alt="" />
                <span className="stitch-n">{i + 1}</span>
                <div className="stitch-thumb-btns">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('moveEarlier')}>
                    <Icon name="back" size={14} />
                  </button>
                  <button onClick={() => remove(i)} aria-label={t('delete')}>
                    <Icon name="close" size={14} />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === shots.length - 1} aria-label={t('moveLater')}>
                    <Icon name="chevron" size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button className="stitch-add" onClick={() => choose(true)} aria-label={t('addScreenshots')}>
              <Icon name="plus" size={26} />
            </button>
          </div>
        )}

        {preview && plan && (
          <>
            <div className="row stitch-info">
              <span className="muted small grow">
                {t('stitchInfo', { n: shots.length, h: Math.round(totalH * scale), w: Math.round(w * scale) })}
              </span>
              {auto && plan !== auto && (
                <button className="link" onClick={() => setPlan(auto)}>
                  {t('reset')}
                </button>
              )}
            </div>
            <p className="muted small">{t('stitchSeamHint')}</p>
            <div className="stitch-preview">
              <img src={preview.url} alt="" />
              <div className="stitch-edge top">
                <div className="stitch-seam-pill">
                  <span>{t('stitchTop')}</span>
                  <button onClick={() => edge('top', -EDGE_STEP)} disabled={plan.top === 0} aria-label={t('stitchShowMore')}>
                    ▲
                  </button>
                  <button onClick={() => edge('top', EDGE_STEP)} aria-label={t('stitchTrimMore')}>
                    ▼
                  </button>
                </div>
              </div>
              <div className="stitch-edge bottom">
                <div className="stitch-seam-pill">
                  <span>{t('stitchBottom')}</span>
                  <button onClick={() => edge('bottom', EDGE_STEP)} aria-label={t('stitchTrimMore')}>
                    ▲
                  </button>
                  <button onClick={() => edge('bottom', -EDGE_STEP)} disabled={plan.bottom === 0} aria-label={t('stitchShowMore')}>
                    ▼
                  </button>
                </div>
              </div>
              {preview.seams.map((y, i) => (
                <div key={i} className={`stitch-seam ${plan.joins[i].matched ? '' : 'none'}`} style={{ top: `${(y / preview.total) * 100}%` }}>
                  <div className="stitch-seam-pill">
                    <span>{plan.joins[i].matched ? i + 1 : t('stitchNoOverlap')}</span>
                    <button onClick={() => nudge(i, STEP)} aria-label={t('stitchCutMore')}>
                      ▲
                    </button>
                    <button onClick={() => nudge(i, -STEP)} aria-label={t('stitchCutLess')}>
                      ▼
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Screen>
  )
}
