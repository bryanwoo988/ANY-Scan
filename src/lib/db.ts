// Local document storage in IndexedDB. Documents never leave the device.

export interface PageRec {
  id: string
  blob: Blob
  w: number
  h: number
}

export interface DocRec {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  pageIds: string[]
}

export interface NewPage {
  blob: Blob
  w: number
  h: number
}

const DB_NAME = 'anyscan'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

const listeners = new Set<() => void>()
export function onDbChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function changed() {
  listeners.forEach((fn) => fn())
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '')

export async function listDocs(): Promise<DocRec[]> {
  const db = await open()
  const docs = await reqP(db.transaction('docs').objectStore('docs').getAll() as IDBRequest<DocRec[]>)
  return docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getDoc(id: string): Promise<DocRec | undefined> {
  const db = await open()
  return reqP(db.transaction('docs').objectStore('docs').get(id) as IDBRequest<DocRec | undefined>)
}

export async function getPage(id: string): Promise<PageRec | undefined> {
  const db = await open()
  return reqP(db.transaction('pages').objectStore('pages').get(id) as IDBRequest<PageRec | undefined>)
}

export async function getPages(doc: DocRec): Promise<PageRec[]> {
  const db = await open()
  const store = db.transaction('pages').objectStore('pages')
  const pages = await Promise.all(doc.pageIds.map((id) => reqP(store.get(id) as IDBRequest<PageRec | undefined>)))
  return pages.filter((p): p is PageRec => !!p)
}

export async function createDoc(name: string, pages: NewPage[]): Promise<DocRec> {
  const db = await open()
  const now = Date.now()
  const recs = pages.map((p) => ({ id: uid(), ...p }))
  const doc: DocRec = { id: uid(), name, createdAt: now, updatedAt: now, pageIds: recs.map((r) => r.id) }
  const tx = db.transaction(['docs', 'pages'], 'readwrite')
  recs.forEach((r) => tx.objectStore('pages').put(r))
  tx.objectStore('docs').put(doc)
  await txDone(tx)
  changed()
  requestPersistence()
  return doc
}

let persistAsked = false
/** Asks the browser not to clear AnyScan's storage automatically (granted more readily for Home Screen apps). */
function requestPersistence() {
  if (persistAsked) return
  persistAsked = true
  navigator.storage?.persist?.().catch(() => {})
}

export async function saveDoc(doc: DocRec): Promise<void> {
  const db = await open()
  const tx = db.transaction('docs', 'readwrite')
  tx.objectStore('docs').put({ ...doc, updatedAt: Date.now() })
  await txDone(tx)
  changed()
}

export async function renameDoc(id: string, name: string): Promise<void> {
  const doc = await getDoc(id)
  if (doc) await saveDoc({ ...doc, name })
}

export async function addPages(docId: string, pages: NewPage[]): Promise<void> {
  const db = await open()
  const doc = await getDoc(docId)
  if (!doc) throw new Error('Document not found')
  const recs = pages.map((p) => ({ id: uid(), ...p }))
  const tx = db.transaction(['docs', 'pages'], 'readwrite')
  recs.forEach((r) => tx.objectStore('pages').put(r))
  tx.objectStore('docs').put({ ...doc, pageIds: [...doc.pageIds, ...recs.map((r) => r.id)], updatedAt: Date.now() })
  await txDone(tx)
  changed()
}

export async function replacePage(docId: string, pageId: string, page: NewPage): Promise<void> {
  const db = await open()
  const doc = await getDoc(docId)
  const tx = db.transaction(['docs', 'pages'], 'readwrite')
  tx.objectStore('pages').put({ id: pageId, ...page })
  if (doc) tx.objectStore('docs').put({ ...doc, updatedAt: Date.now() })
  await txDone(tx)
  changed()
}

/** Sets the page order of a document. Pages no longer referenced are deleted. */
export async function setPageOrder(docId: string, pageIds: string[]): Promise<void> {
  const db = await open()
  const doc = await getDoc(docId)
  if (!doc) return
  const keep = new Set(pageIds)
  const tx = db.transaction(['docs', 'pages'], 'readwrite')
  doc.pageIds.filter((id) => !keep.has(id)).forEach((id) => tx.objectStore('pages').delete(id))
  tx.objectStore('docs').put({ ...doc, pageIds, updatedAt: Date.now() })
  await txDone(tx)
  changed()
}

export async function deleteDocs(ids: string[]): Promise<void> {
  const db = await open()
  const docs = (await Promise.all(ids.map(getDoc))).filter((d): d is DocRec => !!d)
  const tx = db.transaction(['docs', 'pages'], 'readwrite')
  docs.forEach((d) => {
    d.pageIds.forEach((p) => tx.objectStore('pages').delete(p))
    tx.objectStore('docs').delete(d.id)
  })
  await txDone(tx)
  changed()
}

/** Creates a new document whose pages are copies of the given pages. */
export async function docFromPages(name: string, pages: PageRec[]): Promise<DocRec> {
  return createDoc(
    name,
    pages.map((p) => ({ blob: p.blob, w: p.w, h: p.h })),
  )
}

export async function clearAll(): Promise<void> {
  const db = await open()
  const tx = db.transaction(['docs', 'pages'], 'readwrite')
  tx.objectStore('docs').clear()
  tx.objectStore('pages').clear()
  await txDone(tx)
  changed()
}

export function defaultDocName(prefix = 'AnyScan', d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${prefix} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`
}
