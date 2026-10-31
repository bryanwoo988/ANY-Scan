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
  /** Album the document belongs to (none = only under "All"). */
  albumId?: string | null
  /** Set when moved to the Recycle Bin; the document is purged 30 days later. */
  deletedAt?: number | null
}

export interface AlbumRec {
  id: string
  name: string
  createdAt: number
  deletedAt?: number | null
}

export interface NewPage {
  blob: Blob
  w: number
  h: number
}

const DB_NAME = 'anyscan'
const DB_VERSION = 2 // v2: albums

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('albums')) db.createObjectStore('albums', { keyPath: 'id' })
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

async function allDocs(): Promise<DocRec[]> {
  const db = await open()
  const docs = await reqP(db.transaction('docs').objectStore('docs').getAll() as IDBRequest<DocRec[]>)
  return docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Documents that are not in the Recycle Bin, newest first. */
export async function listDocs(): Promise<DocRec[]> {
  return (await allDocs()).filter((d) => !d.deletedAt)
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
  const tx = db.transaction(['docs', 'pages', 'albums'], 'readwrite')
  tx.objectStore('docs').clear()
  tx.objectStore('pages').clear()
  tx.objectStore('albums').clear()
  await txDone(tx)
  changed()
}

export function defaultDocName(prefix = 'AnyScan', d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${prefix} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`
}

// ---------------------------------------------------------------- albums & Recycle Bin

export const BIN_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

export async function listAlbums(): Promise<AlbumRec[]> {
  const db = await open()
  const all = await reqP(db.transaction('albums').objectStore('albums').getAll() as IDBRequest<AlbumRec[]>)
  return all.filter((a) => !a.deletedAt).sort((a, b) => a.createdAt - b.createdAt)
}

async function putAll(store: 'docs' | 'albums', recs: (DocRec | AlbumRec)[]): Promise<void> {
  if (!recs.length) return
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  recs.forEach((r) => tx.objectStore(store).put(r))
  await txDone(tx)
  changed()
}

export async function createAlbum(name: string): Promise<AlbumRec> {
  const a: AlbumRec = { id: uid(), name, createdAt: Date.now() }
  await putAll('albums', [a])
  return a
}

export async function renameAlbum(id: string, name: string): Promise<void> {
  const a = (await listAlbums()).find((x) => x.id === id)
  if (a) await putAll('albums', [{ ...a, name }])
}

export async function moveDocsToAlbum(ids: string[], albumId: string | null): Promise<void> {
  const docs = (await Promise.all(ids.map(getDoc))).filter((d): d is DocRec => !!d)
  await putAll('docs', docs.map((d) => ({ ...d, albumId })))
}

/** Moves documents to the Recycle Bin (they can be restored for 30 days). */
export async function trashDocs(ids: string[], now = Date.now()): Promise<void> {
  const docs = (await Promise.all(ids.map(getDoc))).filter((d): d is DocRec => !!d)
  await putAll('docs', docs.map((d) => ({ ...d, deletedAt: now })))
}

/**
 * Deletes an album. With `withDocs` the album and its documents go to the Recycle Bin together
 * (restoring the album brings them back); otherwise the documents stay and leave the album.
 */
export async function trashAlbum(id: string, withDocs: boolean, now = Date.now()): Promise<void> {
  const db = await open()
  const album = await reqP(db.transaction('albums').objectStore('albums').get(id) as IDBRequest<AlbumRec | undefined>)
  if (!album) return
  const docs = (await listDocs()).filter((d) => d.albumId === id)
  if (withDocs) {
    await putAll('docs', docs.map((d) => ({ ...d, deletedAt: now })))
    await putAll('albums', [{ ...album, deletedAt: now }])
  } else {
    await putAll('docs', docs.map((d) => ({ ...d, albumId: null })))
    await deleteForever([], [id])
  }
}

export interface BinContents {
  docs: DocRec[]
  albums: AlbumRec[]
}

export async function listBin(): Promise<BinContents> {
  const db = await open()
  const albums = (await reqP(db.transaction('albums').objectStore('albums').getAll() as IDBRequest<AlbumRec[]>)).filter((a) => a.deletedAt)
  const docs = (await allDocs()).filter((d) => d.deletedAt)
  const byDeleted = (a: { deletedAt?: number | null }, b: { deletedAt?: number | null }) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)
  return { docs: docs.sort(byDeleted), albums: albums.sort(byDeleted) }
}

/** Days left before an item in the Recycle Bin is deleted for good. */
export function daysLeft(deletedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deletedAt + BIN_DAYS * DAY - now) / DAY))
}

/** Restores documents and albums from the Recycle Bin. Restoring an album restores its documents. */
export async function restore(docIds: string[], albumIds: string[]): Promise<void> {
  const bin = await listBin()
  const albums = bin.albums.filter((a) => albumIds.includes(a.id))
  const docs = bin.docs.filter((d) => docIds.includes(d.id) || (d.albumId && albumIds.includes(d.albumId)))
  const liveAlbums = new Set([...(await listAlbums()).map((a) => a.id), ...albumIds])
  await putAll('albums', albums.map((a) => ({ ...a, deletedAt: null })))
  // A document whose album is gone comes back under "All".
  await putAll('docs', docs.map((d) => ({ ...d, deletedAt: null, albumId: d.albumId && liveAlbums.has(d.albumId) ? d.albumId : null })))
}

/** Permanently deletes documents (with their pages) and albums. */
export async function deleteForever(docIds: string[], albumIds: string[]): Promise<void> {
  const db = await open()
  const docs = (await Promise.all(docIds.map(getDoc))).filter((d): d is DocRec => !!d)
  const tx = db.transaction(['docs', 'pages', 'albums'], 'readwrite')
  docs.forEach((d) => {
    d.pageIds.forEach((p) => tx.objectStore('pages').delete(p))
    tx.objectStore('docs').delete(d.id)
  })
  albumIds.forEach((id) => tx.objectStore('albums').delete(id))
  await txDone(tx)
  changed()
}

export async function emptyBin(): Promise<void> {
  const bin = await listBin()
  await deleteForever(
    bin.docs.map((d) => d.id),
    bin.albums.map((a) => a.id),
  )
}

/** Permanently deletes whatever has been in the Recycle Bin for more than 30 days. */
export async function purgeBin(now = Date.now()): Promise<number> {
  const bin = await listBin()
  const old = (x: { deletedAt?: number | null }) => !!x.deletedAt && now - x.deletedAt > BIN_DAYS * DAY
  const docs = bin.docs.filter(old).map((d) => d.id)
  const albums = bin.albums.filter(old).map((a) => a.id)
  if (docs.length || albums.length) await deleteForever(docs, albums)
  return docs.length + albums.length
}
