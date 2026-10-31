import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { makeT, type Lang, type TFn } from './i18n'
import { loadSettings, storeSettings, type Settings } from './lib/settings'
import { listAlbums, listDocs, onDbChange, purgeBin, type AlbumRec, type DocRec } from './lib/db'
import { applyTheme } from './themes'

export type Tab = 'home' | 'docs' | 'tools' | 'settings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Route = { name: string; params: any; key: number }

interface Busy {
  text: string
  progress?: number
}

interface AppCtx {
  settings: Settings
  setSettings: (s: Partial<Settings>) => void
  lang: Lang
  t: TFn
  tab: Tab
  setTab: (t: Tab) => void
  stack: Route[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  push: (name: string, params?: any) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replace: (name: string, params?: any) => void
  back: () => void
  home: () => void
  /** Shows a short message; `action` adds a button such as Undo. */
  toast: (msg: string, action?: { label: string; run: () => void }) => void
  busy: Busy | null
  setBusy: (b: Busy | null) => void
  pickFiles: (opts: { accept: string; multiple?: boolean; capture?: boolean }) => Promise<File[]>
}

const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

let routeKey = 1

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setS] = useState<Settings>(loadSettings)
  const [tab, setTab] = useState<Tab>('home')
  const [stack, setStack] = useState<Route[]>([])
  const [toastMsg, setToastMsg] = useState<{ msg: string; action?: { label: string; run: () => void } } | null>(null)
  const [busy, setBusy] = useState<Busy | null>(null)
  const toastTimer = useRef<number>(0)

  const lang = settings.lang
  const t = useMemo(() => makeT(lang), [lang])

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang
  }, [lang])

  useEffect(() => {
    const prefs = { theme: settings.theme, lightLook: settings.lightLook, darkLook: settings.darkLook }
    applyTheme(prefs)
    // Keep the status bar colour right when the phone flips light/dark in "system" mode.
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(prefs)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [settings.theme, settings.lightLook, settings.darkLook])

  const setSettings = useCallback((p: Partial<Settings>) => {
    setS((s) => {
      const n = { ...s, ...p }
      storeSettings(n)
      return n
    })
  }, [])

  // The navigation stack mirrors browser history so the iPhone back-swipe and Android back button work.
  useEffect(() => {
    history.replaceState({ depth: 0 }, '')
    const onPop = (e: PopStateEvent) => {
      const depth = (e.state as { depth?: number } | null)?.depth ?? 0
      setStack((s) => s.slice(0, depth))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const push = useCallback((name: string, params: unknown = {}) => {
    setStack((s) => {
      const n = [...s, { name, params, key: routeKey++ }]
      history.pushState({ depth: n.length }, '')
      return n
    })
  }, [])

  const replace = useCallback((name: string, params: unknown = {}) => {
    setStack((s) => (s.length ? [...s.slice(0, -1), { name, params, key: routeKey++ }] : [{ name, params, key: routeKey++ }]))
  }, [])

  const stackLen = useRef(0)
  stackLen.current = stack.length
  const back = useCallback(() => {
    if (stackLen.current > 0) history.back()
  }, [])
  const home = useCallback(() => {
    if (stackLen.current > 0) history.go(-stackLen.current)
  }, [])

  const toast = useCallback((msg: string, action?: { label: string; run: () => void }) => {
    setToastMsg({ msg, action })
    window.clearTimeout(toastTimer.current)
    // Give people time to reach an Undo button.
    toastTimer.current = window.setTimeout(() => setToastMsg(null), action ? 5000 : 2600)
  }, [])

  const pickFiles = useCallback((opts: { accept: string; multiple?: boolean; capture?: boolean }) => {
    // Must be called synchronously inside a tap handler, otherwise iOS ignores input.click().
    return new Promise<File[]>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = opts.accept
      input.multiple = !!opts.multiple
      if (opts.capture) input.setAttribute('capture', 'environment')
      input.style.display = 'none'
      input.onchange = () => {
        resolve(Array.from(input.files ?? []))
        input.remove()
      }
      input.addEventListener('cancel', () => {
        resolve([])
        input.remove()
      })
      document.body.appendChild(input)
      input.click()
    })
  }, [])

  const value: AppCtx = { settings, setSettings, lang, t, tab, setTab, stack, push, replace, back, home, toast, busy, setBusy, pickFiles }

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className={`toast ${toastMsg.action ? 'with-action' : ''}`} role="status">
          <span>{toastMsg.msg}</span>
          {toastMsg.action && (
            <button
              className="toast-action"
              onClick={() => {
                toastMsg.action!.run()
                setToastMsg(null)
              }}
            >
              {toastMsg.action.label}
            </button>
          )}
        </div>
      )}
      {busy && (
        <div className="busy" role="alert" aria-busy="true">
          <div className="busy-card">
            <div className="spinner" />
            <div>{busy.text}</div>
            {busy.progress != null && (
              <div className="progress">
                <div style={{ width: `${Math.round(busy.progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useDocs(): DocRec[] | null {
  const [docs, setDocs] = useState<DocRec[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => listDocs().then((d) => alive && setDocs(d))
    load()
    const off = onDbChange(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return docs
}

export function useObjectUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

export function useAlbums(): AlbumRec[] {
  const [albums, setAlbums] = useState<AlbumRec[]>([])
  useEffect(() => {
    let alive = true
    const load = () => listAlbums().then((a) => alive && setAlbums(a))
    load()
    const off = onDbChange(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return albums
}

// Clear out anything that has been in the Recycle Bin for more than 30 days, once per launch.
if (typeof indexedDB !== 'undefined') purgeBin().catch(() => {})
