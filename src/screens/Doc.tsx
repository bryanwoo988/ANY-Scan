import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { ZoomView } from '../components/ZoomView'
import { DocRow, Empty, PageImg, Screen, Segmented, Sheet, TextDialog } from '../components/ui'
import {
  createDoc, docFromPages, moveDocsToAlbum, restore, trashDocs, listDocs, getDoc, getPage, getPages, onDbChange, renameDoc, replacePage, setPageOrder,
  type DocRec, type PageRec,
} from '../lib/db'
import { buildJpgs, buildLongImage, buildPdf, importPdf, PdfPasswordError, safeFileName, type PageSize, type Quality } from '../lib/export'
import { blobToCanvas, canvasToBlob, formatBytes, rotateCanvas } from '../lib/image'
import { shareOrDownload } from '../lib/share'
import { useApp, useDocs, useObjectUrl } from '../state'
import type { TKey } from '../i18n'

export function useDoc(id: string | undefined): DocRec | null | undefined {
  const [doc, setDoc] = useState<DocRec | null>()
  useEffect(() => {
    if (!id) return
    let alive = true
    const load = () => getDoc(id).then((d) => alive && setDoc(d ?? null))
    load()
    const off = onDbChange(load)
    return () => {
      alive = false
      off()
    }
  }, [id])
  return doc
}

export async function rotatePage(docId: string, pageId: string, deg: number) {
  const p = await getPage(pageId)
  if (!p) return
  const c = rotateCanvas(await blobToCanvas(p.blob, 10000), deg)
  await replacePage(docId, pageId, { blob: await canvasToBlob(c, 'image/jpeg', 0.92), w: c.width, h: c.height })
}

export function printPages(pages: PageRec[]) {
  const root = document.getElementById('print-root')!
  root.replaceChildren()
  const urls = pages.map((p) => URL.createObjectURL(p.blob))
  let loaded = 0
  urls.forEach((u) => {
    const img = document.createElement('img')
    img.onload = img.onerror = () => {
      if (++loaded === urls.length) {
        window.print()
        setTimeout(() => {
          root.replaceChildren()
          urls.forEach((x) => URL.revokeObjectURL(x))
        }, 1000)
      }
    }
    img.src = u
    root.appendChild(img)
  })
}

export function DocScreen({ id }: { id: string }) {
  const { t, push, back, toast } = useApp()
  const doc = useDoc(id)
  const { pickFiles } = useApp()
  const [more, setMore] = useState(false)
  const [renaming, setRenaming] = useState(false)

  if (doc === null) return <Screen title="">{<Empty icon="docs" text={t('notFound')} />}</Screen>
  if (!doc) return <Screen title="">{null}</Screen>

  const act = (fn: () => void) => () => {
    setMore(false)
    fn()
  }

  return (
    <Screen
      title={
        <button className="title-btn" onClick={() => setRenaming(true)}>
          {doc.name} <Icon name="edit" size={16} />
        </button>
      }
      right={
        <button className="icon-btn" onClick={() => setMore(true)} aria-label={t('more')}>
          <Icon name="more" />
        </button>
      }
      footer={
        <div className="toolbar">
          <button onClick={() => push('export', { docId: id })}>
            <Icon name="share" />
            <span>{t('share')}</span>
          </button>
          <button onClick={() => pickFiles({ accept: 'image/*', capture: true }).then((f) => f.length && push('scan', { files: f, docId: id }))}>
            <Icon name="camera" />
            <span>{t('addPage')}</span>
          </button>
          <button onClick={() => push('ocr', { docId: id })}>
            <Icon name="text" />
            <span>{t('tool.ocr')}</span>
          </button>
          <button onClick={() => push('sign', { docId: id })}>
            <Icon name="sign" />
            <span>{t('tool.sign')}</span>
          </button>
          <button onClick={() => push('pages', { docId: id, mode: 'reorder' })}>
            <Icon name="reorder" />
            <span>{t('pages')}</span>
          </button>
        </div>
      }
    >
      <div className="page-list">
        {doc.pageIds.map((pid, i) => (
          <button key={pid} className="page-card" onClick={() => push('page', { docId: id, index: i })}>
            <PageImg pageId={pid} alt={`${t('page')} ${i + 1}`} />
            <span className="page-num">{i + 1}</span>
          </button>
        ))}
        {doc.pageIds.length === 0 && <Empty icon="docs" text={t('noPages')} />}
      </div>

      <Sheet open={more} onClose={() => setMore(false)} title={doc.name}>
        <div className="option-list">
          <button className="option" onClick={act(() => push('pickImport', { docId: id }))}>
            <Icon name="image" /> {t('addFromAlbum')}
          </button>
          <button className="option" onClick={act(() => push('ocr', { docId: id, docx: true }))}>
            <Icon name="word" /> {t('tool.toWord')}
          </button>
          <button className="option" onClick={act(() => push('watermark', { docId: id }))}>
            <Icon name="watermark" /> {t('tool.watermark')}
          </button>
          <button className="option" onClick={act(() => push('export', { docId: id, preset: 'lock' }))}>
            <Icon name="lock" /> {t('tool.lock')}
          </button>
          <button className="option" onClick={act(() => push('pages', { docId: id, mode: 'extract' }))}>
            <Icon name="extract" /> {t('tool.extract')}
          </button>
          <button className="option" onClick={act(async () => printPages(await getPages(doc)))}>
            <Icon name="print" /> {t('tool.print')}
          </button>
          <button
            className="option"
            onClick={act(async () => {
              const d = await docFromPages(`${doc.name} (${t('copy')})`, await getPages(doc))
              await moveDocsToAlbum([d.id], doc.albumId ?? null)
              toast(t('saved'))
              push('doc', { id: d.id })
            })}
          >
            <Icon name="copy" /> {t('duplicate')}
          </button>
          <button
            className="option danger-text"
            onClick={act(async () => {
              await trashDocs([id])
              toast(t('movedToBin', { n: 1 }), { label: t('undo'), run: () => restore([id], []) })
              back()
            })}
          >
            <Icon name="trash" /> {t('delete')}
          </button>
        </div>
      </Sheet>
      <TextDialog open={renaming} title={t('rename')} initial={doc.name} onCancel={() => setRenaming(false)} onOk={async (v) => (await renameDoc(id, v), setRenaming(false))} />
    </Screen>
  )
}

/** Picks images from the album and runs them through the scan editor into an existing doc. */
export function PickImportScreen({ docId }: { docId: string }) {
  const { pickFiles, replace, back, t } = useApp()
  return (
    <Screen title={t('addFromAlbum')}>
      <Empty icon="image" text={t('addFromAlbum')}>
        <button
          className="btn primary"
          onClick={() =>
            pickFiles({ accept: 'image/*', multiple: true }).then((f) => (f.length ? replace('scan', { files: f, docId }) : back()))
          }
        >
          <Icon name="image" /> {t('chooseImages')}
        </button>
      </Empty>
    </Screen>
  )
}

export function PageScreen({ docId, index }: { docId: string; index: number }) {
  const { t, back, push } = useApp()
  const doc = useDoc(docId)
  const [i, setI] = useState(index)
  const [blob, setBlob] = useState<Blob>()
  const pid = doc?.pageIds[i]
  useEffect(() => {
    if (pid) getPage(pid).then((p) => setBlob(p?.blob))
  }, [pid, doc?.updatedAt])
  const url = useObjectUrl(blob)
  if (!doc || !pid) return <Screen title="">{null}</Screen>
  const n = doc.pageIds.length

  return (
    <Screen
      title={`${i + 1} / ${n}`}
      className="dark-screen"
      footer={
        <div className="toolbar">
          <button disabled={i === 0} onClick={() => setI(i - 1)}>
            <Icon name="left" />
            <span>{t('prev')}</span>
          </button>
          <button onClick={() => rotatePage(docId, pid, 90)}>
            <Icon name="rotateR" />
            <span>{t('rotate')}</span>
          </button>
          <button onClick={() => push('ocr', { docId, pageIds: [pid] })}>
            <Icon name="text" />
            <span>{t('tool.ocr')}</span>
          </button>
          <button
            onClick={async () => {
              if (!window.confirm(t('confirmDeletePage'))) return
              await setPageOrder(docId, doc.pageIds.filter((x) => x !== pid))
              if (n === 1) back()
              else setI(Math.min(i, n - 2))
            }}
          >
            <Icon name="trash" />
            <span>{t('delete')}</span>
          </button>
          <button disabled={i >= n - 1} onClick={() => setI(i + 1)}>
            <Icon name="right" />
            <span>{t('next')}</span>
          </button>
        </div>
      }
    >
      <ZoomView src={url} resetKey={pid} className="result-box" onPrev={i > 0 ? () => setI(i - 1) : undefined} onNext={i < n - 1 ? () => setI(i + 1) : undefined} />
    </Screen>
  )
}

type Format = 'pdf' | 'jpg' | 'long' | 'docx'
type Preset = 'jpg' | 'long' | 'lock' | 'compress' | undefined

export function ExportScreen({ docId, preset }: { docId: string; preset?: Preset }) {
  const { t, settings, setBusy, toast, push } = useApp()
  const doc = useDoc(docId)
  const [format, setFormat] = useState<Format>(preset === 'jpg' ? 'jpg' : preset === 'long' ? 'long' : 'pdf')
  const [quality, setQuality] = useState<Quality>(preset === 'compress' ? 'small' : settings.quality)
  const [pageSize, setPageSize] = useState<PageSize>(settings.pageSize)
  const [usePw, setUsePw] = useState(preset === 'lock')
  const [pw, setPw] = useState('')
  const [result, setResult] = useState<{ files: { blob: Blob; name: string }[] } | null>(null)

  useEffect(() => setResult(null), [format, quality, pageSize, usePw, pw])

  if (!doc) return <Screen title={t('share')}>{null}</Screen>
  const base = safeFileName(doc.name)

  const build = async () => {
    if (format === 'docx') return push('ocr', { docId, docx: true })
    if (format === 'pdf' && usePw && pw.length < 4) return toast(t('passwordTooShort'))
    setBusy({ text: t('generating') })
    try {
      const pages = await getPages(doc)
      let files: { blob: Blob; name: string }[]
      if (format === 'pdf') files = [{ blob: await buildPdf(pages, { quality, pageSize, password: usePw ? pw : undefined, title: doc.name }), name: `${base}.pdf` }]
      else if (format === 'long') files = [{ blob: await buildLongImage(pages, quality), name: `${base}.jpg` }]
      else files = (await buildJpgs(pages, quality)).map((b, i) => ({ blob: b, name: pages.length > 1 ? `${base}_${i + 1}.jpg` : `${base}.jpg` }))
      setResult({ files })
      return files
    } catch (e) {
      console.error(e)
      toast(t('exportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const share = async () => {
    // Build first; iOS needs the share call to follow a tap, so a second tap shares if building took long.
    if (!result) {
      const files = await build()
      if (files) await shareOrDownload(files, doc.name).catch(() => toast(t('tapShareAgain')))
      return
    }
    await shareOrDownload(result.files, doc.name).catch(() => toast(t('tapShareAgain')))
  }

  const size = result?.files.reduce((a, f) => a + f.blob.size, 0)
  const titleKey: TKey = preset === 'lock' ? 'tool.lock' : preset === 'compress' ? 'tool.compress' : preset === 'jpg' ? 'tool.pdfToImages' : preset === 'long' ? 'tool.longImage' : 'share'

  return (
    <Screen
      title={t(titleKey)}
      footer={
        <div className="footer-actions">
          {size != null && (
            <div className="muted center-text">
              {t('fileSize')}: {formatBytes(size)}
            </div>
          )}
          <button className="btn primary block" onClick={share}>
            <Icon name="share" /> {result ? t('shareSave') : t('generateShare')}
          </button>
        </div>
      }
    >
      <div className="pad stack">
        <DocRow doc={doc} onClick={() => {}} />
        <div className="field">
          <label>{t('format')}</label>
          <div className="format-grid">
            {(
              [
                ['pdf', 'pdf', 'PDF'],
                ['jpg', 'images', t('fmt.jpg')],
                ['long', 'long', t('tool.longImage')],
                ['docx', 'word', 'Word'],
              ] as const
            ).map(([f, icon, label]) => (
              <button key={f} className={`format ${format === f ? 'on' : ''}`} onClick={() => setFormat(f)}>
                <Icon name={icon} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        {format !== 'docx' && (
          <div className="field">
            <label>{t('quality')}</label>
            <Segmented
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'high', label: t('q.high') },
                { value: 'medium', label: t('q.medium') },
                { value: 'small', label: t('q.small') },
              ]}
            />
          </div>
        )}
        {format === 'pdf' && (
          <>
            <div className="field">
              <label>{t('pdfPageSize')}</label>
              <Segmented
                value={pageSize}
                onChange={setPageSize}
                options={[
                  { value: 'auto', label: t('size.auto') },
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: 'Letter' },
                ]}
              />
            </div>
            <div className="field">
              <label className="switch-row">
                <span>
                  <Icon name="lock" size={18} /> {t('passwordProtect')}
                </span>
                <input type="checkbox" className="switch" checked={usePw} onChange={(e) => setUsePw(e.target.checked)} />
              </label>
              {usePw && <input className="input" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('passwordPlaceholder')} />}
              {usePw && <p className="muted small">{t('passwordNote')}</p>}
            </div>
          </>
        )}
        {format === 'docx' && <p className="muted">{t('docxNote')}</p>}
      </div>
    </Screen>
  )
}

/** `passFile`: a PDF chosen from the phone goes to `next` as `file` instead of being imported first. */
export function PickScreen({ title, next, nextParams, multi, passFile }: { title: TKey; next: string; nextParams?: object; multi?: boolean; passFile?: boolean }) {
  const { t, replace, setBusy, toast } = useApp()
  const docs = useDocs()
  const { pickFiles } = useApp()
  const [sel, setSel] = useState<string[]>([])

  const go = (ids: string[]) => replace(next, multi ? { ...nextParams, docIds: ids } : { ...nextParams, docId: ids[0] })

  return (
    <Screen
      title={t(title)}
      footer={
        multi && (
          <button className="btn primary block" disabled={sel.length < 2} onClick={() => go(sel)}>
            {t('mergeN', { n: sel.length })}
          </button>
        )
      }
    >
      <div className="pad stack-sm">
        <p className="muted">{multi ? t('pickDocsMulti') : t('pickDoc')}</p>
        <button
          className="btn soft block"
          onClick={() =>
            pickFiles({ accept: 'application/pdf', multiple: !!multi }).then(async (f) => {
              if (!f.length) return
              if (passFile) return replace(next, { ...nextParams, file: f[0] })
              // Import each PDF as a document first, then continue with the tool.
              const before = new Set((docs ?? []).map((d) => d.id))
              setBusy({ text: t('importing') })
              try {
                for (const file of f) await importPdfAsDoc(file, t('pdfPassword', { name: file.name }))
              } catch (e) {
                console.error(e)
                toast(t('importFailed', { name: f.map((x) => x.name).join(', ') }))
              } finally {
                setBusy(null)
              }
              const added = (await listDocs()).filter((d) => !before.has(d.id)).map((d) => d.id)
              if (!multi && added[0]) go([added[0]])
              else setSel((s) => [...s, ...added.reverse()])
            })
          }
        >
          <Icon name="folder" /> {t('importPdfFromFiles')}
        </button>
      </div>
      {docs?.length === 0 && <Empty icon="docs" text={t('noDocsYet')} />}
      <div className="list">
        {docs?.map((d) => (
          <DocRow
            key={d.id}
            doc={d}
            onClick={() => (multi ? setSel((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id])) : go([d.id]))}
            selected={multi ? sel.includes(d.id) : undefined}
            onSelect={multi ? () => setSel((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id])) : undefined}
          />
        ))}
      </div>
    </Screen>
  )
}

/** Imports a PDF as a new document without navigating (the picker continues with the chosen tool). */
async function importPdfAsDoc(file: File, passwordPrompt: string) {
  let password: string | undefined
  for (;;) {
    try {
      const pages = await importPdf(file, password)
      await createDoc(file.name.replace(/\.pdf$/i, ''), pages)
      return
    } catch (e) {
      if (!(e instanceof PdfPasswordError)) throw e
      const p = window.prompt(passwordPrompt)
      if (p == null) return
      password = p
    }
  }
}

export function MergeScreen({ docIds }: { docIds: string[] }) {
  const { t, setBusy, replace, toast } = useApp()
  const docs = useDocs()
  const [order, setOrder] = useState(docIds)
  const list = order.map((id) => docs?.find((d) => d.id === id)).filter((d): d is DocRec => !!d)
  const move = (i: number, d: number) => setOrder((o) => {
    const n = [...o]
    const j = i + d
    if (j < 0 || j >= n.length) return o
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  })

  return (
    <Screen
      title={t('tool.merge')}
      footer={
        <button
          className="btn primary block"
          disabled={list.length < 2}
          onClick={async () => {
            setBusy({ text: t('processing') })
            try {
              const pages = (await Promise.all(list.map(getPages))).flat()
              const d = await docFromPages(`${list[0].name} (${t('merged')})`, pages)
              toast(t('saved'))
              replace('doc', { id: d.id })
            } finally {
              setBusy(null)
            }
          }}
        >
          <Icon name="merge" /> {t('mergeN', { n: list.length })}
        </button>
      }
    >
      <p className="pad muted">{t('mergeOrderHint')}</p>
      <div className="list">
        {list.map((d, i) => (
          <div key={d.id} className="merge-row">
            <span className="merge-n">{i + 1}</span>
            <DocRow doc={d} onClick={() => {}} />
            <div className="merge-btns">
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="up">
                <Icon name="left" className="rot90" />
              </button>
              <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="down">
                <Icon name="right" className="rot90" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Screen>
  )
}

export function PagesScreen({ docId, mode }: { docId: string; mode: 'reorder' | 'extract' }) {
  const { t, setBusy, replace, back, toast } = useApp()
  const doc = useDoc(docId)
  const [order, setOrder] = useState<string[] | null>(null)
  const [sel, setSel] = useState<string[]>([])
  useEffect(() => {
    if (doc && !order) setOrder(doc.pageIds)
  }, [doc, order])
  if (!doc || !order) return <Screen title="">{null}</Screen>

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const moveSel = (d: number) => {
    if (sel.length !== 1) return
    const i = order.indexOf(sel[0])
    const j = i + d
    if (j < 0 || j >= order.length) return
    const n = [...order]
    ;[n[i], n[j]] = [n[j], n[i]]
    setOrder(n)
  }
  const dirty = order.join() !== doc.pageIds.join()

  return (
    <Screen
      title={mode === 'extract' ? t('tool.extract') : t('tool.reorder')}
      right={
        <button className="btn ghost sm" onClick={() => setSel(sel.length === order.length ? [] : [...order])}>
          {sel.length === order.length ? t('selectNone') : t('selectAll')}
        </button>
      }
      footer={
        mode === 'extract' ? (
          <button
            className="btn primary block"
            disabled={!sel.length}
            onClick={async () => {
              setBusy({ text: t('processing') })
              try {
                const all = await getPages(doc)
                const picked = order.filter((id) => sel.includes(id)).map((id) => all.find((p) => p.id === id)!).filter(Boolean)
                const d = await docFromPages(`${doc.name} (${t('extracted')})`, picked)
                toast(t('saved'))
                replace('doc', { id: d.id })
              } finally {
                setBusy(null)
              }
            }}
          >
            <Icon name="extract" /> {t('extractN', { n: sel.length })}
          </button>
        ) : (
          <div className="toolbar">
            <button disabled={sel.length !== 1} onClick={() => moveSel(-1)}>
              <Icon name="left" />
              <span>{t('moveForward')}</span>
            </button>
            <button disabled={sel.length !== 1} onClick={() => moveSel(1)}>
              <Icon name="right" />
              <span>{t('moveBack')}</span>
            </button>
            <button
              disabled={!sel.length}
              onClick={async () => {
                setBusy({ text: t('processing') })
                for (const id of sel) await rotatePage(docId, id, 90)
                setBusy(null)
              }}
            >
              <Icon name="rotateR" />
              <span>{t('rotate')}</span>
            </button>
            <button
              disabled={!sel.length}
              onClick={() => {
                setOrder(order.filter((id) => !sel.includes(id)))
                setSel([])
              }}
            >
              <Icon name="trash" />
              <span>{t('delete')}</span>
            </button>
            <button
              className="accent"
              disabled={!dirty}
              onClick={async () => {
                await setPageOrder(docId, order)
                toast(t('saved'))
                back()
              }}
            >
              <Icon name="check" />
              <span>{t('save')}</span>
            </button>
          </div>
        )
      }
    >
      <p className="pad muted small">{mode === 'extract' ? t('extractHint') : t('reorderHint')}</p>
      <div className="thumb-grid">
        {order.map((pid, i) => (
          <button key={pid} className={`thumb ${sel.includes(pid) ? 'on' : ''}`} onClick={() => toggle(pid)}>
            <PageImg pageId={pid} key={`${pid}-${doc.updatedAt}`} />
            <span className="page-num">{i + 1}</span>
            {sel.includes(pid) && (
              <span className="thumb-check">
                <Icon name="check" size={14} stroke={3} />
              </span>
            )}
          </button>
        ))}
      </div>
    </Screen>
  )
}

export function PrintScreen({ docId }: { docId: string }) {
  const { t, back } = useApp()
  const doc = useDoc(docId)
  return (
    <Screen title={t('tool.print')}>
      {doc && (
        <div className="pad stack">
          <DocRow doc={doc} onClick={() => {}} />
          <button className="btn primary block" onClick={async () => printPages(await getPages(doc))}>
            <Icon name="print" /> {t('tool.print')}
          </button>
          <button className="btn ghost block" onClick={back}>
            {t('done')}
          </button>
        </div>
      )}
    </Screen>
  )
}
