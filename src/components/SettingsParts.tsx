import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Screen, Segmented, Sheet } from './ui'
import { APP_VERSION, CHANGELOG, compareVersions, type Release } from '../changelog'
import { formatBytes } from '../lib/image'
import { loadJSON, saveJSON } from '../lib/settings'
import { applyUpdate, checkForUpdate, onUpdateReady } from '../lib/update'
import { useApp, useDocs } from '../state'
import { DARK_LOOKS, LIGHT_LOOKS, LOOK_COLOURS, type Look } from '../themes'

// ---------------------------------------------------------------- appearance

function Looks<T extends Look>({ looks, current, onPick }: { looks: readonly T[]; current: T; onPick: (l: T) => void }) {
  const { t } = useApp()
  return (
    <div className="looks">
      {looks.map((l) => {
        const [bg, card, accent] = LOOK_COLOURS[l]
        return (
          <button key={l} className={`look ${l === current ? 'on' : ''}`} aria-pressed={l === current} onClick={() => onPick(l)}>
            <span className="look-prev" style={{ background: bg }}>
              <span className="look-card" style={{ background: card }}>
                <i style={{ background: accent }} />
                <b />
              </span>
            </span>
            <span className="look-name">{t(`look.${l}`)}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ThemeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, settings, setSettings } = useApp()
  return (
    <Sheet open={open} onClose={onClose} title={t('theme')}>
      <Segmented
        value={settings.theme}
        onChange={(v) => setSettings({ theme: v })}
        options={[
          { value: 'auto', label: t('themeAuto') },
          { value: 'light', label: t('light') },
          { value: 'dark', label: t('dark') },
        ]}
      />
      <p className="theme-note">{t('themeNote')}</p>
      <div className="looks-title">{t('lightLooks')}</div>
      {/* Picking a look on the other side while the mode is fixed switches to that side, so the tap is visible. */}
      <Looks looks={LIGHT_LOOKS} current={settings.lightLook} onPick={(l) => setSettings({ lightLook: l, ...(settings.theme === 'dark' ? { theme: 'light' as const } : {}) })} />
      <div className="looks-title">{t('darkLooks')}</div>
      <Looks looks={DARK_LOOKS} current={settings.darkLook} onPick={(l) => setSettings({ darkLook: l, ...(settings.theme === 'light' ? { theme: 'dark' as const } : {}) })} />
      <div style={{ height: 12 }} />
    </Sheet>
  )
}

export function ThemeSwatch({ look }: { look: Look }) {
  const [bg, , accent] = LOOK_COLOURS[look]
  return <span className="theme-dot" style={{ background: `linear-gradient(135deg, ${bg} 50%, ${accent} 50%)` }} />
}

// ---------------------------------------------------------------- what's new / history

const SEEN_KEY = 'anyscan.lastSeenVersion'

export function ReleaseNotes({ r, latest }: { r: Release; latest?: boolean }) {
  const { t, lang } = useApp()
  return (
    <div className="release">
      <div className="release-head">
        <span className="release-ver">v{r.version}</span>
        {latest && <span className="badge">{t('current')}</span>}
        <span className="muted small">{r.date}</span>
      </div>
      <ul>
        {r.notes[lang].map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  )
}

export function WhatsNewSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, push } = useApp()
  const current = CHANGELOG.find((r) => r.version === APP_VERSION) ?? CHANGELOG[0]
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className="row gap-sm">
          <Icon name="quality" /> {t('whatsNew')}
        </span>
      }
    >
      <div className="stack">
        <ReleaseNotes r={current} latest />
        <div className="row gap">
          <button
            className="btn soft grow"
            onClick={() => {
              onClose()
              push('history')
            }}
          >
            {t('updateHistory')}
          </button>
          <button className="btn primary grow" onClick={onClose}>
            {t('gotIt')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** True once per new version for people who used an earlier version. */
export function useShowWhatsNewOnUpgrade(): [boolean, () => void] {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const seen = loadJSON<string | null>(SEEN_KEY, null)
    // Earlier versions didn't record this; an existing settings entry means it's an upgrade, not a new install.
    const usedBefore = (() => {
      try {
        return localStorage.getItem('anyscan.settings') != null
      } catch {
        return false
      }
    })()
    if (seen ? compareVersions(seen, APP_VERSION) < 0 : usedBefore) setShow(true)
    saveJSON(SEEN_KEY, APP_VERSION)
  }, [])
  return [show, () => setShow(false)]
}

export function HistoryScreen() {
  const { t } = useApp()
  return (
    <Screen title={t('updateHistory')}>
      <div className="pad stack">
        {CHANGELOG.map((r, i) => (
          <ReleaseNotes key={r.version} r={r} latest={i === 0} />
        ))}
      </div>
    </Screen>
  )
}

// ---------------------------------------------------------------- updates

export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => onUpdateReady(setReady), [])
  return ready
}

export function UpdateBanner() {
  const { t } = useApp()
  const ready = useUpdateReady()
  const [dismissed, setDismissed] = useState(false)
  if (!ready || dismissed) return null
  return (
    <div className="update-banner" role="status">
      <Icon name="download" size={20} />
      <span>{t('updateReady')}</span>
      <button className="btn primary sm" onClick={applyUpdate}>
        {t('updateNow')}
      </button>
      <button className="icon-btn sm" onClick={() => setDismissed(true)} aria-label={t('close')}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

export function CheckUpdateRow() {
  const { t, toast } = useApp()
  const ready = useUpdateReady()
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="setting"
      disabled={busy}
      onClick={async () => {
        if (ready) return applyUpdate()
        setBusy(true)
        const r = await checkForUpdate()
        setBusy(false)
        if (r === 'latest' || r === 'unsupported') toast(t('upToDate', { v: APP_VERSION }))
        else if (r === 'offline') toast(t('updateOffline'))
      }}
    >
      <Icon name="rotateR" />
      <span>{ready ? t('updateNow') : t('checkUpdates')}</span>
      <span className="setting-value">{busy ? t('checking') : ready ? <span className="badge">{t('newBadge')}</span> : `v${APP_VERSION}`}</span>
    </button>
  )
}

// ---------------------------------------------------------------- storage

export function StorageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useApp()
  const docs = useDocs()
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) return
    navigator.storage?.estimate?.().then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
    navigator.storage?.persisted?.().then(setPersisted)
  }, [open, docs])

  const pct = est && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0
  return (
    <Sheet open={open} onClose={onClose} title={t('storage')}>
      <div className="stack">
        <div className="storage-meter">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{est ? formatBytes(est.usage) : '…'}</strong>
            <span className="muted small">{est?.quota ? t('ofAvailable', { size: formatBytes(est.quota) }) : ''}</span>
          </div>
          <div className="progress">
            <div style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
          <span className="muted small">{t('nDocs', { n: docs?.length ?? 0 })}</span>
        </div>
        <div className="info-box">
          <p>{t('storageExplain1')}</p>
          <p>{t('storageExplain2')}</p>
        </div>
        <div className="setting-row">
          <Icon name="lock" />
          <span className="grow">{t('protectedStorage')}</span>
          {persisted ? (
            <span className="badge ok">{t('yes')}</span>
          ) : (
            <button className="btn soft sm" onClick={() => navigator.storage?.persist?.().then(setPersisted)}>
              {t('requestProtect')}
            </button>
          )}
        </div>
        <p className="muted small">{t('storageExplain3')}</p>
      </div>
    </Sheet>
  )
}
