import { useEffect, useRef, useState } from 'react'
import { CropEditor } from '../components/CropEditor'
import { Icon } from '../components/Icon'
import { Empty, Screen } from '../components/ui'
import { createDoc, defaultDocName } from '../lib/db'
import { applyFilter, blobToCanvas, canvasToBlob, createCanvas, ctx2d, fullQuad, rotateCanvas, rotateQuad, warpPerspective, type Quad } from '../lib/image'
import { detectDocument } from '../lib/detect'
import { useApp } from '../state'

// ---------------------------------------------------------------- ID card (front + back on one A4 page)

const A4 = { w: 2480, h: 3508 } // 300 dpi
const CARD_MM = { w: 85.6, h: 53.98 } // ISO/IEC 7810 ID-1 (MyKad, bank cards, driving licences)
const PX_PER_MM = A4.w / 210

type Side = { src: HTMLCanvasElement; quad: Quad } | null

export function IdCardScreen() {
  const { t, pickFiles, setBusy, replace, toast } = useApp()
  const [sides, setSides] = useState<[Side, Side]>([null, null])
  const [editing, setEditing] = useState<0 | 1 | null>(null)

  const capture = (i: 0 | 1, camera: boolean) =>
    pickFiles({ accept: 'image/*', capture: camera }).then(async (f) => {
      if (!f.length) return
      const src = await blobToCanvas(f[0])
      const quad = detectDocument(src) ?? fullQuad(src.width, src.height)
      setSides((s) => (i === 0 ? [{ src, quad }, s[1]] : [s[0], { src, quad }]))
      setEditing(i)
    })

  const save = async () => {
    setBusy({ text: t('saving') })
    try {
      const page = createCanvas(A4.w, A4.h)
      const ctx = ctx2d(page)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, A4.w, A4.h)
      const cw = CARD_MM.w * PX_PER_MM
      const ch = CARD_MM.h * PX_PER_MM
      const present = sides.filter((s): s is NonNullable<Side> => !!s)
      present.forEach((s, i) => {
        let card = applyFilter(warpPerspective(s.src, s.quad, 1600), 'enhance')
        if (card.height > card.width) card = rotateCanvas(card, -90)
        const y = present.length === 1 ? (A4.h - ch) / 2 : A4.h * (i === 0 ? 0.3 : 0.7) - ch / 2
        ctx.drawImage(card, (A4.w - cw) / 2, y, cw, ch)
      })
      const doc = await createDoc(defaultDocName(t('tool.idCard')), [{ blob: await canvasToBlob(page, 'image/jpeg', 0.92), w: A4.w, h: A4.h }])
      toast(t('saved'))
      replace('doc', { id: doc.id })
    } catch (e) {
      console.error(e)
      toast(t('saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  if (editing != null && sides[editing]) {
    const s = sides[editing]!
    const set = (v: NonNullable<Side>) => setSides((cur) => (editing === 0 ? [v, cur[1]] : [cur[0], v]))
    return (
      <Screen
        title={editing === 0 ? t('cardFront') : t('cardBack')}
        className="dark-screen"
        onBack={() => setEditing(null)}
        footer={
          <div className="toolbar">
            <button onClick={() => set({ src: rotateCanvas(s.src, 90), quad: rotateQuad(s.quad, s.src.width, s.src.height, 90) })}>
              <Icon name="rotateR" />
              <span>{t('rotate')}</span>
            </button>
            <button onClick={() => set({ ...s, quad: fullQuad(s.src.width, s.src.height) })}>
              <Icon name="scan" />
              <span>{t('fullImage')}</span>
            </button>
            <button className="accent" onClick={() => setEditing(null)}>
              <Icon name="check" />
              <span>{t('done')}</span>
            </button>
          </div>
        }
      >
        <CropEditor src={s.src} quad={s.quad} onChange={(q) => set({ ...s, quad: q })} />
      </Screen>
    )
  }

  return (
    <Screen
      title={t('tool.idCard')}
      footer={
        <button className="btn primary block" disabled={!sides[0]} onClick={save}>
          <Icon name="check" /> {t('save')}
        </button>
      }
    >
      <div className="pad stack">
        <p className="muted">{t('idCardHint')}</p>
        {([0, 1] as const).map((i) => (
          <SideCard key={i} label={i === 0 ? t('cardFront') : t('cardBack')} side={sides[i]} onCamera={() => capture(i, true)} onAlbum={() => capture(i, false)} onEdit={() => setEditing(i)} />
        ))}
      </div>
    </Screen>
  )
}

function SideCard({ label, side, onCamera, onAlbum, onEdit }: { label: string; side: Side; onCamera: () => void; onAlbum: () => void; onEdit: () => void }) {
  const { t } = useApp()
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (side) setUrl(warpPerspective(side.src, side.quad, 600).toDataURL('image/jpeg', 0.8))
  }, [side])
  return (
    <div className="id-side">
      <div className="id-slot" onClick={side ? onEdit : onCamera}>
        {side && url ? <img src={url} alt="" /> : <Icon name="idcard" size={48} stroke={1.2} />}
        <span className="id-label">{label}</span>
      </div>
      <div className="row gap">
        <button className="btn soft grow" onClick={onCamera}>
          <Icon name="camera" /> {t('takePhoto')}
        </button>
        <button className="btn soft grow" onClick={onAlbum}>
          <Icon name="image" /> {t('album')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- ID photo

export const PHOTO_SIZES = [
  { id: 'my', mm: [35, 50], label: 'size.my' },
  { id: 'intl', mm: [35, 45], label: 'size.intl' },
  { id: 'us', mm: [51, 51], label: 'size.us' },
  { id: 'cn', mm: [33, 48], label: 'size.cn' },
  { id: '1in', mm: [25, 35], label: 'size.1in' },
  { id: '2in', mm: [35, 49], label: 'size.2in' },
] as const

export function IdPhotoScreen({ file }: { file: File }) {
  const { t, setBusy, replace, toast } = useApp()
  const [src, setSrc] = useState<HTMLCanvasElement>()
  const [sizeId, setSizeId] = useState<(typeof PHOTO_SIZES)[number]['id']>('my')
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 }) // centre offset in source px
  const [bg, setBg] = useState('#ffffff')
  const stageRef = useRef<HTMLDivElement>(null)
  const prevRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number; off: { x: number; y: number } } | null>(null)
  const size = PHOTO_SIZES.find((s) => s.id === sizeId)!
  const ratio = size.mm[0] / size.mm[1]

  useEffect(() => {
    blobToCanvas(file).then(setSrc)
  }, [file])

  /** Source rectangle that is visible in the frame. */
  const view = () => {
    if (!src) return { x: 0, y: 0, w: 1, h: 1 }
    let w = src.width
    let h = w / ratio
    if (h > src.height) {
      h = src.height
      w = h * ratio
    }
    w /= zoom
    h /= zoom
    return { x: src.width / 2 - w / 2 + off.x, y: src.height / 2 - h / 2 + off.y, w, h }
  }

  const render = (outW: number): HTMLCanvasElement => {
    const v = view()
    const outH = Math.round(outW / ratio)
    const c = createCanvas(outW, outH)
    const ctx = ctx2d(c)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, outW, outH)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src!, v.x, v.y, v.w, v.h, 0, 0, outW, outH)
    return c
  }

  useEffect(() => {
    const pc = prevRef.current
    if (!pc || !src) return
    const r = render(600)
    pc.width = r.width
    pc.height = r.height
    ctx2d(pc).drawImage(r, 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, zoom, off, sizeId, bg])

  const save = async () => {
    if (!src) return
    setBusy({ text: t('saving') })
    try {
      const dpmm = 300 / 25.4
      const single = render(Math.round(size.mm[0] * dpmm))
      // 4R (4x6 inch) print sheet with as many copies as fit, 2 mm gaps.
      const sheet = createCanvas(6 * 300, 4 * 300)
      const sctx = ctx2d(sheet)
      sctx.fillStyle = '#fff'
      sctx.fillRect(0, 0, sheet.width, sheet.height)
      const gap = 2 * dpmm
      const cols = Math.floor((sheet.width - gap) / (single.width + gap))
      const rows = Math.floor((sheet.height - gap) / (single.height + gap))
      const x0 = (sheet.width - (cols * single.width + (cols - 1) * gap)) / 2
      const y0 = (sheet.height - (rows * single.height + (rows - 1) * gap)) / 2
      sctx.strokeStyle = '#cccccc'
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const x = x0 + c * (single.width + gap)
          const y = y0 + r * (single.height + gap)
          sctx.drawImage(single, x, y)
          sctx.strokeRect(x, y, single.width, single.height)
        }
      const pages = [
        { blob: await canvasToBlob(single, 'image/jpeg', 0.95), w: single.width, h: single.height },
        { blob: await canvasToBlob(sheet, 'image/jpeg', 0.95), w: sheet.width, h: sheet.height },
      ]
      const d = await createDoc(defaultDocName(t('tool.idPhoto')), pages)
      toast(t('saved'))
      replace('doc', { id: d.id })
    } finally {
      setBusy(null)
    }
  }

  if (!src) return <Screen title={t('tool.idPhoto')}>{<Empty icon="idphoto" text={t('processing')} />}</Screen>

  return (
    <Screen
      title={t('tool.idPhoto')}
      footer={
        <button className="btn primary block" onClick={save}>
          <Icon name="check" /> {t('save')}
        </button>
      }
    >
      <div className="pad stack">
        <div
          ref={stageRef}
          className="idphoto-stage"
          style={{ aspectRatio: `${ratio}` }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, off }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            const r = stageRef.current!.getBoundingClientRect()
            const v = view()
            const k = v.w / r.width
            setOff({ x: d.off.x - (e.clientX - d.x) * k, y: d.off.y - (e.clientY - d.y) * k })
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <canvas ref={prevRef} />
          <svg className="face-guide" viewBox="0 0 100 140" preserveAspectRatio="none">
            <ellipse cx="50" cy="56" rx="24" ry="32" fill="none" stroke="rgba(255,255,255,.8)" strokeDasharray="3 3" strokeWidth="0.8" />
          </svg>
        </div>
        <p className="muted small center-text">{t('idPhotoHint')}</p>
        <label className="slider">
          <span>{t('zoom')}</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
        </label>
        <div className="chip-row">
          {PHOTO_SIZES.map((s) => (
            <button key={s.id} className={`chip ${s.id === sizeId ? 'on' : ''}`} onClick={() => setSizeId(s.id)}>
              {t(s.label)} · {s.mm[0]}×{s.mm[1]}mm
            </button>
          ))}
        </div>
        <div className="row gap">
          <span className="muted">{t('fillColor')}</span>
          {['#ffffff', '#4a90e2', '#d0021b', '#e8e8e8'].map((c) => (
            <button key={c} className={`swatch ${bg === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setBg(c)} aria-label={c} />
          ))}
        </div>
        <p className="muted small">{t('idPhotoNote')}</p>
      </div>
    </Screen>
  )
}
