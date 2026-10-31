import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CropEditor } from '../components/CropEditor'
import { Icon } from '../components/Icon'
import { ZoomView } from '../components/ZoomView'
import { Screen } from '../components/ui'
import { addPages, createDoc, defaultDocName, type NewPage } from '../lib/db'
import {
  applyFilter, blobToCanvas, canvasToBlob, FILTERS, fullQuad, rotateCanvas, rotateQuad,
  warpPerspective, type FilterName, type Quad,
} from '../lib/image'
import { detectDocument, quadAspect, sidesOnFrame } from '../lib/detect'
import { useApp } from '../state'

export interface ScanItem {
  id: number
  src: HTMLCanvasElement
  quad: Quad
  auto: boolean
  filter: FilterName
}

let itemId = 1

type Detector = (src: HTMLCanvasElement) => Quad | null

/**
 * Edge detection for a scan tool. Mega Scan results are mostly the thing itself (detection would
 * only find something inside). Slides and whiteboards often fill the picture: a box found along
 * the picture's edges is then a part of them, so the whole picture is kept instead.
 */
function detectorFor(kind?: ScanKind): Detector | null {
  if (kind === 'mega') return null
  if (kind !== 'slides' && kind !== 'whiteboard') return detectDocument
  return (src) => {
    const q = detectDocument(src)
    return q && looksPartial(q, src.width, src.height) ? null : q
  }
}

/** A box along two picture edges, or a strip (a title bar alone), is only part of a slide or board. */
function looksPartial(q: Quad, w: number, h: number): boolean {
  return sidesOnFrame(q, w, h) >= 2 || quadAspect(q) > 5
}

/**
 * `hints`: the outline the camera showed when each photo was taken (normalised 0..1). It is used
 * when detection on the full photo finds nothing, so what the user saw is what gets cropped.
 */
export async function filesToItems(files: File[], filter: FilterName, detect: boolean | Detector = true, hints?: (Quad | null)[], maxSide?: number): Promise<ScanItem[]> {
  const find: Detector | null = detect === true ? detectDocument : detect || null
  const out: ScanItem[] = []
  for (const [i, f] of files.entries()) {
    const src = await blobToCanvas(f, maxSide)
    const hint = hints?.[i]
    const q = find?.(src) ?? (hint ? (hint.map((p) => ({ x: p.x * src.width, y: p.y * src.height })) as Quad) : null)
    out.push({ id: itemId++, src, quad: q ?? fullQuad(src.width, src.height), auto: !!q, filter })
  }
  return out
}

export async function renderItem(it: ScanItem, maxSide?: number): Promise<HTMLCanvasElement> {
  return applyFilter(warpPerspective(it.src, it.quad, maxSide), it.filter)
}

export async function itemToPage(it: ScanItem, maxSide?: number): Promise<NewPage> {
  const c = await renderItem(it, maxSide)
  return { blob: await canvasToBlob(c, 'image/jpeg', 0.9), w: c.width, h: c.height }
}

/** Small rendered preview of a scan item for the filter strip and page strip. */
function usePreview(it: ScanItem | undefined, filter: FilterName | undefined, side: number, deps: unknown[]): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!it) return
    let alive = true
    const h = window.setTimeout(() => {
      const c = applyFilter(warpPerspective(it.src, it.quad, side), filter ?? it.filter)
      if (alive) setUrl(c.toDataURL('image/jpeg', 0.8))
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return url
}

function FilterChip({ it, f, on, onClick, label }: { it: ScanItem; f: FilterName; on: boolean; onClick: () => void; label: string }) {
  const url = usePreview(it, f, 140, [it.id, it.quad, it.src, f])
  return (
    <button className={`filter-chip ${on ? 'on' : ''}`} onClick={onClick}>
      {url ? <img src={url} alt="" /> : <span className="img-ph" />}
      <span>{label}</span>
    </button>
  )
}

function PageChip({ it, on, onClick, n }: { it: ScanItem; on: boolean; onClick: () => void; n: number }) {
  const url = usePreview(it, undefined, 140, [it.id, it.quad, it.src, it.filter])
  return (
    <button className={`page-chip ${on ? 'on' : ''}`} onClick={onClick}>
      {url ? <img src={url} alt="" /> : <span className="img-ph" />}
      <span className="page-num">{n}</span>
    </button>
  )
}

/** Full-size rendering of a scan item, as an object URL (no base64 step, so large ones stay quick). */
function useRendered(it: ScanItem, filter: FilterName, side: number, enabled = true): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let made: string | undefined
    const h = window.setTimeout(async () => {
      const c = applyFilter(warpPerspective(it.src, it.quad, side), filter)
      const b = await canvasToBlob(c, 'image/jpeg', 0.9)
      c.width = c.height = 1
      if (!alive) return
      made = URL.createObjectURL(b)
      setUrl(made)
    }, 80)
    return () => {
      alive = false
      window.clearTimeout(h)
    }
  }, [it.id, it.src, it.quad, filter, side, enabled])
  // Free each picture once the next one has replaced it.
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  return url
}

/** Longest side of the on-screen preview; a sharper one is made when zoomed in. */
const PREVIEW_SIDE = 1600
const ZOOM_SIDE = 3200

function ResultPreview({ it, label, onPrev, onNext }: { it: ScanItem; label: string; onPrev?: () => void; onNext?: () => void }) {
  const { t } = useApp()
  const [sharp, setSharp] = useState(false)
  const [orig, setOrig] = useState(false)
  const [wantOrig, setWantOrig] = useState(false)
  useEffect(() => setSharp(false), [it.id])
  const onZoom = useCallback((s: number) => {
    if (s > 1.6) setSharp(true)
  }, [])
  const side = sharp ? ZOOM_SIDE : PREVIEW_SIDE
  const url = useRendered(it, it.filter, side)
  // The unfiltered picture is only made once someone asks to compare.
  const origUrl = useRendered(it, 'original', side, wantOrig && it.filter !== 'original')
  const showOrig = orig && origUrl
  // Until the current page's picture is ready, show the previous one dimmed rather than nothing.
  const [shownFor, setShownFor] = useState<number>()
  useEffect(() => setShownFor(undefined), [it.id])
  const onLoad = () => setShownFor(it.id)
  const hold = {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      setWantOrig(true)
      setOrig(true)
    },
    onPointerUp: () => setOrig(false),
    onPointerLeave: () => setOrig(false),
    onPointerCancel: () => setOrig(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }
  return (
    <ZoomView src={showOrig ? origUrl : url} resetKey={it.id} onPrev={onPrev} onNext={onNext} onZoom={onZoom} className={`result-box ${shownFor === it.id ? '' : 'stale'}`} onLoad={onLoad}>
      {!url && <div className="spinner" />}
      <div className="preview-tags">
        <span className="preview-tag">{showOrig ? t('filter.original') : label}</span>
        {it.filter !== 'original' && (
          <button className={`preview-tag btn-tag ${orig ? 'on' : ''}`} {...hold} aria-label={t('holdOriginal')}>
            <Icon name="compare" size={16} /> {t('holdOriginal')}
          </button>
        )}
      </div>
    </ZoomView>
  )
}

/** Scan tools that open this editor with their own filter and name. */
export type ScanKind = 'whiteboard' | 'slides' | 'mega'

/**
 * Slides are kept smaller: a lecture can mean dozens of photos, and a slide needs far less than a
 * page of small print. Mega Scan results are kept larger so the detail survives.
 */
const SOURCE_SIDE: Partial<Record<ScanKind, number>> = { slides: 2000 }

export function ScanScreen({ files, docId, hints, filter, kind, maxSide }: { files: File[]; docId?: string; hints?: (Quad | null)[]; filter?: FilterName; kind?: ScanKind; maxSide?: number }) {
  const { t, settings, setBusy, replace, back, pickFiles, toast } = useApp()
  const [items, setItems] = useState<ScanItem[]>([])
  const [cur, setCur] = useState(0)
  const [view, setView] = useState<'crop' | 'result'>('crop')

  const load = async (fs: File[], hs?: (Quad | null)[]) => {
    setBusy({ text: t('processing') })
    try {
      // The camera's outline (normalised 0..1) gets the same check as detection on the photo.
      const framed = kind === 'slides' || kind === 'whiteboard'
      const hints = framed ? hs?.map((h) => (h && looksPartial(h, 1, 1) ? null : h)) : hs
      const add = await filesToItems(fs, filter ?? settings.defaultFilter, detectorFor(kind) ?? false, hints, maxSide ?? (kind && SOURCE_SIDE[kind]))
      setItems((s) => {
        setCur(s.length)
        return [...s, ...add]
      })
      setView(add.length > 1 ? 'result' : 'crop')
    } catch (e) {
      console.error(e)
      toast(t('imageFailed'))
    } finally {
      setBusy(null)
    }
  }

  const started = useRef(false)
  useEffect(() => {
    // Guard against StrictMode's double effect run adding the photos twice.
    if (started.current) return
    started.current = true
    load(files, hints)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const it = items[cur]
  const update = (p: Partial<ScanItem>) => setItems((s) => s.map((x, i) => (i === cur ? { ...x, ...p } : x)))

  const rotate = (deg: number) => {
    if (!it) return
    update({ src: rotateCanvas(it.src, deg), quad: rotateQuad(it.quad, it.src.width, it.src.height, deg) })
  }

  const save = async () => {
    if (!items.length) return
    try {
      const pages: NewPage[] = []
      for (let i = 0; i < items.length; i++) {
        setBusy({ text: t('saving'), progress: i / items.length })
        pages.push(await itemToPage(items[i], maxSide))
      }
      if (docId) {
        await addPages(docId, pages)
        setBusy(null)
        back()
      } else {
        const doc = await createDoc(defaultDocName(kind ? t(`tool.${kind}`) : undefined), pages)
        setBusy(null)
        replace('doc', { id: doc.id })
      }
      toast(t('saved'))
    } catch (e) {
      console.error(e)
      setBusy(null)
      toast(t('saveFailed'))
    }
  }

  const filterLabels = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, t(`filter.${f}`)])), [t])

  return (
    <Screen
      title={items.length > 1 ? `${t('page')} ${cur + 1}/${items.length}` : t(kind ? `tool.${kind}` : 'tool.smartScan')}
      className="dark-screen"
      right={
        <button className="btn primary sm" onClick={save} disabled={!items.length}>
          <Icon name="check" size={18} /> {t('save')}
        </button>
      }
      footer={
        it && (
          <>
            <div className="strip">
              {FILTERS.map((f) => (
                <FilterChip key={f} it={it} f={f} on={it.filter === f} label={filterLabels[f]} onClick={() => update({ filter: f })} />
              ))}
            </div>
            <div className="strip pages">
              {items.map((x, i) => (
                <PageChip key={x.id} it={x} n={i + 1} on={i === cur} onClick={() => setCur(i)} />
              ))}
              <button className="page-chip add" onClick={() => pickFiles({ accept: 'image/*', capture: true }).then((f) => void (f.length && load(f)))} aria-label={t('addPage')}>
                <Icon name="camera" />
              </button>
              <button className="page-chip add" onClick={() => pickFiles({ accept: 'image/*', multiple: true }).then((f) => void (f.length && load(f)))} aria-label={t('tool.importImages')}>
                <Icon name="image" />
              </button>
            </div>
            <div className="toolbar">
              <button onClick={() => setView(view === 'crop' ? 'result' : 'crop')}>
                <Icon name={view === 'crop' ? 'filter' : 'crop'} />
                <span>{view === 'crop' ? t('preview') : t('crop')}</span>
              </button>
              <button onClick={() => rotate(-90)}>
                <Icon name="rotateL" />
                <span>{t('rotateLeft')}</span>
              </button>
              <button onClick={() => rotate(90)}>
                <Icon name="rotateR" />
                <span>{t('rotateRight')}</span>
              </button>
              <button
                onClick={() => {
                  const full = fullQuad(it.src.width, it.src.height)
                  const auto = (detectorFor(kind) ?? detectDocument)(it.src)
                  // Toggle between whole photo and detected edges.
                  const isFull = it.quad.every((p, i) => p.x === full[i].x && p.y === full[i].y)
                  if (isFull && auto) update({ quad: auto, auto: true })
                  else update({ quad: full, auto: false })
                  setView('crop')
                }}
              >
                <Icon name="scan" />
                <span>{it.quad.every((p, i) => p.x === fullQuad(it.src.width, it.src.height)[i].x && p.y === fullQuad(it.src.width, it.src.height)[i].y) ? t('autoDetect') : t('fullImage')}</span>
              </button>
              {kind === 'slides' && items.length > 1 && (
                // The screen stays put through a lecture: fix the corners once, use them everywhere.
                <button
                  onClick={() => {
                    const q = it.quad.map((p) => ({ x: p.x / it.src.width, y: p.y / it.src.height }))
                    setItems((s) => s.map((x) => ({ ...x, quad: q.map((p) => ({ x: p.x * x.src.width, y: p.y * x.src.height })) as Quad, auto: false })))
                    toast(t('cropAllDone', { n: items.length }))
                  }}
                >
                  <Icon name="copy" />
                  <span>{t('cropAll')}</span>
                </button>
              )}
              <button
                onClick={() => {
                  const next = items.filter((_, i) => i !== cur)
                  if (!next.length) return back()
                  setItems(next)
                  setCur(Math.min(cur, next.length - 1))
                }}
              >
                <Icon name="trash" />
                <span>{t('delete')}</span>
              </button>
            </div>
          </>
        )
      }
    >
      {it && (view === 'crop' ? <CropEditor src={it.src} quad={it.quad} onChange={(q) => update({ quad: q, auto: false })} /> : <ResultPreview it={it} label={filterLabels[it.filter]} onPrev={cur > 0 ? () => setCur(cur - 1) : undefined} onNext={cur < items.length - 1 ? () => setCur(cur + 1) : undefined} />)}
    </Screen>
  )
}
