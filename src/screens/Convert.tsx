// PDF → Word / PowerPoint. The source is a PDF from the phone (its text layer is used) or a document
// already in AnyScan (pictures; text is read with OCR).
import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Screen, Segmented } from '../components/ui'
import { getDoc, getPages } from '../lib/db'
import { buildDocxPages, buildPptx, parasFromText, PdfLockedError, readPdf, toLines, toParagraphs, type DocxPage, type PptSlide, type SourcePage } from '../lib/office'
import { recognize, OCR_LANGS, type OcrLang } from '../lib/ocr'
import { loadJSON, saveJSON } from '../lib/settings'
import { safeFileName } from '../lib/export'
import { shareOrDownload } from '../lib/share'
import { useApp } from '../state'
import { OCR_LANG_LABEL } from './Edit'

type Target = 'docx' | 'pptx'
type Mode = 'text' | 'image'

export function ConvertScreen({ target, file, docId }: { target: Target; file?: File; docId?: string }) {
  const { t, lang, back } = useApp()
  const [name, setName] = useState(file ? file.name.replace(/\.pdf$/i, '') : '')
  const [pages, setPages] = useState<SourcePage[] | null>(null)
  const [loading, setLoading] = useState<{ done: number; total: number } | null>({ done: 0, total: 0 })
  const [failed, setFailed] = useState(false)
  // Word users usually want to edit; PowerPoint users usually want slides that look like the PDF.
  const [mode, setMode] = useState<Mode>(() => loadJSON<Mode>(`anyscan.convertMode.${target}`, target === 'docx' ? 'text' : 'image'))
  const [langs, setLangs] = useState<OcrLang[]>(() => loadJSON<OcrLang[]>('anyscan.ocrLangs', lang === 'zh' ? ['eng', 'chi_sim'] : lang === 'ms' ? ['eng', 'msa'] : ['eng']))
  const [working, setWorking] = useState<{ p: number; text: string } | null>(null)
  const [result, setResult] = useState<{ blob: Blob; name: string; ocr: number } | null>(null)
  const [preview, setPreview] = useState<string>()

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (file) {
          let password: string | undefined
          for (;;) {
            try {
              const ps = await readPdf(file, password, (done, total) => alive && setLoading({ done, total }))
              if (alive) setPages(ps)
              break
            } catch (e) {
              if (!(e instanceof PdfLockedError)) throw e
              const p = window.prompt(t('pdfPassword', { name: file.name }))
              if (p == null) return back()
              password = p
            }
          }
        } else if (docId) {
          const doc = await getDoc(docId)
          if (!doc) return back()
          setName(doc.name)
          const recs = await getPages(doc)
          // Scans have no physical size; treat the longer side as A4's 842 pt.
          if (alive) setPages(recs.map((r) => ({ w: (r.w * 842) / Math.max(r.w, r.h), h: (r.h * 842) / Math.max(r.w, r.h), image: r.blob, imageW: r.w, imageH: r.h, items: [] })))
        }
      } catch (e) {
        console.error(e)
        if (alive) setFailed(true)
      } finally {
        if (alive) setLoading(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [file, docId])

  useEffect(() => {
    if (!pages?.[0]) return
    const url = URL.createObjectURL(pages[0].image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pages])

  const scanned = pages?.filter((p) => !p.items.length).length ?? 0
  const needsOcr = target === 'docx' && mode === 'text' && scanned > 0
  const label = target === 'docx' ? t('tool.pdfToWord') : t('tool.pdfToPpt')

  const convert = async () => {
    if (!pages) return
    saveJSON(`anyscan.convertMode.${target}`, mode)
    if (needsOcr) saveJSON('anyscan.ocrLangs', langs)
    setResult(null)
    setWorking({ p: 0, text: t('converting') })
    try {
      let ocr = 0
      let blob: Blob
      if (target === 'docx') {
        const out: DocxPage[] = []
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i]
          if (mode === 'image') out.push({ kind: 'image', w: p.w, h: p.h, image: p.image })
          else if (p.items.length) out.push({ kind: 'text', w: p.w, h: p.h, paras: toParagraphs(toLines(p.items), p.w) })
          else {
            ocr++
            const text = await recognize([p.image], langs, (f) => setWorking({ p: (i + f) / pages.length, text: t('readingPage', { n: i + 1, total: pages.length }) }))
            out.push({ kind: 'text', w: p.w, h: p.h, paras: parasFromText(text) })
          }
          setWorking({ p: (i + 1) / pages.length, text: t('converting') })
        }
        blob = await buildDocxPages(out)
      } else {
        // Editable slides need the PDF's text; scanned pages stay as pictures.
        const slides: PptSlide[] = pages.map((p) => (mode === 'text' && p.items.length ? { kind: 'text', w: p.w, h: p.h, lines: toLines(p.items) } : { kind: 'image', w: p.w, h: p.h, image: p.image }))
        blob = await buildPptx(slides)
      }
      setResult({ blob, name: `${safeFileName(name)}.${target}`, ocr })
    } catch (e) {
      console.error(e)
      setFailed(true)
    } finally {
      setWorking(null)
    }
  }

  const modes =
    target === 'docx'
      ? [
          { value: 'text' as Mode, label: t('convEditable') },
          { value: 'image' as Mode, label: t('convExactLook') },
        ]
      : [
          { value: 'image' as Mode, label: t('convExactLook') },
          { value: 'text' as Mode, label: t('convEditable') },
        ]

  return (
    <Screen
      title={label}
      footer={
        result ? (
          <div className="stack-sm">
            <button className="btn primary block" onClick={() => shareOrDownload([result])}>
              <Icon name="share" /> {t('shareOrSave')}
            </button>
            <button className="btn ghost block" onClick={() => setResult(null)}>
              {t('convertAgain')}
            </button>
          </div>
        ) : (
          <button className="btn primary block" disabled={!pages?.length || !!working || (needsOcr && !langs.length)} onClick={convert}>
            <Icon name={target === 'docx' ? 'word' : 'ppt'} /> {t('convertTo', { fmt: target === 'docx' ? 'Word' : 'PowerPoint' })}
          </button>
        )
      }
    >
      <div className="pad stack">
        <div className="conv-source">
          {preview ? <img src={preview} alt="" /> : <div className="conv-thumb-empty" />}
          <div className="grow">
            <div className="doc-name">{name || '…'}</div>
            <div className="muted small">
              {loading ? (loading.total ? t('loadingPages', { done: loading.done, total: loading.total }) : t('loading')) : pages ? t('nPages', { n: pages.length }) : ''}
            </div>
          </div>
        </div>
        {failed && <p className="danger-text">{t('convertFailed')}</p>}

        {pages && !result && (
          <>
            <Segmented value={mode} onChange={setMode} options={modes} />
            <p className="muted small conv-note">
              {target === 'docx'
                ? mode === 'text'
                  ? t('convWordEditableNote')
                  : t('convWordExactNote')
                : mode === 'text'
                  ? scanned
                    ? t('convPptEditableScannedNote', { n: scanned })
                    : t('convPptEditableNote')
                  : t('convPptExactNote')}
            </p>
            {needsOcr && (
              <div className="field">
                <label>{t('convOcrPages', { n: scanned, total: pages.length })}</label>
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

        {working && (
          <div className="stack-sm">
            <div className="progress">
              <div style={{ width: `${Math.round(working.p * 100)}%` }} />
            </div>
            <p className="muted small">{working.text}</p>
          </div>
        )}

        {result && (
          <div className="conv-result">
            <Icon name={target === 'docx' ? 'word' : 'ppt'} size={34} />
            <div className="grow">
              <div className="doc-name">{result.name}</div>
              <div className="muted small">{result.ocr ? t('convDoneOcr', { n: result.ocr }) : t('convDone')}</div>
            </div>
          </div>
        )}
      </div>
    </Screen>
  )
}
