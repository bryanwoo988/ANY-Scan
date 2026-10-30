// Timestamp settings shared by the Timestamp screen (album photos) and the camera's live
// Timestamp mode: current settings, named saved templates, and the editing UI.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { blobToCanvas, createCanvas, ctx2d, scaleCanvas } from '../lib/image'
import { loadJSON, saveJSON } from '../lib/settings'
import { drawStamp, STAMP_POSITIONS, STAMP_TEMPLATES, type StampOptions, type StampPos, type StampTemplate } from '../lib/stamp'
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
  brand: string
  logo: string | null // data URL
  brandPos: StampPos // the watermark (logo + text) has its own position…
  brandSize: number // …and size
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
export const STAMP_DEFAULTS: StampPrefs = {
  template: 'timeLocation',
  hour24: false,
  showDate: true,
  location: '',
  autoLocation: true,
  showCoords: true,
  note: '',
  brand: '',
  logo: null,
  brandPos: 'br',
  brandSize: 1,
  pos: 'bl',
  size: 1,
}

/** Current settings, persisted on every change. `presetId` is the saved template they came from. */
/** Fills in defaults and carries over settings saved by older versions. */
function normalize(raw: Partial<StampPrefs> & { logoSize?: number }): StampPrefs {
  const n = { ...STAMP_DEFAULTS, ...raw }
  // v1.6.0 had a "Logo size" that scaled only the logo; it becomes the watermark size.
  if (raw.brandSize == null && raw.logoSize != null) n.brandSize = raw.logoSize
  delete (n as { logoSize?: number }).logoSize
  return n
}

export function useStampPrefs() {
  const [prefs, setPrefs] = useState<StampPrefs>(() => normalize(loadJSON<Partial<StampPrefs>>(KEY, {})))
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
      const n = normalize(p.prefs)
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

export function useLogo(dataUrl: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!dataUrl) return setImg(null)
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = dataUrl
  }, [dataUrl])
  return img
}

/** Builds the drawing options for the current settings. */
export function useStampOptions(prefs: StampPrefs, place: Place | null) {
  const { t, lang } = useApp()
  const logo = useLogo(prefs.logo)
  return useCallback(
    (when: Date, template: StampTemplate = prefs.template): StampOptions => ({
      ...prefs,
      template,
      when,
      logo,
      location: prefs.location || (prefs.autoLocation ? place?.name ?? '' : ''),
      coords: prefs.showCoords ? place?.coords ?? '' : '',
      locale: lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-GB',
      labels: { onSite: t('ts.onSite'), clockIn: t('ts.clockIn'), time: t('ts.time'), location: t('ts.location'), note: t('ts.note'), gps: 'GPS' },
    }),
    [prefs, place, logo, lang, t],
  )
}

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
        // Previews show a sample location when none is set, so every template's layout is visible.
        return <TemplateThumb key={tp} opts={{ ...o, location: o.location || t('ts.sampleLocation') }} on={prefs.template === tp} label={t(`ts.tpl.${tp}`)} onClick={() => update({ template: tp })} />
      })}
    </div>
  )
}

/** The user's named templates: apply, save current as new, update, rename, delete. */
export function PresetBar({ prefs, presetId, choosePreset }: { prefs: StampPrefs; presetId: string | null; choosePreset: (p: StampPreset | null) => void }) {
  const { t, toast } = useApp()
  const [presets, setPresets] = useState<StampPreset[]>(() => loadJSON<StampPreset[]>(PRESETS_KEY, []))
  const store = (list: StampPreset[]) => {
    setPresets(list)
    saveJSON(PRESETS_KEY, list)
  }
  const active = presets.find((p) => p.id === presetId) ?? null
  const changed = !!active && JSON.stringify(normalize(active.prefs)) !== JSON.stringify(prefs)

  const saveNew = () => {
    const name = window.prompt(t('ts.presetName'), `${t('ts.template')} ${presets.length + 1}`)?.trim()
    if (!name) return
    const p = { id: uid(), name, prefs }
    store([...presets, p])
    choosePreset(p)
    toast(t('saved'))
  }

  return (
    <div className="preset-bar">
      <div className="preset-head">
        <span>{t('ts.myTemplates')}</span>
        {active && (
          <span className="row gap">
            <button
              className="link"
              onClick={() => {
                const name = window.prompt(t('ts.presetRename'), active.name)?.trim()
                if (name) store(presets.map((p) => (p.id === active.id ? { ...p, name } : p)))
              }}
            >
              <Icon name="edit" size={14} /> {t('rename')}
            </button>
            <button
              className="link danger-text"
              onClick={() => {
                if (!window.confirm(t('ts.presetDelete', { name: active.name }))) return
                store(presets.filter((p) => p.id !== active.id))
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
      {changed && (
        <button
          className="btn soft sm"
          onClick={() => {
            store(presets.map((p) => (p.id === active!.id ? { ...p, prefs } : p)))
            toast(t('saved'))
          }}
        >
          <Icon name="check" size={16} /> {t('ts.presetUpdate', { name: active!.name })}
        </button>
      )}
    </div>
  )
}

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

/** Content fields. `when`/`setWhen` only for album photos; the camera always uses the live time. */
export function StampContentForm({ prefs, update, place, setPlace, when, setWhen, live }: { prefs: StampPrefs; update: (p: Partial<StampPrefs>) => void; place: Place | null; setPlace: (p: Place | null) => void; when?: Date; setWhen?: (d: Date) => void; live?: boolean }) {
  const { t, lang, toast, pickFiles } = useApp()
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
      <div className="field">
        <span>{t('ts.myWatermark')}</span>
        <input className="input" value={prefs.brand} maxLength={50} placeholder={t('ts.brandPlaceholder')} onChange={(e) => update({ brand: e.target.value })} />
        <div className="row gap">
          {prefs.logo && <img src={prefs.logo} alt="" className="stamp-logo" />}
          <button
            className="btn soft grow"
            onClick={() =>
              pickFiles({ accept: 'image/*' }).then(async (f) => {
                if (f.length) update({ logo: await logoDataUrl(f[0]) })
              })
            }
          >
            <Icon name="image" size={18} /> {prefs.logo ? t('ts.changeLogo') : t('ts.addLogo')}
          </button>
          {prefs.logo && (
            <button className="btn ghost" onClick={() => update({ logo: null })}>
              {t('delete')}
            </button>
          )}
        </div>
        {(prefs.logo || prefs.brand) && (
          <>
            <div className="field">
              <span>{t('ts.brandPosition')}</span>
              <PositionPicker value={prefs.brandPos} onChange={(v) => update({ brandPos: v })} />
            </div>
            <label className="slider">
              <span>{t('ts.brandSize')}</span>
              <input type="range" min={0.5} max={4} step={0.1} value={prefs.brandSize} onChange={(e) => update({ brandSize: +e.target.value })} />
            </label>
          </>
        )}
      </div>
    </div>
  )
}
