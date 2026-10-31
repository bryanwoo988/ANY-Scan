// Convert to Excel: tables in photos, scans and PDFs become an editable .xlsx. PDFs use their own
// text layer; pictures are read with on-device OCR, keeping where each word sits to rebuild columns.
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { PageImg, Screen, Segmented, formatDate } from '../components/ui'
import { getDoc, getPages, type DocRec } from '../lib/db'
import { safeFileName } from '../lib/export'
import { blobToCanvas, canvasToBlob } from '../lib/image'
import { PdfLockedError, readPdf, type SourcePage } from '../lib/office'
import { OCR_LANGS, recognizeWords, type OcrLang } from '../lib/ocr'
import { loadJSON, saveJSON } from '../lib/settings'
import { shareOrDownload } from '../lib/share'
import { buildXlsx, cellText, cellValue, colName, toTable, wordsToItems, type Sheet } from '../lib/sheet'
import { useApp, useDocs } from '../state'
import { OCR_LANG_LABEL } from './Edit'

type Layout = 'perPage' | 'oneSheet'
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

/** Photos are read at up to 2500 px: plenty for OCR and much faster than full camera resolution. */
async function imagePage(blob: Blob): Promise<SourcePage> {
  const c = await blobToCanvas(blob, 2500)
  return { w: c.width, h: c.height, image: await canvasToBlob(c, 'image/jpeg', 0.92), imageW: c.width, imageH: c.height, items: [] }
}


export function ExcelScreen() {
  const { t, lang, pickFiles, toast } = useApp()
  const docs = useDocs()
  const [source, setSource] = useState<{ name: string; pages: SourcePage[] } | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>(() => loadJSON<Layout>('anyscan.excelLayout', 'perPage'))
  const [langs, setLangs] = useState<OcrLang[]>(() => loadJSON<OcrLang[]>('anyscan.ocrLangs', lang === 'zh' ? ['eng', 'chi_sim'] : lang === 'ms' ? ['eng', 'msa'] : ['eng']))
  const [working, setWorking] = useState<{ p: number; text: string } | null>(null)
  const [result, setResult] = useState<{ blob: Blob; name: string; sheets: Sheet[] } | null>(null)
  const [tab, setTab] = useState(0)

  const load = async (name: string, get: () => Promise<SourcePage[]>) => {
    setResult(null)
    setLoading(t('loading'))
    try {
      const pages = await get()
      if (pages.length) setSource({ name, pages })
    } catch (e) {
      console.error(e)
      toast(t('convertFailed'))
    } finally {
      setLoading(null)
    }
  }

  const fromFiles = (files: File[]) => {
    if (!files.length) return
    const pdf = files.find(isPdf)
    if (pdf)
      return load(pdf.name.replace(/\.pdf$/i, ''), async () => {
        for (let password: string | undefined; ; ) {
          try {
            return await readPdf(pdf, password, (d, n) => setLoading(t('loadingPages', { done: d, total: n })))
          } catch (e) {
            if (!(e instanceof PdfLockedError)) throw e
            const p = window.prompt(t('pdfPassword', { name: pdf.name }))
            if (p == null) return []
            password = p
          }
        }
      })
    return load(files.length === 1 ? files[0].name.replace(/\.\w+$/, '') : t('excelPhotos', { n: files.length }), () => Promise.all(files.map(imagePage)))
  }

  const fromDoc = (d: DocRec) =>
    load(d.name, async () => {
      const doc = await getDoc(d.id)
      return doc ? Promise.all((await getPages(doc)).map((p) => imagePage(p.blob))) : []
    })

  const scanned = source?.pages.filter((p) => !p.items.length).length ?? 0

  const convert = async () => {
    if (!source) return
    saveJSON('anyscan.excelLayout', layout)
    if (scanned) saveJSON('anyscan.ocrLangs', langs)
    setWorking({ p: 0, text: t('converting') })
    try {
      const pages = source.pages
      const tables: string[][][] = []
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i]
        let items = p.items
        if (!items.length) {
          setWorking({ p: i / pages.length, text: t('readingPage', { n: i + 1, total: pages.length }) })
          items = wordsToItems(await recognizeWords(p.image, langs, () => {}))
        }
        tables.push(toTable(items))
        setWorking({ p: (i + 1) / pages.length, text: t('converting') })
      }
      const sheets: Sheet[] =
        layout === 'perPage' || tables.length === 1
          ? tables.map((rows, i) => ({ name: tables.length === 1 ? 'Sheet1' : t('excelPageSheet', { n: i + 1 }), rows: rows.map((r) => r.map(cellValue)) }))
          : // One sheet: pages one after another with a blank row between them.
            [{ name: 'Sheet1', rows: tables.flatMap((rows, i) => [...(i ? [[]] : []), ...rows.map((r) => r.map(cellValue))]) }]
      if (!sheets.some((s) => s.rows.some((r) => r.some((c) => c != null)))) {
        toast(t('excelNoText'))
        return
      }
      setTab(0)
      setResult({ blob: buildXlsx(sheets), name: `${safeFileName(source.name)}.xlsx`, sheets })
    } catch (e) {
      console.error(e)
      toast(t('convertFailed'))
    } finally {
      setWorking(null)
    }
  }

  const preview = result?.sheets[tab]
  const cols = useMemo(() => Math.min(10, Math.max(1, ...(preview?.rows.map((r) => r.length) ?? [1]))), [preview])

  return (
    <Screen
      title={t('tool.toExcel')}
      footer={
        result ? (
          <div className="stack-sm">
            <button className="btn primary block" onClick={() => shareOrDownload([{ blob: result.blob, name: result.name }])}>
              <Icon name="share" /> {t('shareOrSave')}
            </button>
            <button className="btn ghost block" onClick={() => setResult(null)}>
              {t('convertAgain')}
            </button>
          </div>
        ) : source ? (
          <button className="btn primary block" disabled={!!working || (scanned > 0 && !langs.length)} onClick={convert}>
            <Icon name="excel" /> {t('convertTo', { fmt: 'Excel' })}
          </button>
        ) : undefined
      }
    >
      <div className="xl-hero">
        <div className="grow">
          <h2>
            {t('tool.toExcel')} <span className="xl-spark">✦</span>
          </h2>
          <p>{t('excelIntro')}</p>
        </div>
        <span className="xl-logo">
          <Icon name="excel" size={40} />
        </span>
      </div>

      <div className="pad stack">
        {loading && <p className="muted">{loading}</p>}

        {!source && !loading && (
          <>
            <div className="field-label">{t('createOrImport')}</div>
            <div className="xl-sources">
              <button onClick={() => pickFiles({ accept: 'image/*', capture: true }).then(fromFiles)}>
                <Icon name="camera" size={24} /> {t('excelScan')}
              </button>
              <button onClick={() => pickFiles({ accept: 'image/*', multiple: true }).then(fromFiles)}>
                <Icon name="image" size={24} /> {t('excelPhotos0')}
              </button>
              <button onClick={() => pickFiles({ accept: 'application/pdf,image/*', multiple: true }).then(fromFiles)}>
                <Icon name="folder" size={24} /> {t('excelDevice')}
              </button>
            </div>
            {!!docs?.length && (
              <>
                <div className="field-label">{t('selectFromApp')}</div>
                <div className="xl-docs">
                  {docs.map((d) => (
                    <button key={d.id} className="xl-doc" onClick={() => fromDoc(d)}>
                      <PageImg pageId={d.pageIds[0]} className="xl-doc-thumb" />
                      <span className="doc-meta">
                        <span className="doc-name">{d.name}</span>
                        <span className="doc-sub">
                          {formatDate(d.updatedAt, lang)} <span className="dot" /> <Icon name="docs" size={14} /> {d.pageIds.length}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {source && (
          <>
            <div className="conv-source">
              <SourceThumb page={source.pages[0]} />
              <div className="grow">
                <div className="doc-name">{source.name}</div>
                <div className="muted small">{source.pages.length === 1 ? t('onePage') : t('nPages', { n: source.pages.length })}</div>
              </div>
              {!result && !working && (
                <button className="link" onClick={() => setSource(null)}>
                  {t('change')}
                </button>
              )}
            </div>
            {!result && (
              <>
                {source.pages.length > 1 && (
                  <Segmented
                    value={layout}
                    onChange={setLayout}
                    options={[
                      { value: 'perPage', label: t('excelPerPage') },
                      { value: 'oneSheet', label: t('excelOneSheet') },
                    ]}
                  />
                )}
                <p className="muted small conv-note">{t('excelNote')}</p>
                {scanned > 0 && (
                  <div className="field">
                    <label>{source.pages.length === scanned ? t('excelOcrAll') : t('convOcrPages', { n: scanned, total: source.pages.length })}</label>
                    <div className="chip-row">
                      {OCR_LANGS.map((l) => (
                        <button key={l} className={`chip ${langs.includes(l) ? 'on' : ''}`} onClick={() => setLangs((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]))}>
                          {OCR_LANG_LABEL[l]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {working && (
          <div className="stack-sm">
            <div className="progress">
              <div style={{ width: `${Math.round(working.p * 100)}%` }} />
            </div>
            <p className="muted small">{working.text}</p>
          </div>
        )}

        {result && preview && (
          <>
            <div className="conv-result">
              <Icon name="excel" size={34} />
              <div className="grow">
                <div className="doc-name">{result.name}</div>
                <div className="muted small">{scanned ? t('excelDoneOcr') : t('convDone')}</div>
              </div>
            </div>
            {result.sheets.length > 1 && (
              <div className="chip-row nowrap">
                {result.sheets.map((s, i) => (
                  <button key={i} className={`chip ${tab === i ? 'on' : ''}`} onClick={() => setTab(i)}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <div className="xl-preview">
              <table>
                <thead>
                  <tr>
                    <th />
                    {Array.from({ length: cols }, (_, c) => (
                      <th key={c}>{colName(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 40).map((r, i) => (
                    <tr key={i}>
                      <th>{i + 1}</th>
                      {Array.from({ length: cols }, (_, c) => (
                        <td key={c} className={typeof r[c] === 'number' || (r[c] && typeof r[c] === 'object') ? 'num' : ''}>
                          {cellText(r[c] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 40 && <p className="muted small">{t('excelMoreRows', { n: preview.rows.length - 40 })}</p>}
          </>
        )}
      </div>
    </Screen>
  )
}

function SourceThumb({ page }: { page: SourcePage }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(page.image)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [page])
  return url ? <img src={url} alt="" /> : <div className="conv-thumb-empty" />
}
