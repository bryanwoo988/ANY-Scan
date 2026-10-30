import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { DocRow, PageImg, Screen, Segmented } from '../components/ui'
import { createDoc, defaultDocName, getPage, getPages, replacePage, type PageRec } from '../lib/db'
import { buildDocx, safeFileName } from '../lib/export'
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d, scaleCanvas } from '../lib/image'
import { drawStamp, STAMP_TEMPLATES, type StampOptions, type StampPos, type StampTemplate } from '../lib/stamp'
import { OCR_LANGS, recognize, type OcrLang } from '../lib/ocr'
import { loadJSON, saveJSON } from '../lib/settings'
import { copyText, shareOrDownload } from '../lib/share'
import { useApp } from '../state'
import { useDoc } from './Doc'

const OCR_LANG_LABEL: Record<OcrLang, string> = { eng: 'English', msa: 'Bahasa Melayu', chi_sim: '简体中文', chi_tra: '繁體中文' }

export function OcrScreen({ docId, pageIds, docx, files }: { docId?: string; pageIds?: string[]; docx?: boolean; files?: File[] }) {
  const { t, lang, toast, pickFiles, setTab, home } = useApp()
  const doc = useDoc(docId)
  const [langs, setLangs] = useState<OcrLang[]>(() => loadJSON<OcrLang[]>('anyscan.ocrLangs', lang === 'zh' ? ['eng', 'chi_sim'] : lang === 'ms' ? ['eng', 'msa'] : ['eng']))
  const [images, setImages] = useState<Blob[] | null>(files?.length ? files : null)
  const [text, setText] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ p: number; s: string } | null>(null)

  useEffect(() => {
    if (!doc) return
    getPages(doc).then((ps) => setImages(ps.filter((p) => !pageIds || pageIds.includes(p.id)).map((p) => p.blob)))
  }, [doc, pageIds])

  const run = async () => {
    if (!images?.length || !langs.length) return
    saveJSON('anyscan.ocrLangs', langs)
    setText(null)
    setProgress({ p: 0, s: '' })
    try {
      const out = await recognize(images, langs, (p, s) => setProgress({ p, s }))
      setText(out)
    } catch (e) {
      console.error(e)
      toast(t('ocrFailed'))
    } finally {
      setProgress(null)
    }
  }

  const name = safeFileName(doc?.name ?? defaultDocName())

  return (
    <Screen
      title={docx ? t('tool.toWord') : t('tool.ocr')}
      footer={
        text != null ? (
          <div className="toolbar">
            <button onClick={() => copyText(text).then(() => toast(t('copied')))}>
              <Icon name="copy" />
              <span>{t('copy')}</span>
            </button>
            <button onClick={() => shareOrDownload([{ blob: new Blob([text], { type: 'text/plain' }), name: `${name}.txt` }])}>
              <Icon name="text" />
              <span>TXT</span>
            </button>
            <button className="accent" onClick={() => shareOrDownload([{ blob: buildDocx(text), name: `${name}.docx` }])}>
              <Icon name="word" />
              <span>Word</span>
            </button>
          </div>
        ) : (
          <button className="btn primary block" disabled={!images?.length || !langs.length || !!progress} onClick={run}>
            <Icon name="text" /> {t('recognize')}
          </button>
        )
      }
    >
      <div className="pad stack">
        {doc ? (
          <DocRow doc={doc} onClick={() => {}} />
        ) : (
          <div className="row gap">
            <button className="btn soft grow" onClick={() => pickFiles({ accept: 'image/*', capture: true }).then((f) => f.length && setImages(f))}>
              <Icon name="camera" /> {t('takePhoto')}
            </button>
            <button className="btn soft grow" onClick={() => pickFiles({ accept: 'image/*', multiple: true }).then((f) => f.length && setImages(f))}>
              <Icon name="image" /> {t('chooseImages')}
            </button>
          </div>
        )}
        {!doc && images && <p className="muted">{t('nImages', { n: images.length })}</p>}
        {!doc && !images && (
          <button className="btn ghost block" onClick={() => { home(); setTab('docs') }}>
            {t('ocrFromDocHint')}
          </button>
        )}
        <div className="field">
          <label>{t('ocrLanguages')}</label>
          <div className="chip-row">
            {OCR_LANGS.map((l) => (
              <button key={l} className={`chip ${langs.includes(l) ? 'on' : ''}`} onClick={() => setLangs((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]))}>
                {OCR_LANG_LABEL[l]}
              </button>
            ))}
          </div>
          <p className="muted small">{t('ocrNote')}</p>
        </div>
        {progress && (
          <div className="stack-sm">
            <div className="progress">
              <div style={{ width: `${Math.round(progress.p * 100)}%` }} />
            </div>
            <p className="muted small">{progress.s.startsWith('recognizing') ? t('recognizing') : t('loadingModel')}</p>
          </div>
        )}
        {text != null && (
          <div className="field">
            <label>{t('result')}</label>
            <textarea className="input textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('noTextFound')} />
            <button className="btn ghost sm" onClick={run}>
              {t('recognizeAgain')}
            </button>
          </div>
        )}
      </div>
    </Screen>
  )
}

// ---------------------------------------------------------------- Signature

const SIG_KEY = 'anyscan.signatures'

function SignaturePad({ onDone, onCancel }: { onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const { t } = useApp()
  const ref = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#111111')
  const [empty, setEmpty] = useState(true)
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    c.width = r.width * 2
    c.height = r.height * 2
  }, [])

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2 }
  }

  return createPortal(
    <div className="sheet-backdrop">
      <div className="sig-pad">
        <div className="sig-head">
          <button className="btn ghost sm" onClick={onCancel}>
            {t('cancel')}
          </button>
          <div className="row gap-sm">
            {['#111111', '#1f4fd1', '#c62828'].map((c) => (
              <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
          <button
            className="btn ghost sm"
            onClick={() => {
              const c = ref.current!
              ctx2d(c).clearRect(0, 0, c.width, c.height)
              setEmpty(true)
            }}
          >
            {t('clear')}
          </button>
        </div>
        <canvas
          ref={ref}
          className="sig-canvas"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            last.current = pos(e)
          }}
          onPointerMove={(e) => {
            if (!last.current) return
            const p = pos(e)
            const ctx = ctx2d(ref.current!)
            ctx.strokeStyle = color
            ctx.lineWidth = 7
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.beginPath()
            ctx.moveTo(last.current.x, last.current.y)
            ctx.lineTo(p.x, p.y)
            ctx.stroke()
            last.current = p
            setEmpty(false)
          }}
          onPointerUp={() => (last.current = null)}
        />
        <p className="muted small center-text">{t('signHere')}</p>
        <button
          className="btn primary block"
          disabled={empty}
          onClick={() => {
            // Trim to the drawn area.
            const c = ref.current!
            const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data
            let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0
            for (let y = 0; y < c.height; y++)
              for (let x = 0; x < c.width; x++)
                if (d[(y * c.width + x) * 4 + 3] > 0) {
                  if (x < x0) x0 = x
                  if (x > x1) x1 = x
                  if (y < y0) y0 = y
                  if (y > y1) y1 = y
                }
            const pad = 8
            const out = createCanvas(x1 - x0 + pad * 2, y1 - y0 + pad * 2)
            ctx2d(out).drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height)
            onDone(out.toDataURL('image/png'))
          }}
        >
          {t('done')}
        </button>
      </div>
    </div>,
    document.body,
  )
}

export function SignScreen({ docId }: { docId: string }) {
  const { t, setBusy, toast, back } = useApp()
  const doc = useDoc(docId)
  const [sigs, setSigs] = useState<string[]>(() => loadJSON<string[]>(SIG_KEY, []))
  const [pad, setPad] = useState(false)
  const [pageIdx, setPageIdx] = useState(0)
  const [sig, setSig] = useState<string | null>(null)
  // Signature box in page-relative units (0..1).
  const [box, setBox] = useState({ x: 0.55, y: 0.78, w: 0.32 })
  const [sigRatio, setSigRatio] = useState(0.4)
  const [page, setPage] = useState<PageRec>()
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ mode: 'move' | 'size'; sx: number; sy: number; box: typeof box } | null>(null)

  const pid = doc?.pageIds[pageIdx]
  useEffect(() => {
    if (pid) getPage(pid).then(setPage)
  }, [pid, doc?.updatedAt])

  useEffect(() => {
    if (!sig) return
    const img = new Image()
    img.onload = () => setSigRatio(img.height / img.width)
    img.src = sig
  }, [sig])

  if (!doc) return <Screen title={t('tool.sign')}>{null}</Screen>
  const pageRatio = page ? page.h / page.w : 1.414

  const onDown = (mode: 'move' | 'size') => (e: React.PointerEvent) => {
    e.stopPropagation()
    stageRef.current!.setPointerCapture(e.pointerId)
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, box }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const r = stageRef.current!.getBoundingClientRect()
    const dx = (e.clientX - d.sx) / r.width
    const dy = (e.clientY - d.sy) / r.height
    if (d.mode === 'move') setBox({ ...d.box, x: Math.min(1 - d.box.w, Math.max(0, d.box.x + dx)), y: Math.min(0.98, Math.max(0, d.box.y + dy)) })
    else setBox({ ...d.box, w: Math.min(1 - d.box.x, Math.max(0.08, d.box.w + dx)) })
  }

  const apply = async () => {
    if (!sig || !page || !pid) return
    setBusy({ text: t('processing') })
    try {
      const c = await blobToCanvas(page.blob, 10000)
      const img = new Image()
      await new Promise((res) => ((img.onload = res), (img.src = sig)))
      const w = box.w * c.width
      ctx2d(c).drawImage(img, box.x * c.width, box.y * c.height, w, w * sigRatio)
      await replacePage(docId, pid, { blob: await canvasToBlob(c, 'image/jpeg', 0.92), w: c.width, h: c.height })
      toast(t('saved'))
      setSig(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen
      title={t('tool.sign')}
      right={
        <button className="btn ghost sm" onClick={back}>
          {t('done')}
        </button>
      }
      footer={
        sig ? (
          <div className="row gap">
            <button className="btn ghost grow" onClick={() => setSig(null)}>
              {t('cancel')}
            </button>
            <button className="btn primary grow" onClick={apply}>
              <Icon name="check" /> {t('applyToPage', { n: pageIdx + 1 })}
            </button>
          </div>
        ) : (
          <div className="stack-sm">
            <div className="strip">
              {sigs.map((s, i) => (
                <div key={i} className="sig-chip">
                  <button onClick={() => setSig(s)}>
                    <img src={s} alt="" />
                  </button>
                  <button
                    className="sig-del"
                    aria-label={t('delete')}
                    onClick={() => {
                      const n = sigs.filter((_, j) => j !== i)
                      setSigs(n)
                      saveJSON(SIG_KEY, n)
                    }}
                  >
                    <Icon name="close" size={12} stroke={3} />
                  </button>
                </div>
              ))}
              <button className="sig-chip add" onClick={() => setPad(true)}>
                <Icon name="plus" />
                <span>{t('newSignature')}</span>
              </button>
            </div>
            <p className="muted small center-text">{t('signPickHint')}</p>
          </div>
        )
      }
    >
      <div className="pad">
        {doc.pageIds.length > 1 && (
          <div className="strip pages">
            {doc.pageIds.map((p, i) => (
              <button key={p} className={`page-chip ${i === pageIdx ? 'on' : ''}`} onClick={() => setPageIdx(i)}>
                <PageImg pageId={p} key={`${p}-${doc.updatedAt}`} />
                <span className="page-num">{i + 1}</span>
              </button>
            ))}
          </div>
        )}
        <div className="sign-stage-wrap">
          <div ref={stageRef} className="sign-stage" style={{ aspectRatio: `1 / ${pageRatio}` }} onPointerMove={onMove} onPointerUp={() => (dragRef.current = null)}>
            {pid && <PageImg pageId={pid} key={`${pid}-${doc.updatedAt}`} />}
            {sig && (
              <div className="sig-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, aspectRatio: `1 / ${sigRatio}` }} onPointerDown={onDown('move')}>
                <img src={sig} alt="" draggable={false} />
                <span className="sig-handle" onPointerDown={onDown('size')} />
              </div>
            )}
          </div>
        </div>
      </div>
      {pad && (
        <SignaturePad
          onCancel={() => setPad(false)}
          onDone={(s) => {
            const n = [s, ...sigs].slice(0, 6)
            setSigs(n)
            saveJSON(SIG_KEY, n)
            setSig(s)
            setPad(false)
          }}
        />
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------- Watermark

export function drawWatermark(c: HTMLCanvasElement, text: string, o: { color: string; opacity: number; size: number; tiled: boolean }) {
  const ctx = ctx2d(c)
  const fs = Math.max(10, (o.size / 100) * Math.min(c.width, c.height) * 0.12)
  ctx.save()
  ctx.globalAlpha = o.opacity
  ctx.fillStyle = o.color
  ctx.font = `600 ${fs}px -apple-system, "PingFang SC", "Noto Sans", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (o.tiled) {
    ctx.translate(c.width / 2, c.height / 2)
    ctx.rotate(-Math.PI / 6)
    const tw = ctx.measureText(text).width + fs * 2
    const th = fs * 3.2
    const span = Math.hypot(c.width, c.height)
    let row = 0
    for (let y = -span / 2; y < span / 2; y += th, row++)
      for (let x = -span / 2 + (row % 2 ? tw / 2 : 0); x < span / 2; x += tw) ctx.fillText(text, x, y)
  } else {
    ctx.translate(c.width / 2, c.height / 2)
    ctx.rotate(-Math.PI / 6)
    ctx.fillText(text, 0, 0)
  }
  ctx.restore()
}

export function WatermarkScreen({ docId }: { docId: string }) {
  const { t, setBusy, replace, toast } = useApp()
  const doc = useDoc(docId)
  const [text, setText] = useState(() => loadJSON('anyscan.wmText', ''))
  const [color, setColor] = useState('#808080')
  const [opacity, setOpacity] = useState(0.3)
  const [size, setSize] = useState(50)
  const [tiled, setTiled] = useState(true)
  const [base, setBase] = useState<HTMLCanvasElement>()
  const prevRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (doc?.pageIds[0]) getPage(doc.pageIds[0]).then((p) => p && blobToCanvas(p.blob, 900).then(setBase))
  }, [doc])

  useEffect(() => {
    const pc = prevRef.current
    if (!pc || !base) return
    pc.width = base.width
    pc.height = base.height
    ctx2d(pc).drawImage(base, 0, 0)
    if (text) drawWatermark(pc, text, { color, opacity, size, tiled })
  }, [base, text, color, opacity, size, tiled])

  if (!doc) return <Screen title={t('tool.watermark')}>{null}</Screen>

  return (
    <Screen
      title={t('tool.watermark')}
      footer={
        <button
          className="btn primary block"
          disabled={!text.trim()}
          onClick={async () => {
            saveJSON('anyscan.wmText', text)
            setBusy({ text: t('processing') })
            try {
              const pages = await getPages(doc)
              const out = []
              for (const p of pages) {
                const c = await blobToCanvas(p.blob, 10000)
                drawWatermark(c, text, { color, opacity, size, tiled })
                out.push({ blob: await canvasToBlob(c, 'image/jpeg', 0.92), w: c.width, h: c.height })
              }
              const d = await createDoc(`${doc.name} (${t('tool.watermark')})`, out)
              toast(t('savedAsCopy'))
              replace('doc', { id: d.id })
            } finally {
              setBusy(null)
            }
          }}
        >
          <Icon name="check" /> {t('applyAll')}
        </button>
      }
    >
      <div className="pad stack">
        <div className="preview-box">
          <canvas ref={prevRef} />
        </div>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('watermarkPlaceholder')} maxLength={60} />
        <div className="row gap">
          {['#808080', '#e53935', '#1e63d6', '#111111', '#2fbf8f'].map((c) => (
            <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <label className="slider">
          <span>{t('opacity')}</span>
          <input type="range" min={0.08} max={0.9} step={0.02} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
        </label>
        <label className="slider">
          <span>{t('textSize')}</span>
          <input type="range" min={15} max={100} value={size} onChange={(e) => setSize(+e.target.value)} />
        </label>
        <label className="switch-row">
          <span>{t('tiled')}</span>
          <input type="checkbox" className="switch" checked={tiled} onChange={(e) => setTiled(e.target.checked)} />
        </label>
      </div>
    </Screen>
  )
}

// ---------------------------------------------------------------- Timestamp

interface StampPrefs {
  template: StampTemplate
  hour24: boolean
  showDate: boolean
  location: string
  note: string
  brand: string
  logo: string | null // data URL
  pos: StampPos
  size: number
}
const STAMP_KEY = 'anyscan.timestamp'
const STAMP_DEFAULTS: StampPrefs = { template: 'timeLocation', hour24: false, showDate: true, location: '', note: '', brand: '', logo: null, pos: 'bl', size: 1 }

/** Downscales a picked logo so it fits comfortably in local storage. */
async function logoDataUrl(f: File): Promise<string> {
  const c = scaleCanvas(await blobToCanvas(f, 2000), 256)
  return c.toDataURL('image/png')
}

/** Place name for the current position via OpenStreetMap; coordinates if that fails. */
async function currentPlace(lang: string): Promise<string> {
  const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 }))
  const { latitude: lat, longitude: lon } = pos.coords
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lon}&accept-language=${lang}`)
    const j = (await r.json()) as { name?: string; address?: Record<string, string> }
    const a = j.address ?? {}
    const parts = [j.name, a.road, a.suburb ?? a.neighbourhood, a.city ?? a.town ?? a.village ?? a.state].filter((x, i, arr) => x && arr.indexOf(x) === i)
    return parts.slice(0, 3).join(', ') || coords
  } catch {
    return coords
  }
}

function useLogo(dataUrl: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!dataUrl) return setImg(null)
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = dataUrl
  }, [dataUrl])
  return img
}

const SAMPLE_BG = (() => {
  let c: HTMLCanvasElement | null = null
  return () => {
    if (c) return c
    c = createCanvas(480, 360)
    const x = ctx2d(c)
    const g = x.createLinearGradient(0, 0, 480, 360)
    g.addColorStop(0, '#3b4a5c')
    g.addColorStop(1, '#1d242e')
    x.fillStyle = g
    x.fillRect(0, 0, 480, 360)
    return c
  }
})()

function TemplateThumb({ opts, on, label, onClick }: { opts: StampOptions; on: boolean; label: string; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = 480
    c.height = 360
    ctx2d(c).drawImage(SAMPLE_BG(), 0, 0)
    drawStamp(c, { ...opts, pos: 'tl', size: 1.5 })
  }, [opts])
  return (
    <button className={`stamp-tpl ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      <canvas ref={ref} />
      <span>{label}</span>
    </button>
  )
}

export function TimestampScreen({ file }: { file: File }) {
  const { t, lang, setBusy, replace, toast, pickFiles } = useApp()
  const [base, setBase] = useState<HTMLCanvasElement>()
  const [when, setWhen] = useState(() => new Date(file.lastModified || Date.now()))
  const [prefs, setPrefs] = useState<StampPrefs>(() => ({ ...STAMP_DEFAULTS, ...loadJSON<Partial<StampPrefs>>(STAMP_KEY, {}) }))
  const [panel, setPanel] = useState<'templates' | 'content'>('templates')
  const [locating, setLocating] = useState(false)
  const prevRef = useRef<HTMLCanvasElement>(null)
  const logo = useLogo(prefs.logo)

  const update = (p: Partial<StampPrefs>) =>
    setPrefs((s) => {
      const n = { ...s, ...p }
      saveJSON(STAMP_KEY, n)
      return n
    })

  useEffect(() => {
    blobToCanvas(file).then(setBase)
  }, [file])

  const opts = (template: StampTemplate = prefs.template): StampOptions => ({
    ...prefs,
    template,
    when,
    logo,
    locale: lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-GB',
    labels: { onSite: t('ts.onSite'), clockIn: t('ts.clockIn'), time: t('ts.time'), location: t('ts.location'), note: t('ts.note') },
  })

  useEffect(() => {
    const pc = prevRef.current
    if (!pc || !base) return
    const s = Math.min(1, 1200 / Math.max(base.width, base.height))
    pc.width = Math.round(base.width * s)
    pc.height = Math.round(base.height * s)
    ctx2d(pc).drawImage(base, 0, 0, pc.width, pc.height)
    drawStamp(pc, opts())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, when, prefs, logo, lang])

  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19)

  return (
    <Screen
      title={t('tool.timestamp')}
      right={
        <button
          className="btn primary sm"
          disabled={!base}
          onClick={async () => {
            if (!base) return
            setBusy({ text: t('saving') })
            try {
              const c = createCanvas(base.width, base.height)
              ctx2d(c).drawImage(base, 0, 0)
              drawStamp(c, opts())
              const d = await createDoc(defaultDocName(t('tool.timestamp')), [{ blob: await canvasToBlob(c, 'image/jpeg', 0.92), w: c.width, h: c.height }])
              toast(t('saved'))
              replace('doc', { id: d.id })
            } finally {
              setBusy(null)
            }
          }}
        >
          <Icon name="check" size={18} /> {t('save')}
        </button>
      }
    >
      <div className="stamp-preview">
        <canvas ref={prevRef} />
      </div>
      <div className="stamp-panel">
        <Segmented
          value={panel}
          onChange={setPanel}
          options={[
            { value: 'templates', label: t('ts.templates') },
            { value: 'content', label: t('ts.content') },
          ]}
        />
        {panel === 'templates' ? (
          <div className="stamp-tpl-grid">
            {STAMP_TEMPLATES.map((tp) => (
              // Previews show a sample location when none is set, so every template's layout is visible.
              <TemplateThumb key={tp} opts={{ ...opts(tp), location: prefs.location || t('ts.sampleLocation') }} on={prefs.template === tp} label={t(`ts.tpl.${tp}`)} onClick={() => update({ template: tp })} />
            ))}
          </div>
        ) : (
          <div className="stack">
            <label className="field">
              <span>{t('dateTime')}</span>
              <input className="input" type="datetime-local" step={1} value={local(when)} onChange={(e) => e.target.value && setWhen(new Date(e.target.value))} />
            </label>
            <div className="row gap wrap">
              <label className="switch-row grow">
                <span>{t('ts.hour24')}</span>
                <input type="checkbox" className="switch" checked={prefs.hour24} onChange={(e) => update({ hour24: e.target.checked })} />
              </label>
              <label className="switch-row grow">
                <span>{t('ts.showDate')}</span>
                <input type="checkbox" className="switch" checked={prefs.showDate} onChange={(e) => update({ showDate: e.target.checked })} />
              </label>
            </div>
            <label className="field">
              <span>{t('ts.location')}</span>
              <input className="input" value={prefs.location} maxLength={80} placeholder={t('ts.locationPlaceholder')} onChange={(e) => update({ location: e.target.value })} />
            </label>
            <button
              className="btn soft"
              disabled={locating || !navigator.geolocation}
              onClick={async () => {
                setLocating(true)
                try {
                  update({ location: await currentPlace(lang === 'zh' ? 'zh' : lang) })
                } catch {
                  toast(t('ts.locationFailed'))
                } finally {
                  setLocating(false)
                }
              }}
            >
              <Icon name="globe" size={18} /> {locating ? t('ts.locating') : t('ts.useLocation')}
            </button>
            <p className="muted small">{t('ts.locationNote')}</p>
            <label className="field">
              <span>{t('ts.note')}</span>
              <input className="input" value={prefs.note} maxLength={80} placeholder={t('ts.notePlaceholder')} onChange={(e) => update({ note: e.target.value })} />
            </label>
            <div className="field">
              <span>{t('ts.myWatermark')}</span>
              <input className="input" value={prefs.brand} maxLength={50} placeholder={t('ts.brandPlaceholder')} onChange={(e) => update({ brand: e.target.value })} />
              <div className="row gap">
                {prefs.logo && <img src={prefs.logo} alt="" className="stamp-logo" />}
                <button
                  className="btn soft grow"
                  onClick={() =>
                    pickFiles({ accept: 'image/*' }).then(async (f) => {
                      if (f.length) update({ logo: await logoDataUrl(f[0]) })
                    })
                  }
                >
                  <Icon name="image" size={18} /> {prefs.logo ? t('ts.changeLogo') : t('ts.addLogo')}
                </button>
                {prefs.logo && (
                  <button className="btn ghost" onClick={() => update({ logo: null })}>
                    {t('delete')}
                  </button>
                )}
              </div>
            </div>
            <div className="field">
              <span>{t('ts.position')}</span>
              <div className="chip-row">
                {(['tl', 'tr', 'bl', 'br'] as const).map((p) => (
                  <button key={p} className={`chip ${prefs.pos === p ? 'on' : ''}`} onClick={() => update({ pos: p })}>
                    {t(`pos.${p}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className="slider">
              <span>{t('textSize')}</span>
              <input type="range" min={0.6} max={1.6} step={0.05} value={prefs.size} onChange={(e) => update({ size: +e.target.value })} />
            </label>
          </div>
        )}
      </div>
    </Screen>
  )
}
