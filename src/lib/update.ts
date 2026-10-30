// Service-worker based update flow: detect a new deploy, let the user apply it with one tap.

let registration: ServiceWorkerRegistration | null = null
let waiting: ServiceWorker | null = null
let updating = false
const listeners = new Set<(ready: boolean) => void>()

const notify = () => listeners.forEach((fn) => fn(!!waiting))

export function onUpdateReady(fn: (ready: boolean) => void): () => void {
  listeners.add(fn)
  fn(!!waiting)
  return () => listeners.delete(fn)
}

function track(reg: ServiceWorkerRegistration) {
  // Only an update if a previous version already controls the page (not the very first install).
  const consider = (sw: ServiceWorker | null) => {
    if (sw && navigator.serviceWorker.controller) {
      waiting = sw
      notify()
    }
  }
  consider(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'installed') consider(sw)
    })
  })
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        registration = reg
        track(reg)
        // Look for a new version whenever the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        })
      })
      .catch(() => {})
    // Reload only when the user asked for the update; the first install also fires controllerchange.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updating) return
      updating = false
      location.reload()
    })
  })
}

export type CheckResult = 'available' | 'latest' | 'offline' | 'unsupported'

export async function checkForUpdate(): Promise<CheckResult> {
  if (!registration) return 'unsupported'
  try {
    await registration.update()
  } catch {
    return 'offline'
  }
  // A freshly found worker needs a moment to finish installing.
  for (let i = 0; i < 30 && registration.installing; i++) await new Promise((r) => setTimeout(r, 200))
  if (registration.waiting && navigator.serviceWorker.controller) {
    waiting = registration.waiting
    notify()
  }
  return waiting ? 'available' : 'latest'
}

export function applyUpdate(): void {
  if (!waiting) return location.reload()
  updating = true
  waiting.postMessage('skipWaiting')
}
