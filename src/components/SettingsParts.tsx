import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Screen, Sheet } from './ui'
import { APP_VERSION, CHANGELOG, compareVersions, type Release } from '../changelog'
import { formatBytes } from '../lib/image'
import { loadJSON, saveJSON } from '../lib/settings'
import { applyUpdate, checkForUpdate, onUpdateReady } from '../lib/update'
import { useApp, useDocs } from '../state'
import { resolveTheme, THEME_ORDER, type ThemeId } from '../themes'

// ---------------------------------------------------------------- themes

function ThemePreview({ id }: { id: ThemeId }) {
  const v = resolveTheme(id)
  const half = id === 'system'
  return (
    <span className="theme-prev" style={{ background: half ? 'linear-gradient(135deg, #f4f6f9 50%, #0e1116 50%)' : v.bg, borderColor: v.line }}>
      <span className="theme-prev-card" style={{ background: half ? 'rgba(127,127,127,.35)' : v.card2 }} />
      <span className="theme-prev-card short" style={{ background: half ? 'rgba(127,127,127,.35)' : v.card2 }} />
      <span className="theme-prev-bar" style={{ background: half ? 'rgba(127,127,127,.25)' : v.bg2 }}>
        <span className="theme-prev-fab" style={{ background: `linear-gradient(135deg, ${v.accent}, ${v.accent2})` }} />
      </span>
    </span>
  )
}

export function ThemeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, settings, setSettings } = useApp()
  return (
    <Sheet open={open} onClose={onClose} title={t('theme')}>
      <div className="theme-grid">
        {THEME_ORDER.map((id) => (
          <button key={id} className={`theme-tile ${settings.theme === id ? 'on' : ''}`} onClick={() => setSettings({ theme: id })} aria-pressed={settings.theme === id}>
            <ThemePreview id={id} />
            <span className="theme-name">
              {settings.theme === id && <Icon name="check" size={14} stroke={3} />} {t(`themeName.${id}`)}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function ThemeSwatch({ id }: { id: ThemeId }) {
  const v = resolveTheme(id)
  return <span className="theme-dot" style={{ background: `linear-gradient(135deg, ${v.bg} 50%, ${v.accent} 50%)`, borderColor: v.line }} />
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
