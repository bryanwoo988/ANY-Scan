import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { DocRow, PageImg, Screen, Segmented } from '../components/ui'
import { createDoc, defaultDocName, getPage, getPages, replacePage, type PageRec } from '../lib/db'
import { buildDocx, safeFileName } from '../lib/export'
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../lib/image'
import { drawStamp } from '../lib/stamp'
import { DEFAULT_WM, detectRegions, drawWatermark, WM_STYLES, type Rect, type WmOptions, type WmPos } from '../lib/watermark'
import { PresetBar, StampContentForm, TemplatePicker, useStampOptions, useStampPrefs, type Place } from '../components/StampEditor'
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

type WmPrefs = Omit<WmOptions, 'text' | 'sub'> & { date: boolean }
const WM_KEY = 'anyscan.wmPrefs'
const DATE_LOCALE = { en: 'en-GB', zh: 'zh-CN', ms: 'ms-MY' } as const

/** Bounding box of `rs` with a margin, kept inside a w×h canvas. */
function around(rs: Rect[], w: number, h: number): Rect {
  const x0 = Math.min(...rs.map((r) => r.x))
  const y0 = Math.min(...rs.map((r) => r.y))
  const x1 = Math.max(...rs.map((r) => r.x + r.w))
  const y1 = Math.max(...rs.map((r) => r.y + r.h))
  const m = Math.max(x1 - x0, y1 - y0) * 0.08
  const x = Math.max(0, x0 - m)
  const y = Math.max(0, y0 - m)
  return { x, y, w: Math.min(w, x1 + m) - x, h: Math.min(h, y1 + m) - y }
}

/** Draws `base` (cropped to `crop`, scaled to `width`) with the watermark into `out`. */
function renderWm(out: HTMLCanvasElement, base: HTMLCanvasElement, crop: Rect, regions: Rect[], o: WmOptions, width: number) {
  const s = width / crop.w
  out.width = Math.round(crop.w * s)
  out.height = Math.round(crop.h * s)
  ctx2d(out).drawImage(base, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height)
  const rs = regions.map((r) => ({ x: (r.x - crop.x) * s, y: (r.y - crop.y) * s, w: r.w * s, h: r.h * s }))
  drawWatermark(out, { ...o, area: o.area === 'content' && rs.length ? 'content' : 'page' }, rs)
}

function StyleCard({ base, crop, regions, o, label, on, onClick }: { base: HTMLCanvasElement; crop: Rect; regions: Rect[]; o: WmOptions; label: string; on: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) renderWm(ref.current, base, crop, regions, { ...o, opacity: Math.max(o.opacity, 0.6) }, 240)
  }, [base, crop, regions, o])
  return (
    <button className={`wm-style ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      <canvas ref={ref} />
      <span>{label}</span>
    </button>
  )
}

export function WatermarkScreen({ docId }: { docId: string }) {
  const { t, lang, setBusy, replace, toast } = useApp()
  const doc = useDoc(docId)
  const [text, setText] = useState(() => loadJSON('anyscan.wmText', ''))
  const [prefs, setPrefs] = useState<WmPrefs>(() => ({ ...DEFAULT_WM, date: false, ...loadJSON<Partial<WmPrefs>>(WM_KEY, {}) }))
  const update = (p: Partial<WmPrefs>) => setPrefs((x) => ({ ...x, ...p }))
  const [base, setBase] = useState<HTMLCanvasElement>()
  const prevRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (doc?.pageIds[0]) getPage(doc.pageIds[0]).then((p) => p && blobToCanvas(p.blob, 900).then(setBase))
  }, [doc])
  const regions = useMemo(() => (base ? detectRegions(base) : []), [base])
  const onContent = prefs.area === 'content' && regions.length > 0
  // Zoom the previews in on the cards when that's where the watermark goes.
  const crop = useMemo(() => (base ? (onContent ? around(regions, base.width, base.height) : { x: 0, y: 0, w: base.width, h: base.height }) : null), [base, regions, onContent])
  // Thumbnails show just the first card so the style is readable at that size.
  const thumb = useMemo(() => (base && onContent ? { crop: around(regions.slice(0, 1), base.width, base.height), regions: regions.slice(0, 1) } : { crop, regions }), [base, onContent, regions, crop])
  const sub = prefs.date ? new Date().toLocaleDateString(DATE_LOCALE[lang]) : undefined
  const opts: WmOptions = { ...prefs, text: text || t('watermarkSample'), sub }

  useEffect(() => {
    if (prevRef.current && base && crop) renderWm(prevRef.current, base, crop, regions, opts, 900)
  })

  if (!doc) return <Screen title={t('tool.watermark')}>{null}</Screen>
  const positions: WmPos[] = prefs.style === 'stamp' ? ['tl', 'tr', 'c', 'bl', 'br'] : ['tl', 'tr', 'bl', 'br']
  const arrows: Record<WmPos, string> = { tl: '↖', tr: '↗', c: '●', bl: '↙', br: '↘' }

  return (
    <Screen
      title={t('tool.watermark')}
      footer={
        <button
          className="btn primary block"
          disabled={!text.trim()}
          onClick={async () => {
            saveJSON('anyscan.wmText', text)
            saveJSON(WM_KEY, prefs)
            setBusy({ text: t('processing') })
            try {
              const pages = await getPages(doc)
              const out = []
              for (const p of pages) {
                const c = await blobToCanvas(p.blob, 10000)
                // Each page finds its own cards/photos.
                drawWatermark(c, { ...opts, text })
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
        <div className="preview-box wm-preview">
          <canvas ref={prevRef} />
        </div>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('watermarkPlaceholder')} maxLength={60} />
        <div className="field-label">{t('wmStyle')}</div>
        <div className="wm-styles">
          {base &&
            crop &&
            WM_STYLES.map((st) => (
              <StyleCard key={st} base={base} crop={thumb.crop!} regions={thumb.regions} o={{ ...opts, style: st }} label={t(`wm.${st}`)} on={prefs.style === st} onClick={() => update({ style: st })} />
            ))}
        </div>
        {regions.length > 0 && (
          <Segmented
            value={prefs.area}
            onChange={(area) => update({ area })}
            options={[
              { value: 'content', label: t('wmOnContent', { n: regions.length }) },
              { value: 'page', label: t('wmWholePage') },
            ]}
          />
        )}
        {(prefs.style === 'corner' || prefs.style === 'stamp') && (
          <>
            <div className="row gap wm-pos" role="radiogroup" aria-label={t('position')}>
              {positions.map((p) => (
                <button key={p} role="radio" aria-checked={prefs.pos === p} className={`chip ${prefs.pos === p ? 'on' : ''}`} onClick={() => update({ pos: p })} aria-label={p === 'c' ? t('wmCentre') : t(`pos.${p}`)}>
                  {arrows[p]}
                </button>
              ))}
            </div>
            <label className="slider">
              <span>{t('angle')}</span>
              <input type="range" min={-45} max={45} step={1} value={prefs.angle} onChange={(e) => update({ angle: +e.target.value })} />
            </label>
          </>
        )}
        <div className="row gap">
          {['#808080', '#e53935', '#1e63d6', '#111111', '#2fbf8f'].map((c) => (
            <button key={c} className={`swatch ${prefs.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => update({ color: c })} aria-label={c} />
          ))}
        </div>
        <label className="slider">
          <span>{t('opacity')}</span>
          <input type="range" min={0.08} max={0.9} step={0.02} value={prefs.opacity} onChange={(e) => update({ opacity: +e.target.value })} />
        </label>
        <label className="slider">
          <span>{t('textSize')}</span>
          <input type="range" min={15} max={100} value={prefs.size} onChange={(e) => update({ size: +e.target.value })} />
        </label>
        <label className="switch-row">
          <span>{t('wmAddDate')}</span>
          <input type="checkbox" className="switch" checked={prefs.date} onChange={(e) => update({ date: e.target.checked })} />
        </label>
      </div>
    </Screen>
  )
}

// ---------------------------------------------------------------- Timestamp

export function TimestampScreen({ file }: { file: File }) {
  const { t, setBusy, replace, toast } = useApp()
  const [base, setBase] = useState<HTMLCanvasElement>()
  const [when, setWhen] = useState(() => new Date(file.lastModified || Date.now()))
  const { prefs, update, presetId, choosePreset } = useStampPrefs()
  // A photo from the album may be old, so its location is only added when the user asks.
  const [place, setPlace] = useState<Place | null>(null)
  const [panel, setPanel] = useState<'templates' | 'content'>('templates')
  const prevRef = useRef<HTMLCanvasElement>(null)
  const options = useStampOptions(prefs, place)

  useEffect(() => {
    blobToCanvas(file).then(setBase)
  }, [file])

  useEffect(() => {
    const pc = prevRef.current
    if (!pc || !base) return
    const s = Math.min(1, 1200 / Math.max(base.width, base.height))
    pc.width = Math.round(base.width * s)
    pc.height = Math.round(base.height * s)
    ctx2d(pc).drawImage(base, 0, 0, pc.width, pc.height)
    drawStamp(pc, options(when))
  }, [base, when, options])

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
              drawStamp(c, options(when))
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
          <>
            <PresetBar prefs={prefs} presetId={presetId} choosePreset={choosePreset} />
            <TemplatePicker prefs={prefs} update={update} options={options} when={when} />
          </>
        ) : (
          <StampContentForm prefs={prefs} update={update} place={place} setPlace={setPlace} when={when} setWhen={setWhen} />
        )}
      </div>
    </Screen>
  )
}
