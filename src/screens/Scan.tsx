import { useEffect, useMemo, useRef, useState } from 'react'
import { CropEditor } from '../components/CropEditor'
import { Icon } from '../components/Icon'
import { Screen } from '../components/ui'
import { addPages, createDoc, defaultDocName, type NewPage } from '../lib/db'
import {
  applyFilter, blobToCanvas, canvasToBlob, FILTERS, fullQuad, rotateCanvas, rotateQuad,
  warpPerspective, type FilterName, type Quad,
} from '../lib/image'
import { detectDocument } from '../lib/detect'
import { useApp } from '../state'

export interface ScanItem {
  id: number
  src: HTMLCanvasElement
  quad: Quad
  auto: boolean
  filter: FilterName
}

let itemId = 1

/**
 * `hints`: the outline the camera showed when each photo was taken (normalised 0..1). It is used
 * when detection on the full photo finds nothing, so what the user saw is what gets cropped.
 */
export async function filesToItems(files: File[], filter: FilterName, detect = true, hints?: (Quad | null)[]): Promise<ScanItem[]> {
  const out: ScanItem[] = []
  for (const [i, f] of files.entries()) {
    const src = await blobToCanvas(f)
    const hint = hints?.[i]
    const q = (detect ? detectDocument(src) : null) ?? (hint ? (hint.map((p) => ({ x: p.x * src.width, y: p.y * src.height })) as Quad) : null)
    out.push({ id: itemId++, src, quad: q ?? fullQuad(src.width, src.height), auto: !!q, filter })
  }
  return out
}

export async function renderItem(it: ScanItem, maxSide?: number): Promise<HTMLCanvasElement> {
  return applyFilter(warpPerspective(it.src, it.quad, maxSide), it.filter)
}

export async function itemToPage(it: ScanItem): Promise<NewPage> {
  const c = await renderItem(it)
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

function ResultPreview({ it }: { it: ScanItem }) {
  const url = usePreview(it, undefined, 1400, [it.id, it.quad, it.src, it.filter])
  return <div className="result-box">{url ? <img src={url} alt="" /> : <div className="spinner" />}</div>
}

export function ScanScreen({ files, docId, hints }: { files: File[]; docId?: string; hints?: (Quad | null)[] }) {
  const { t, settings, setBusy, replace, back, pickFiles, toast } = useApp()
  const [items, setItems] = useState<ScanItem[]>([])
  const [cur, setCur] = useState(0)
  const [view, setView] = useState<'crop' | 'result'>('crop')

  const load = async (fs: File[], hs?: (Quad | null)[]) => {
    setBusy({ text: t('processing') })
    try {
      const add = await filesToItems(fs, settings.defaultFilter, true, hs)
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
        pages.push(await itemToPage(items[i]))
      }
      if (docId) {
        await addPages(docId, pages)
        setBusy(null)
        back()
      } else {
        const doc = await createDoc(defaultDocName(), pages)
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
      title={items.length > 1 ? `${t('page')} ${cur + 1}/${items.length}` : t('tool.smartScan')}
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
                  const auto = detectDocument(it.src)
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
      {it && (view === 'crop' ? <CropEditor src={it.src} quad={it.quad} onChange={(q) => update({ quad: q, auto: false })} /> : <ResultPreview it={it} />)}
    </Screen>
  )
}
