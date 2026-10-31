import { useState, useSyncExternalStore } from 'react'
import type { IconName } from './components/Icon'
import { loadJSON, saveJSON } from './lib/settings'
import type { TKey } from './i18n'
import { useApp } from './state'
import { createDoc, defaultDocName } from './lib/db'
import { importPdf, PdfPasswordError } from './lib/export'

export type ToolId =
  | 'smartScan' | 'idCard' | 'ocr' | 'idPhoto' | 'timestamp'
  | 'importImages' | 'importFiles'
  | 'toWord' | 'pdfToWord' | 'pdfToPpt' | 'toExcel' | 'pdfToImages' | 'longImage'
  | 'sign' | 'watermark' | 'merge' | 'extract' | 'reorder' | 'lock' | 'compress'
  | 'qr' | 'qrScan' | 'qrCreate' | 'print'

export interface Tool {
  id: ToolId
  icon: IconName
  color: string
  label: TKey
  /** Shows a NEW badge until the tool is first opened. Remove a few versions after release. */
  isNew?: boolean
}

const C = { green: '#2fbf8f', blue: '#4f7cff', orange: '#ff7a45', purple: '#9b6bff', teal: '#22b8cf', pink: '#f0568c', yellow: '#f5b83d' }

export const TOOLS: Record<ToolId, Tool> = {
  smartScan: { id: 'smartScan', icon: 'scan', color: C.green, label: 'tool.smartScan' },
  idCard: { id: 'idCard', icon: 'idcard', color: C.green, label: 'tool.idCard' },
  ocr: { id: 'ocr', icon: 'text', color: C.teal, label: 'tool.ocr' },
  idPhoto: { id: 'idPhoto', icon: 'idphoto', color: C.blue, label: 'tool.idPhoto' },
  timestamp: { id: 'timestamp', icon: 'clock', color: C.blue, label: 'tool.timestamp' },
  importImages: { id: 'importImages', icon: 'image', color: C.teal, label: 'tool.importImages' },
  importFiles: { id: 'importFiles', icon: 'folder', color: C.blue, label: 'tool.importFiles' },
  toWord: { id: 'toWord', icon: 'word', color: C.blue, label: 'tool.toWord' },
  pdfToWord: { id: 'pdfToWord', icon: 'word', color: C.blue, label: 'tool.pdfToWord', isNew: true },
  pdfToPpt: { id: 'pdfToPpt', icon: 'ppt', color: C.orange, label: 'tool.pdfToPpt', isNew: true },
  toExcel: { id: 'toExcel', icon: 'excel', color: '#21a366', label: 'tool.toExcel', isNew: true },
  pdfToImages: { id: 'pdfToImages', icon: 'images', color: C.teal, label: 'tool.pdfToImages' },
  longImage: { id: 'longImage', icon: 'long', color: C.teal, label: 'tool.longImage' },
  sign: { id: 'sign', icon: 'sign', color: C.green, label: 'tool.sign' },
  watermark: { id: 'watermark', icon: 'watermark', color: C.blue, label: 'tool.watermark' },
  merge: { id: 'merge', icon: 'merge', color: C.teal, label: 'tool.merge' },
  extract: { id: 'extract', icon: 'extract', color: C.blue, label: 'tool.extract' },
  reorder: { id: 'reorder', icon: 'reorder', color: C.purple, label: 'tool.reorder' },
  lock: { id: 'lock', icon: 'lock', color: C.green, label: 'tool.lock' },
  compress: { id: 'compress', icon: 'compress', color: C.purple, label: 'tool.compress' },
  qr: { id: 'qr', icon: 'qr', color: C.yellow, label: 'tool.qr' },
  qrScan: { id: 'qrScan', icon: 'qrscan', color: C.yellow, label: 'tool.qrScan' },
  qrCreate: { id: 'qrCreate', icon: 'qr', color: C.orange, label: 'tool.qrCreate' },
  print: { id: 'print', icon: 'print', color: C.teal, label: 'tool.print' },
}

export const SECTIONS: { title: TKey; tools: ToolId[] }[] = [
  { title: 'section.scan', tools: ['smartScan', 'idCard', 'ocr', 'idPhoto', 'timestamp'] },
  { title: 'section.qr', tools: ['qrScan', 'qrCreate', 'qr'] },
  { title: 'section.import', tools: ['importImages', 'importFiles'] },
  { title: 'section.convert', tools: ['pdfToWord', 'pdfToPpt', 'toExcel', 'toWord', 'pdfToImages', 'longImage'] },
  { title: 'section.edit', tools: ['sign', 'watermark', 'merge', 'extract', 'reorder', 'lock', 'compress'] },
  { title: 'section.utilities', tools: ['print'] },
]

/** Tools pinned to the Home screen by default; the user can change them (max FAVORITES_MAX). */
export const DEFAULT_FAVORITES: ToolId[] = ['smartScan', 'importImages', 'importFiles', 'idCard', 'ocr', 'qrScan', 'timestamp']
// Seven pins plus the "All" tile fill two rows of four.
export const FAVORITES_MAX = 7
const FAV_KEY = 'anyscan.favorites'

export function useFavorites(): [ToolId[], (ids: ToolId[]) => void] {
  const [favs, setFavs] = useState<ToolId[]>(() => loadJSON<ToolId[]>(FAV_KEY, DEFAULT_FAVORITES).filter((id) => id in TOOLS))
  return [
    favs,
    (ids) => {
      setFavs(ids)
      saveJSON(FAV_KEY, ids)
    },
  ]
}

// ---------------------------------------------------------------- NEW badges

const SEEN_KEY = 'anyscan.seenNewTools'
let seenNew: string[] = loadJSON<string[]>(SEEN_KEY, [])
const seenSubs = new Set<() => void>()

function markSeen(id: ToolId) {
  if (!TOOLS[id].isNew || seenNew.includes(id)) return
  seenNew = [...seenNew, id]
  saveJSON(SEEN_KEY, seenNew)
  seenSubs.forEach((f) => f())
}

/** Returns whether a tool should show its NEW badge (new and not opened yet). */
export function useIsNew(): (id: ToolId) => boolean {
  const seen = useSyncExternalStore(
    (f) => (seenSubs.add(f), () => seenSubs.delete(f)),
    () => seenNew,
  )
  return (id) => !!TOOLS[id].isNew && !seen.includes(id)
}

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

export function useTools() {
  const app = useApp()
  const { push, pickFiles, setBusy, toast, t } = app

  /** Turns PDFs into documents and sends images through the scan editor. */
  async function importFileList(files: File[], into?: string) {
    const images = files.filter((f) => !isPdf(f))
    let lastDoc: string | undefined
    for (const f of files.filter(isPdf)) {
      let password: string | undefined
      for (;;) {
        try {
          setBusy({ text: t('importing'), progress: 0 })
          const pages = await importPdf(f, password, (d, n) => setBusy({ text: `${t('importing')} ${d}/${n}`, progress: d / n }))
          const doc = await createDoc(f.name.replace(/\.pdf$/i, ''), pages)
          lastDoc = doc.id
          break
        } catch (e) {
          setBusy(null)
          if (e instanceof PdfPasswordError) {
            const p = window.prompt(t('pdfPassword', { name: f.name }))
            if (p == null) break
            password = p
            continue
          }
          console.error(e)
          toast(t('importFailed', { name: f.name }))
          break
        } finally {
          setBusy(null)
        }
      }
    }
    if (images.length) push('scan', { files: images, docId: into })
    else if (lastDoc) push('doc', { id: lastDoc })
    return lastDoc
  }

  function run(id: ToolId) {
    markSeen(id)
    switch (id) {
      case 'smartScan':
        return push('camera', { mode: 'scan' })
      case 'importImages':
        return pickFiles({ accept: 'image/*', multiple: true }).then((f) => f.length && push('scan', { files: f }))
      case 'importFiles':
        return pickFiles({ accept: 'application/pdf,image/*', multiple: true }).then((f) => void (f.length && importFileList(f)))
      case 'idCard':
        return push('camera', { mode: 'idcard' })
      case 'ocr':
        return push('camera', { mode: 'ocr' })
      case 'idPhoto':
        return push('camera', { mode: 'idphoto' })
      case 'timestamp':
        return push('camera', { mode: 'timestamp' })
      case 'toWord':
        return push('pick', { title: 'tool.toWord', next: 'ocr', nextParams: { docx: true } })
      case 'pdfToWord':
        return push('pick', { title: 'tool.pdfToWord', next: 'convert', nextParams: { target: 'docx' }, passFile: true })
      case 'pdfToPpt':
        return push('pick', { title: 'tool.pdfToPpt', next: 'convert', nextParams: { target: 'pptx' }, passFile: true })
      case 'toExcel':
        return push('excel')
      case 'pdfToImages':
        return push('pick', { title: 'tool.pdfToImages', next: 'export', nextParams: { preset: 'jpg' } })
      case 'longImage':
        return push('pick', { title: 'tool.longImage', next: 'export', nextParams: { preset: 'long' } })
      case 'lock':
        return push('pick', { title: 'tool.lock', next: 'export', nextParams: { preset: 'lock' } })
      case 'compress':
        return push('pick', { title: 'tool.compress', next: 'export', nextParams: { preset: 'compress' } })
      case 'sign':
        return push('pick', { title: 'tool.sign', next: 'sign' })
      case 'watermark':
        return push('pick', { title: 'tool.watermark', next: 'watermark' })
      case 'merge':
        return push('pick', { title: 'tool.merge', next: 'merge', multi: true })
      case 'extract':
        return push('pick', { title: 'tool.extract', next: 'pages', nextParams: { mode: 'extract' } })
      case 'reorder':
        return push('pick', { title: 'tool.reorder', next: 'pages', nextParams: { mode: 'reorder' } })
      case 'print':
        return push('pick', { title: 'tool.print', next: 'print' })
      case 'qr':
        return push('qr')
      case 'qrScan':
        return push('qrscan')
      case 'qrCreate':
        return push('qrcreate', {})
    }
  }

  return { run, importFileList, newDocName: () => defaultDocName() }
}
