// Timestamp settings shared by the Timestamp screen (album photos) and the camera's live
// Timestamp mode.
//
// - Settings ("prefs"): the date template, the time/info group, and which watermarks are used.
// - Watermark library: any number of named watermarks (text and/or logo), each with its own
//   position and size. Settings refer to watermarks by id, so editing a watermark updates every
//   combination that uses it.
// - Combinations: named saved settings the user can switch between, update, rename and delete.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Icon } from './Icon'
import { Sheet } from './ui'
import { blobToCanvas, createCanvas, ctx2d, scaleCanvas } from '../lib/image'
import { loadJSON, saveJSON } from '../lib/settings'
import { drawStamp, STAMP_POSITIONS, STAMP_TEMPLATES, type StampMark, type StampOptions, type StampPos, type StampTemplate } from '../lib/stamp'
import { uid } from '../lib/db'
import { useApp } from '../state'

export interface StampPrefs {
  template: StampTemplate
  hour24: boolean
  showDate: boolean
  location: string // typed place name; empty = use the detected place when auto location is on
  autoLocation: boolean // camera: look up the position when the Timestamp camera opens
  showCoords: boolean // show the GPS coordinates line
  note: string
  pos: StampPos // position of the time/info group
  size: number // size of the time/info group
  watermarkIds: string[] // watermarks from the library shown with these settings, in order
}

export interface Watermark {
  id: string
  name: string
  text: string
  logo: string | null // data URL
  pos: StampPos
  size: number
}

export interface StampPreset {
  id: string
  name: string
  prefs: StampPrefs
}

const KEY = 'anyscan.timestamp'
const PRESETS_KEY = 'anyscan.stampPresets'
const MARKS_KEY = 'anyscan.watermarks'
export const STAMP_DEFAULTS: StampPrefs = {
  template: 'timeLocation',
  hour24: false,
  showDate: true,
  location: '',
  autoLocation: true,
  showCoords: true,
  note: '',
  pos: 'bl',
  size: 1,
  watermarkIds: [],
}

// ---------------------------------------------------------------- stores

/** A tiny persisted store that several screens can subscribe to. */
function createStore<T>(key: string, initial: () => T) {
  let value: T | undefined
  const listeners = new Set<() => void>()
  const get = () => (value ??= loadJSON<T>(key, initial()))
  return {
    get,
    set(v: T) {
      value = v
      saveJSON(key, v)
      listeners.forEach((l) => l())
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

const marksStore = createStore<Watermark[]>(MARKS_KEY, () => [])
const presetsStore = createStore<StampPreset[]>(PRESETS_KEY, () => [])

export const useWatermarks = () => useSyncExternalStore(marksStore.subscribe, marksStore.get)
export const usePresets = () => useSyncExternalStore(presetsStore.subscribe, presetsStore.get)

type LegacyPrefs = Partial<StampPrefs> & { brand?: string; logo?: string | null; brandPos?: StampPos; brandSize?: number; logoSize?: number }

/**
 * Up to v1.6.1 each setting held a single watermark inline (brand text + logo). Move those into
 * the watermark library (one entry per distinct watermark) and refer to them by id.
 */
function migrateLegacy(raw: LegacyPrefs): StampPrefs {
  const { brand, logo, brandPos, brandSize, logoSize, ...rest } = raw
  const n: StampPrefs = { ...STAMP_DEFAULTS, ...rest, watermarkIds: rest.watermarkIds ?? [] }
  if (brand || logo) {
    const marks = marksStore.get()
    const size = brandSize ?? logoSize ?? 1
    const pos = brandPos ?? 'br'
    let m = marks.find((x) => x.text === (brand ?? '') && x.logo === (logo ?? null) && x.pos === pos && x.size === size)
    if (!m) {
      m = { id: uid(), name: brand || `Logo ${marks.length + 1}`, text: brand ?? '', logo: logo ?? null, pos, size }
      marksStore.set([...marks, m])
    }
    if (!n.watermarkIds.includes(m.id)) n.watermarkIds = [...n.watermarkIds, m.id]
  }
  return n
}

// Migrate once when the module loads, before any screen renders (stores must not change mid-render).
try {
  const presets = presetsStore.get()
  if (presets.some((p) => 'brand' in p.prefs || 'logo' in p.prefs)) presetsStore.set(presets.map((p) => ({ ...p, prefs: migrateLegacy(p.prefs as LegacyPrefs) })))
  const current = loadJSON<LegacyPrefs | null>(KEY, null)
  if (current && ('brand' in current || 'logo' in current)) saveJSON(KEY, migrateLegacy(current))
} catch {
  /* storage unavailable: nothing to migrate */
}

// ---------------------------------------------------------------- current settings

/** Current settings, persisted on every change. `presetId` is the combination they came from. */
export function useStampPrefs() {
  const [prefs, setPrefs] = useState<StampPrefs>(() => ({ ...STAMP_DEFAULTS, ...loadJSON<Partial<StampPrefs>>(KEY, {}) }))
  const [presetId, setPresetId] = useState<string | null>(() => loadJSON<string | null>(`${KEY}.preset`, null))
  const update = useCallback((p: Partial<StampPrefs>) => {
    setPrefs((s) => {
      const n = { ...s, ...p }
      saveJSON(KEY, n)
      return n
    })
  }, [])
  const choosePreset = useCallback((p: StampPreset | null) => {
    setPresetId(p?.id ?? null)
    saveJSON(`${KEY}.preset`, p?.id ?? null)
    if (p) {
      const n = { ...STAMP_DEFAULTS, ...p.prefs }
      saveJSON(KEY, n)
      setPrefs(n)
    }
  }, [])
  return { prefs, update, presetId, choosePreset }
}

/** Live location: GPS coordinates plus a place name from OpenStreetMap (falls back to coordinates). */
export interface Place {
  coords: string
  name: string
}

export async function locate(lang: string): Promise<Place> {
  const pos = await new Promise<GeolocationPosition>((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }),
  )
  const { latitude: lat, longitude: lon } = pos.coords
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lon}&accept-language=${lang}`)
    const j = (await r.json()) as { name?: string; address?: Record<string, string> }
    const a = j.address ?? {}
    const parts = [j.name, a.road, a.suburb ?? a.neighbourhood, a.city ?? a.town ?? a.village ?? a.state].filter((x, i, arr) => x && arr.indexOf(x) === i)
    return { coords, name: parts.slice(0, 3).join(', ') }
  } catch {
    return { coords, name: '' }
  }
}

/** Downscales a picked logo so it fits comfortably in local storage. */
async function logoDataUrl(f: File): Promise<string> {
  return scaleCanvas(await blobToCanvas(f, 2000), 256).toDataURL('image/png')
}

/** Decoded logo images for the given watermarks, keyed by data URL. */
function useLogoImages(marks: Watermark[]): Map<string, HTMLImageElement> {
  const [imgs, setImgs] = useState(() => new Map<string, HTMLImageElement>())
  const urls = marks.map((m) => m.logo).filter((x): x is string => !!x)
  const key = urls.join('|')
  useEffect(() => {
    let alive = true
    Promise.all(
      urls.map(
        (u) =>
          new Promise<[string, HTMLImageElement]>((res) => {
            const i = new Image()
            i.onload = () => res([u, i])
            i.onerror = () => res([u, i])
            i.src = u
          }),
      ),
    ).then((pairs) => alive && setImgs(new Map(pairs)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return imgs
}

/** Builds the drawing options for the current settings. */
export function useStampOptions(prefs: StampPrefs, place: Place | null) {
  const { t, lang } = useApp()
  const all = useWatermarks()
  const used = useMemo(() => prefs.watermarkIds.map((id) => all.find((m) => m.id === id)).filter((m): m is Watermark => !!m), [prefs.watermarkIds, all])
  const imgs = useLogoImages(used)
  return useCallback(
    (when: Date, template: StampTemplate = prefs.template): StampOptions => ({
      ...prefs,
      template,
      when,
      marks: used.map((m): StampMark => ({ text: m.text, logo: m.logo ? imgs.get(m.logo) ?? null : null, pos: m.pos, size: m.size })),
      location: prefs.location || (prefs.autoLocation ? place?.name ?? '' : ''),
      coords: prefs.showCoords ? place?.coords ?? '' : '',
      locale: lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-GB',
      labels: { onSite: t('ts.onSite'), clockIn: t('ts.clockIn'), time: t('ts.time'), location: t('ts.location'), note: t('ts.note'), gps: 'GPS' },
    }),
    [prefs, place, used, imgs, lang, t],
  )
}

// ---------------------------------------------------------------- templates & combinations

const SAMPLE_BG = (() => {
  let c: HTMLCanvasElement | null = null
  return () => {
    if (c) return c
    c = createCanvas(480, 360)
    const x = ctx2d(c)
    const g = x.createLinearGradient(0, 0, 480, 360)
    g.addColorStop(0, '#3b4a5c')
    g.addColorStop(1, '#1d242e')
    x.fillStyle = g
    x.fillRect(0, 0, 480, 360)
    return c
  }
})()

function TemplateThumb({ opts, on, label, onClick }: { opts: StampOptions; on: boolean; label: string; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = 480
    c.height = 360
    ctx2d(c).drawImage(SAMPLE_BG(), 0, 0)
    drawStamp(c, { ...opts, pos: 'tl', size: 1.5 })
  }, [opts])
  return (
    <button className={`stamp-tpl ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      <canvas ref={ref} />
      <span>{label}</span>
    </button>
  )
}

/** The five designs, previewed with the user's real content. */
export function TemplatePicker({ prefs, update, options, when, compact }: { prefs: StampPrefs; update: (p: Partial<StampPrefs>) => void; options: (when: Date, tpl?: StampTemplate) => StampOptions; when: Date; compact?: boolean }) {
  const { t } = useApp()
  return (
    <div className={compact ? 'stamp-tpl-row' : 'stamp-tpl-grid'}>
      {STAMP_TEMPLATES.map((tp) => {
        const o = options(when, tp)
        // Previews show only the time/info design (watermarks would crowd these small tiles), with
        // a sample location when none is set so every template's layout is visible.
        return <TemplateThumb key={tp} opts={{ ...o, marks: [], location: o.location || t('ts.sampleLocation') }} on={prefs.template === tp} label={t(`ts.tpl.${tp}`)} onClick={() => update({ template: tp })} />
      })}
    </div>
  )
}

/** One-tap switching between combinations (used on the camera preview). */
export function CombinationChips({ presetId, choosePreset }: { presetId: string | null; choosePreset: (p: StampPreset | null) => void }) {
  const presets = usePresets()
  if (!presets.length) return null
  return (
    <div className="combo-chips">
      {presets.map((p) => (
        <button key={p.id} className={p.id === presetId ? 'on' : ''} onClick={() => choosePreset(p)}>
          {p.name}
        </button>
      ))}
    </div>
  )
}

/** The user's named combinations: apply, save current as new, update, rename, delete. */
export function PresetBar({ prefs, presetId, choosePreset }: { prefs: StampPrefs; presetId: string | null; choosePreset: (p: StampPreset | null) => void }) {
  const { t, toast } = useApp()
  const presets = usePresets()
  const marks = useWatermarks()
  const active = presets.find((p) => p.id === presetId) ?? null
  const changed = !!active && JSON.stringify({ ...STAMP_DEFAULTS, ...active.prefs }) !== JSON.stringify(prefs)

  const saveNew = () => {
    const name = window.prompt(t('ts.presetName'), `${t('ts.combination')} ${presets.length + 1}`)?.trim()
    if (!name) return
    const p = { id: uid(), name, prefs }
    presetsStore.set([...presets, p])
    choosePreset(p)
    toast(t('saved'))
  }

  const summary = (p: StampPrefs) => {
    const names = p.watermarkIds.map((id) => marks.find((m) => m.id === id)?.name).filter(Boolean)
    return [t(`ts.tpl.${p.template}`), names.length ? names.join(' + ') : t('ts.noWatermark')].join(' · ')
  }

  return (
    <div className="preset-bar">
      <div className="preset-head">
        <span>{t('ts.myCombinations')}</span>
        {active && (
          <span className="row gap">
            <button
              className="link"
              onClick={() => {
                const name = window.prompt(t('ts.presetRename'), active.name)?.trim()
                if (name) presetsStore.set(presets.map((p) => (p.id === active.id ? { ...p, name } : p)))
              }}
            >
              <Icon name="edit" size={14} /> {t('rename')}
            </button>
            <button
              className="link danger-text"
              onClick={() => {
                if (!window.confirm(t('ts.presetDelete', { name: active.name }))) return
                presetsStore.set(presets.filter((p) => p.id !== active.id))
                choosePreset(null)
              }}
            >
              <Icon name="trash" size={14} /> {t('delete')}
            </button>
          </span>
        )}
      </div>
      <div className="chip-row nowrap">
        {presets.map((p) => (
          <button key={p.id} className={`chip ${p.id === presetId ? 'on' : ''}`} onClick={() => choosePreset(p)}>
            {p.name}
          </button>
        ))}
        <button className="chip add" onClick={saveNew}>
          <Icon name="plus" size={16} /> {t('ts.presetSave')}
        </button>
      </div>
      {active && <p className="muted small">{summary(active.prefs)}</p>}
      {changed && (
        <button
          className="btn soft sm"
          onClick={() => {
            presetsStore.set(presets.map((p) => (p.id === active!.id ? { ...p, prefs } : p)))
            toast(t('saved'))
          }}
        >
          <Icon name="check" size={16} /> {t('ts.presetUpdate', { name: active!.name })}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- editing

/** Six spots on a little frame: top / bottom × left / centre / right. */
function PositionPicker({ value, onChange }: { value: StampPos; onChange: (p: StampPos) => void }) {
  const { t } = useApp()
  return (
    <div className="pos-picker" role="radiogroup">
      {STAMP_POSITIONS.map((p) => (
        <button key={p} role="radio" aria-checked={value === p} aria-label={t(`pos.${p}`)} title={t(`pos.${p}`)} className={value === p ? 'on' : ''} onClick={() => onChange(p)}>
          <span />
        </button>
      ))}
    </div>
  )
}

/** Edits one watermark in the library. Changes apply everywhere it is used. */
function WatermarkEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, pickFiles } = useApp()
  const marks = useWatermarks()
  const m = marks.find((x) => x.id === id)
  const set = (p: Partial<Watermark>) => marksStore.set(marks.map((x) => (x.id === id ? { ...x, ...p } : x)))
  return (
    <Sheet open={!!m} onClose={onClose} title={t('ts.editWatermark')}>
      {m && (
        <div className="stack">
          <label className="field">
            <span>{t('ts.watermarkName')}</span>
            <input className="input" value={m.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>{t('ts.watermarkText')}</span>
            <input className="input" value={m.text} maxLength={50} placeholder={t('ts.brandPlaceholder')} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <div className="row gap">
            {m.logo && <img src={m.logo} alt="" className="stamp-logo" />}
            <button
              className="btn soft grow"
              onClick={() =>
                pickFiles({ accept: 'image/*' }).then(async (f) => {
                  if (f.length) set({ logo: await logoDataUrl(f[0]) })
                })
              }
            >
              <Icon name="image" size={18} /> {m.logo ? t('ts.changeLogo') : t('ts.addLogo')}
            </button>
            {m.logo && (
              <button className="btn ghost" onClick={() => set({ logo: null })}>
                {t('delete')}
              </button>
            )}
          </div>
          <div className="field">
            <span>{t('ts.brandPosition')}</span>
            <PositionPicker value={m.pos} onChange={(v) => set({ pos: v })} />
          </div>
          <label className="slider">
            <span>{t('ts.brandSize')}</span>
            <input type="range" min={0.5} max={4} step={0.1} value={m.size} onChange={(e) => set({ size: +e.target.value })} />
          </label>
          <p className="muted small">{t('ts.watermarkShared')}</p>
          <div className="row gap">
            <button
              className="btn danger"
              onClick={() => {
                if (!window.confirm(t('ts.watermarkDelete', { name: m.name }))) return
                marksStore.set(marks.filter((x) => x.id !== m.id))
                onClose()
              }}
            >
              <Icon name="trash" size={18} />
            </button>
            <button className="btn primary grow" onClick={onClose}>
              {t('done')}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

/** The watermark library, with a switch per watermark for whether it is used in the current settings. */
function WatermarkList({ prefs, update }: { prefs: StampPrefs; update: (p: Partial<StampPrefs>) => void }) {
  const { t } = useApp()
  const marks = useWatermarks()
  const [editing, setEditing] = useState<string | null>(null)
  const toggle = (id: string) => update({ watermarkIds: prefs.watermarkIds.includes(id) ? prefs.watermarkIds.filter((x) => x !== id) : [...prefs.watermarkIds, id] })
  const create = () => {
    const m: Watermark = { id: uid(), name: `${t('ts.watermark')} ${marks.length + 1}`, text: '', logo: null, pos: 'br', size: 1 }
    marksStore.set([...marks, m])
    update({ watermarkIds: [...prefs.watermarkIds, m.id] })
    setEditing(m.id)
  }
  return (
    <div className="field">
      <span>{t('ts.myWatermarks')}</span>
      {marks.length === 0 && <p className="muted small">{t('ts.noWatermarksYet')}</p>}
      <div className="wm-list">
        {marks.map((m) => {
          const on = prefs.watermarkIds.includes(m.id)
          return (
            <div key={m.id} className={`wm-row ${on ? 'on' : ''}`}>
              <button className="wm-main" onClick={() => toggle(m.id)} aria-pressed={on}>
                <span className={`check ${on ? 'on' : ''}`}>{on && <Icon name="check" size={14} stroke={2.6} />}</span>
                {m.logo ? (
                  <img src={m.logo} alt="" className="wm-logo" />
                ) : (
                  <span className="wm-logo text-only" aria-hidden="true">
                    <Icon name="text" size={18} />
                  </span>
                )}
                <span className="wm-text">
                  <strong>{m.name || t('ts.watermark')}</strong>
                  <span className="muted small">{[m.text, t(`pos.${m.pos}`)].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              <button className="icon-btn" onClick={() => setEditing(m.id)} aria-label={t('ts.editWatermark')}>
                <Icon name="edit" size={18} />
              </button>
            </div>
          )
        })}
      </div>
      <button className="btn soft" onClick={create}>
        <Icon name="plus" size={18} /> {t('ts.newWatermark')}
      </button>
      <WatermarkEditor id={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

/** Content fields. `when`/`setWhen` only for album photos; the camera always uses the live time. */
export function StampContentForm({ prefs, update, place, setPlace, when, setWhen, live }: { prefs: StampPrefs; update: (p: Partial<StampPrefs>) => void; place: Place | null; setPlace: (p: Place | null) => void; when?: Date; setWhen?: (d: Date) => void; live?: boolean }) {
  const { t, lang, toast } = useApp()
  const [locating, setLocating] = useState(false)
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
  const refresh = async () => {
    setLocating(true)
    try {
      setPlace(await locate(lang))
    } catch {
      toast(t('ts.locationFailed'))
    } finally {
      setLocating(false)
    }
  }
  return (
    <div className="stack">
      <h3 className="form-group-title">{t('ts.timeAndInfo')}</h3>
      {when && setWhen && (
        <label className="field">
          <span>{t('dateTime')}</span>
          <input className="input" type="datetime-local" step={1} value={local(when)} onChange={(e) => e.target.value && setWhen(new Date(e.target.value))} />
        </label>
      )}
      <div className="row gap wrap">
        <label className="switch-row grow">
          <span>{t('ts.hour24')}</span>
          <input type="checkbox" className="switch" checked={prefs.hour24} onChange={(e) => update({ hour24: e.target.checked })} />
        </label>
        <label className="switch-row grow">
          <span>{t('ts.showDate')}</span>
          <input type="checkbox" className="switch" checked={prefs.showDate} onChange={(e) => update({ showDate: e.target.checked })} />
        </label>
      </div>
      <div className="field">
        <span>{t('ts.location')}</span>
        <input className="input" value={prefs.location} maxLength={80} placeholder={place?.name || t('ts.locationPlaceholder')} onChange={(e) => update({ location: e.target.value })} />
        {live && (
          <label className="switch-row">
            <span>{t('ts.autoLocation')}</span>
            <input type="checkbox" className="switch" checked={prefs.autoLocation} onChange={(e) => update({ autoLocation: e.target.checked })} />
          </label>
        )}
        <label className="switch-row">
          <span>{t('ts.showCoords')}</span>
          <input type="checkbox" className="switch" checked={prefs.showCoords} onChange={(e) => update({ showCoords: e.target.checked })} />
        </label>
        <button className="btn soft" disabled={locating || !navigator.geolocation} onClick={refresh}>
          <Icon name="globe" size={18} /> {locating ? t('ts.locating') : place ? `${t('ts.refreshLocation')} · ${place.coords}` : t('ts.useLocation')}
        </button>
        <p className="muted small">{t('ts.locationNote')}</p>
      </div>
      <label className="field">
        <span>{t('ts.note')}</span>
        <input className="input" value={prefs.note} maxLength={80} placeholder={t('ts.notePlaceholder')} onChange={(e) => update({ note: e.target.value })} />
      </label>
      <div className="field">
        <span>{t('ts.infoPosition')}</span>
        <PositionPicker value={prefs.pos} onChange={(v) => update({ pos: v })} />
      </div>
      <label className="slider">
        <span>{t('textSize')}</span>
        <input type="range" min={0.6} max={1.6} step={0.05} value={prefs.size} onChange={(e) => update({ size: +e.target.value })} />
      </label>
      <h3 className="form-group-title">{t('ts.watermarks')}</h3>
      <WatermarkList prefs={prefs} update={update} />
    </div>
  )
}
