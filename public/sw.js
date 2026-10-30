// Offline support: network-first for the app shell, cache-first for hashed assets.
// BUILD is stamped at build time (vite.config.ts), so each deploy is a new service worker version.
const BUILD = '__BUILD_ID__'
const CACHE = `anyscan-${BUILD}`
// OCR engine and language files are large and versioned by npm, so they survive app updates.
const OCR_CACHE = 'anyscan-ocr-v1'

self.addEventListener('install', (e) => {
  // Don't take over straight away: the app shows "Update available" and the user decides when.
  // The app shell and every bundle (list filled in at build time by vite.config.ts).
  const files = '__PRECACHE__'
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(Array.isArray(files) ? files : ['./', './index.html'])))
})

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Hashed bundles and the OCR engine/language files never change for a given URL.
  if (url.pathname.includes('/assets/') || url.pathname.includes('/ocr/')) {
    const bucket = url.pathname.includes('/ocr/') ? OCR_CACHE : CACHE
    e.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(bucket).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req, { ignoreVary: true }).then((hit) => hit || caches.match('./index.html'))),
  )
})
