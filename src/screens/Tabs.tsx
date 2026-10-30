import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { DocRow, Empty, Segmented, Sheet, TextDialog, ToolTile } from '../components/ui'
import { LANGS, makeT, type Lang } from '../i18n'
import { clearAll, deleteDocs, renameDoc, type DocRec } from '../lib/db'
import { formatBytes, FILTERS } from '../lib/image'
import { useApp, useDocs } from '../state'
import { HOME_TOOLS, SECTIONS, TOOLS, useTools, type ToolId } from '../tools'

function useToolSearch(q: string): ToolId[] {
  return useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    // Match against every language so e.g. "QR" or "二维码" both work whatever the UI language.
    const ts = LANGS.map((l) => makeT(l.code))
    return (Object.keys(TOOLS) as ToolId[]).filter((id) => ts.some((t) => t(TOOLS[id].label).toLowerCase().includes(s)))
  }, [q])
}

function InstallHint() {
  const { t } = useApp()
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('anyscan.installHint') === '1'
    } catch {
      return false
    }
  })
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  if (hidden || standalone || !ios) return null
  return (
    <div className="banner">
      <Icon name="download" />
      <span>{t('installHint')}</span>
      <button
        className="icon-btn"
        aria-label={t('close')}
        onClick={() => {
          setHidden(true)
          try {
            localStorage.setItem('anyscan.installHint', '1')
          } catch {
            /* ignore */
          }
        }}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}

export function HomeTab() {
  const { t, push, setTab } = useApp()
  const { run } = useTools()
  const docs = useDocs()
  const [q, setQ] = useState('')
  const found = useToolSearch(q)

  return (
    <div className="tab-page">
      <div className="topbar">
        <label className="search">
          <Icon name="search" size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchTools')} enterKeyHint="search" />
          {q && (
            <button className="icon-btn sm" onClick={() => setQ('')} aria-label={t('close')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
      </div>
      {q ? (
        <div className="tool-grid pad">
          {found.map((id) => (
            <ToolTile key={id} icon={TOOLS[id].icon} color={TOOLS[id].color} label={t(TOOLS[id].label)} onClick={() => run(id)} />
          ))}
          {!found.length && <p className="muted center-text full">{t('noResults')}</p>}
        </div>
      ) : (
        <>
          <div className="tool-grid pad">
            {HOME_TOOLS.map((id) => (
              <ToolTile key={id} icon={TOOLS[id].icon} color={TOOLS[id].color} label={t(TOOLS[id].label)} onClick={() => run(id)} />
            ))}
            <ToolTile icon="grid" color="#8a94a6" label={t('all')} onClick={() => setTab('tools')} />
          </div>
          <InstallHint />
          <section className="card-section">
            <div className="section-head">
              <h2>{t('recents')}</h2>
              <button className="link" onClick={() => setTab('docs')}>
                {t('viewAll')} <Icon name="chevron" size={16} />
              </button>
            </div>
            {docs && docs.length === 0 && (
              <Empty icon="scan" text={t('noDocsYet')}>
                <button className="btn primary" onClick={() => run('smartScan')}>
                  <Icon name="camera" size={20} /> {t('tool.smartScan')}
                </button>
              </Empty>
            )}
            {docs?.slice(0, 6).map((d, i) => (
              <DocRow
                key={d.id}
                doc={d}
                onClick={() => push('doc', { id: d.id })}
                actions={
                  i === 0 ? (
                    <>
                      <button className="btn soft" onClick={() => push('export', { docId: d.id })}>
                        {t('share')}
                      </button>
                      <button className="btn soft" onClick={() => push('ocr', { docId: d.id, docx: true })}>
                        <Icon name="word" size={18} /> {t('tool.toWord')}
                      </button>
                      <button className="btn soft" onClick={() => push('doc', { id: d.id })}>
                        {t('view')}
                      </button>
                    </>
                  ) : undefined
                }
              />
            ))}
          </section>
        </>
      )}
    </div>
  )
}

export function DocsTab() {
  const { t, push, toast } = useApp()
  const docs = useDocs()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'date' | 'name'>('date')
  const [sel, setSel] = useState<string[]>([])
  const [renaming, setRenaming] = useState<DocRec | null>(null)

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (docs ?? []).filter((d) => !s || d.name.toLowerCase().includes(s))
    return sort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list
  }, [docs, q, sort])

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="tab-page">
      <div className="topbar">
        <h1 className="tab-title">{t('tab.docs')}</h1>
      </div>
      <div className="pad stack-sm">
        <label className="search">
          <Icon name="search" size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchDocs')} />
        </label>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'date', label: t('sortDate') },
            { value: 'name', label: t('sortName') },
          ]}
        />
      </div>
      {docs && docs.length === 0 && <Empty icon="docs" text={t('noDocsYet')} />}
      <div className="list">
        {shown.map((d) => (
          <DocRow key={d.id} doc={d} onClick={() => push('doc', { id: d.id })} selected={sel.includes(d.id)} onSelect={() => toggle(d.id)} />
        ))}
      </div>
      {sel.length > 0 && (
        <div className="selection-bar">
          <span>{t('nSelected', { n: sel.length })}</span>
          {sel.length === 1 && (
            <button className="btn soft" onClick={() => setRenaming(docs!.find((d) => d.id === sel[0]) ?? null)}>
              <Icon name="edit" size={18} />
            </button>
          )}
          {sel.length > 1 && (
            <button className="btn soft" onClick={() => push('merge', { docIds: sel })}>
              <Icon name="merge" size={18} /> {t('tool.merge')}
            </button>
          )}
          <button
            className="btn danger"
            onClick={async () => {
              if (!window.confirm(t('confirmDelete', { n: sel.length }))) return
              await deleteDocs(sel)
              setSel([])
              toast(t('deleted'))
            }}
          >
            <Icon name="trash" size={18} />
          </button>
          <button className="icon-btn" onClick={() => setSel([])} aria-label={t('close')}>
            <Icon name="close" />
          </button>
        </div>
      )}
      <TextDialog
        open={!!renaming}
        title={t('rename')}
        initial={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onOk={async (v) => {
          if (renaming) await renameDoc(renaming.id, v)
          setRenaming(null)
          setSel([])
        }}
      />
    </div>
  )
}

export function ToolsTab() {
  const { t } = useApp()
  const { run } = useTools()
  return (
    <div className="tab-page">
      <div className="topbar">
        <h1 className="tab-title">{t('tab.tools')}</h1>
      </div>
      {SECTIONS.map((s) => (
        <section key={s.title} className="tool-section">
          <h2>{t(s.title)}</h2>
          <div className="tool-grid">
            {s.tools.map((id) => (
              <ToolTile key={id} icon={TOOLS[id].icon} color={TOOLS[id].color} label={t(TOOLS[id].label)} onClick={() => run(id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function MeTab() {
  const { t, settings, setSettings, lang, toast } = useApp()
  const [usage, setUsage] = useState<string>('')
  const [sheet, setSheet] = useState<null | 'lang'>(null)
  const docs = useDocs()

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(formatBytes(e.usage ?? 0)))
  }, [docs])

  return (
    <div className="tab-page">
      <div className="topbar">
        <h1 className="tab-title">{t('tab.me')}</h1>
      </div>
      <div className="profile pad">
        <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} width={64} height={64} alt="" className="profile-logo" />
        <div>
          <div className="profile-name">AnyScan</div>
          <div className="muted">{t('tagline')}</div>
        </div>
      </div>

      <div className="settings">
        <button className="setting" onClick={() => setSheet('lang')}>
          <Icon name="globe" />
          <span>{t('language')}</span>
          <span className="setting-value">{settings.lang ? LANGS.find((l) => l.code === lang)?.name : `${t('followSystem')} (${LANGS.find((l) => l.code === lang)?.name})`}</span>
          <Icon name="chevron" size={18} />
        </button>
        <div className="setting col">
          <div className="setting-row">
            <Icon name="moon" />
            <span>{t('theme')}</span>
          </div>
          <Segmented
            value={settings.theme}
            onChange={(v) => setSettings({ theme: v })}
            options={[
              { value: 'system', label: t('followSystem') },
              { value: 'dark', label: t('dark') },
              { value: 'light', label: t('light') },
            ]}
          />
        </div>
        <div className="setting col">
          <div className="setting-row">
            <Icon name="pagesize" />
            <span>{t('pdfPageSize')}</span>
          </div>
          <Segmented
            value={settings.pageSize}
            onChange={(v) => setSettings({ pageSize: v })}
            options={[
              { value: 'auto', label: t('size.auto') },
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'Letter' },
            ]}
          />
        </div>
        <div className="setting col">
          <div className="setting-row">
            <Icon name="quality" />
            <span>{t('defaultQuality')}</span>
          </div>
          <Segmented
            value={settings.quality}
            onChange={(v) => setSettings({ quality: v })}
            options={[
              { value: 'high', label: t('q.high') },
              { value: 'medium', label: t('q.medium') },
              { value: 'small', label: t('q.small') },
            ]}
          />
        </div>
        <div className="setting col">
          <div className="setting-row">
            <Icon name="filter" />
            <span>{t('defaultFilter')}</span>
          </div>
          <div className="chip-row">
            {FILTERS.map((f) => (
              <button key={f} className={`chip ${settings.defaultFilter === f ? 'on' : ''}`} onClick={() => setSettings({ defaultFilter: f })}>
                {t(`filter.${f}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <Icon name="storage" />
          <span>{t('storage')}</span>
          <span className="setting-value">
            {t('nDocs', { n: docs?.length ?? 0 })} · {usage}
          </span>
        </div>
        <button
          className="setting danger-text"
          onClick={async () => {
            if (!window.confirm(t('confirmClearAll'))) return
            await clearAll()
            toast(t('deleted'))
          }}
        >
          <Icon name="trash" />
          <span>{t('clearAll')}</span>
        </button>
      </div>
      <div className="about pad muted">
        <p>
          <Icon name="lock" size={16} /> {t('privacyNote')}
        </p>
        <p>AnyScan v1.0.0</p>
      </div>

      <Sheet open={sheet === 'lang'} onClose={() => setSheet(null)} title={t('language')}>
        <div className="option-list">
          <button
            className={`option ${settings.lang === null ? 'on' : ''}`}
            onClick={() => {
              setSettings({ lang: null })
              setSheet(null)
            }}
          >
            {t('followSystem')}
            {settings.lang === null && <Icon name="check" />}
          </button>
          {LANGS.map((l) => (
            <button
              key={l.code}
              className={`option ${settings.lang === l.code ? 'on' : ''}`}
              onClick={() => {
                setSettings({ lang: l.code as Lang })
                setSheet(null)
              }}
            >
              {l.name}
              {settings.lang === l.code && <Icon name="check" />}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  )
}
