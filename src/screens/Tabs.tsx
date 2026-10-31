import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { ShareAppCard } from '../components/ShareApp'
import { CheckUpdateRow, StorageSheet, ThemeSheet, ThemeSwatch, WhatsNewSheet } from '../components/SettingsParts'
import { APP_VERSION } from '../changelog'
import { activeLook } from '../themes'
import { DocRow, Empty, Segmented, Sheet, TextDialog, ToolTile } from '../components/ui'
import { LANGS, makeT, type Lang } from '../i18n'
import { BIN_DAYS, clearAll, createAlbum, listBin, onDbChange, renameAlbum, trashAlbum } from '../lib/db'
import { useDocActions } from '../components/DocActions'
import { useDragSelect } from '../components/dragSelect'
import { formatBytes, FILTERS } from '../lib/image'
import { useAlbums, useApp, useDocs } from '../state'
import { FAVORITES_MAX, SECTIONS, TOOLS, useFavorites, useIsNew, useTools, type ToolId } from '../tools'

const ALL_TOOLS = Object.keys(TOOLS) as ToolId[]

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

function FavoritesSheet({ open, onClose, favs, setFavs }: { open: boolean; onClose: () => void; favs: ToolId[]; setFavs: (ids: ToolId[]) => void }) {
  const { t, toast } = useApp()
  const toggle = (id: ToolId) => {
    if (favs.includes(id)) return setFavs(favs.filter((x) => x !== id))
    if (favs.length >= FAVORITES_MAX) return toast(t('favFull', { n: FAVORITES_MAX }))
    setFavs([...favs, id])
  }
  return (
    <Sheet open={open} onClose={onClose} title={`${t('favorites')} · ${favs.length}/${FAVORITES_MAX}`}>
      <p className="muted small">{t('favHint', { n: FAVORITES_MAX })}</p>
      {SECTIONS.map((s) => (
        <div key={s.title} className="fav-section">
          <h3>{t(s.title)}</h3>
          {s.tools.map((id) => {
            const on = favs.includes(id)
            return (
              <button key={id} className={`fav-row ${on ? 'on' : ''}`} onClick={() => toggle(id)} aria-pressed={on}>
                <span className="fav-icon" style={{ color: TOOLS[id].color, background: `color-mix(in srgb, ${TOOLS[id].color} 16%, transparent)` }}>
                  <Icon name={TOOLS[id].icon} size={20} />
                </span>
                <span className="grow">{t(TOOLS[id].label)}</span>
                <span className="fav-star">{on ? '★' : '☆'}</span>
              </button>
            )
          })}
        </div>
      ))}
      <button className="btn primary block" onClick={onClose} style={{ marginTop: 12 }}>
        {t('done')}
      </button>
    </Sheet>
  )
}

export function HomeTab() {
  const { t, push, setTab } = useApp()
  const { run } = useTools()
  const isNew = useIsNew()
  const docs = useDocs()
  const [q, setQ] = useState('')
  const found = useToolSearch(q)
  const [favs, setFavs] = useFavorites()
  const actions = useDocActions()
  const [editFavs, setEditFavs] = useState(false)

  return (
    <div className="tab-page home">
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
            <ToolTile key={id} icon={TOOLS[id].icon} color={TOOLS[id].color} label={t(TOOLS[id].label)} onClick={() => run(id)} isNew={isNew(id)} />
          ))}
          {!found.length && <p className="muted center-text full">{t('noResults')}</p>}
        </div>
      ) : (
        <>
          <div className="fav-head">
            <h2>
              <Icon name="quality" size={18} /> {t('favorites')}
            </h2>
            <button className="link" onClick={() => setEditFavs(true)}>
              <Icon name="edit" size={15} /> {t('editFavorites')}
            </button>
          </div>
          <div className="tool-grid pad">
            {favs.map((id) => (
              <ToolTile key={id} icon={TOOLS[id].icon} color={TOOLS[id].color} label={t(TOOLS[id].label)} onClick={() => run(id)} isNew={isNew(id)} />
            ))}
            {/* New tools that aren't pinned are announced on "All". */}
            <ToolTile icon="grid" color="#8a94a6" label={t('all')} onClick={() => setTab('tools')} isNew={ALL_TOOLS.some((id) => isNew(id) && !favs.includes(id))} />
          </div>
          <FavoritesSheet open={editFavs} onClose={() => setEditFavs(false)} favs={favs} setFavs={setFavs} />
          {actions.sheets}
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
                swipe={actions.swipe(d)}
                onLongPress={() => actions.menu(d)}
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
  const { t, push } = useApp()
  const docs = useDocs()
  const albums = useAlbums()
  const [sel, setSel] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const actions = useDocActions({ onSelect: (d) => setSel([d.id]) })
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'date' | 'name'>('date')
  const [album, setAlbum] = useState<string | null>(null) // null = All
  const [albumDialog, setAlbumDialog] = useState<null | 'new' | 'rename'>(null)
  const [deletingAlbum, setDeletingAlbum] = useState(false)
  const [binCount, setBinCount] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () => listBin().then((b) => alive && setBinCount(b.docs.length + b.albums.length))
    load()
    const off = onDbChange(load)
    return () => {
      alive = false
      off()
    }
  }, [])

  const current = albums.find((a) => a.id === album)
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (docs ?? []).filter((d) => (!album || d.albumId === album) && (!s || d.name.toLowerCase().includes(s)))
    return sort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list
  }, [docs, q, sort, album])

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const selecting = selectMode || sel.length > 0
  const endSelect = () => {
    setSel([])
    setSelectMode(false)
  }
  const shownIds = shown.map((d) => d.id)
  const allShown = shownIds.length > 0 && shownIds.every((id) => sel.includes(id))
  const drag = useDragSelect(shownIds, sel, setSel)
  const count = (id: string | null) => (docs ?? []).filter((d) => !id || d.albumId === id).length

  return (
    <div className="tab-page">
      <div className="topbar">
        <h1 className="tab-title grow">{t('tab.docs')}</h1>
        {!!docs?.length && (
          <button className="link select-btn" onClick={() => (selecting ? endSelect() : setSelectMode(true))}>
            {selecting ? t('cancel') : t('select')}
          </button>
        )}
        <button className="bin-btn" onClick={() => push('bin')} aria-label={t('recycleBin')}>
          <Icon name="trash" size={20} />
          {binCount > 0 && <span className="bin-count">{binCount}</span>}
        </button>
      </div>
      <div className="album-row">
        <button className={`album-chip ${!album ? 'on' : ''}`} onClick={() => setAlbum(null)}>
          {t('allDocs')} <span>{count(null)}</span>
        </button>
        {albums.map((a) => (
          <button key={a.id} className={`album-chip ${album === a.id ? 'on' : ''}`} onClick={() => setAlbum(a.id)}>
            <Icon name="album" size={15} /> {a.name} <span>{count(a.id)}</span>
          </button>
        ))}
        <button className="album-chip add" onClick={() => setAlbumDialog('new')}>
          <Icon name="plus" size={15} /> {t('newAlbum')}
        </button>
      </div>
      {current && (
        <div className="album-manage">
          <Icon name="album" size={18} />
          <strong className="grow">{current.name}</strong>
          <button className="link" onClick={() => setAlbumDialog('rename')}>
            <Icon name="edit" size={15} /> {t('rename')}
          </button>
          <button className="link danger-text" onClick={() => setDeletingAlbum(true)}>
            <Icon name="trash" size={15} /> {t('delete')}
          </button>
        </div>
      )}
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
      {docs && docs.length > 0 && shown.length === 0 && <Empty icon="album" text={current && !q.trim() ? t('albumEmpty') : t('noMatchingDocs')} />}
      {docs && docs.length > 0 && <p className="pad muted small swipe-hint">{selecting ? t('dragSelectHint') : t('swipeHint')}</p>}
      <div className={`list ${selecting ? 'selecting' : ''}`} {...drag}>
        {shown.map((d) => (
          <DocRow
            key={d.id}
            doc={d}
            onClick={() => (selecting ? toggle(d.id) : push('doc', { id: d.id }))}
            selected={sel.includes(d.id)}
            onSelect={() => toggle(d.id)}
            swipe={selecting ? undefined : actions.swipe(d)}
            onLongPress={selecting ? undefined : () => actions.menu(d)}
            extra={!album && d.albumId ? <span className="doc-album">{actions.albumName(d.albumId)}</span> : undefined}
          />
        ))}
      </div>
      {selecting && <div className="sel-spacer" />}
      {selecting && (
        <div className="selection-bar batch">
          <div className="sel-head">
            <button className="icon-btn" onClick={endSelect} aria-label={t('close')}>
              <Icon name="close" />
            </button>
            <span className="grow">{t('nSelected', { n: sel.length })}</span>
            <button className="link" onClick={() => setSel(allShown ? sel.filter((id) => !shownIds.includes(id)) : [...new Set([...sel, ...shownIds])])}>
              {allShown ? t('deselectAll') : t('selectAllN', { n: shownIds.length })}
            </button>
          </div>
          <div className="sel-actions">
            <button disabled={!sel.length} onClick={() => actions.move(sel, endSelect)}>
              <Icon name="album" size={20} />
              <span>{t('moveToAlbum')}</span>
            </button>
            <button disabled={sel.length < 2} onClick={() => push('merge', { docIds: sel })}>
              <Icon name="merge" size={20} />
              <span>{t('tool.merge')}</span>
            </button>
            <button
              className="danger-text"
              disabled={!sel.length}
              onClick={async () => {
                await actions.trash(sel)
                endSelect()
              }}
            >
              <Icon name="trash" size={20} />
              <span>{t('delete')}</span>
            </button>
          </div>
        </div>
      )}
      {actions.sheets}
      <TextDialog
        open={albumDialog != null}
        title={albumDialog === 'rename' ? t('renameAlbum') : t('newAlbum')}
        initial={albumDialog === 'rename' ? current?.name ?? '' : ''}
        placeholder={t('albumPlaceholder')}
        onCancel={() => setAlbumDialog(null)}
        onOk={async (v) => {
          if (albumDialog === 'rename' && current) await renameAlbum(current.id, v)
          else setAlbum((await createAlbum(v)).id)
          setAlbumDialog(null)
        }}
      />
      <Sheet open={deletingAlbum && !!current} onClose={() => setDeletingAlbum(false)} title={t('deleteAlbumTitle', { name: current?.name ?? '' })}>
        <div className="option-list">
          <button
            className="option danger-text"
            onClick={async () => {
              await trashAlbum(current!.id, true)
              setDeletingAlbum(false)
              setAlbum(null)
            }}
          >
            <Icon name="trash" /> {t('deleteAlbumWithDocs', { n: count(current?.id ?? null) })}
          </button>
          <button
            className="option"
            onClick={async () => {
              await trashAlbum(current!.id, false)
              setDeletingAlbum(false)
              setAlbum(null)
            }}
          >
            <Icon name="album" /> {t('deleteAlbumKeepDocs')}
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          {t('binNote', { n: BIN_DAYS })}
        </p>
      </Sheet>
    </div>
  )
}

export function ToolsTab() {
  const { t } = useApp()
  const { run } = useTools()
  const isNew = useIsNew()
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
              <ToolTile key={id} icon={TOOLS[id].icon} color={TOOLS[id].color} label={t(TOOLS[id].label)} onClick={() => run(id)} isNew={isNew(id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * One line of display facts for troubleshooting layout reports (a screenshot of it says what the
 * phone reports): screen size, visible viewport, page size, and whether it runs as a Home Screen app.
 */
function DisplayInfo() {
  const [info, setInfo] = useState('')
  useEffect(() => {
    const read = () => {
      const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
      const root = document.getElementById('root')!.getBoundingClientRect()
      setInfo(`${screen.width}×${screen.height} · view ${innerWidth}×${innerHeight} · page ${Math.round(root.height)} · ${standalone ? 'app' : 'browser'} · dpr ${devicePixelRatio}`)
    }
    read()
    addEventListener('resize', read)
    return () => removeEventListener('resize', read)
  }, [])
  return <p className="muted small display-info">{info}</p>
}

export function SettingsTab() {
  const { t, settings, setSettings, lang, toast, push } = useApp()
  const [usage, setUsage] = useState<string>('')
  const [sheet, setSheet] = useState<null | 'lang' | 'theme' | 'storage' | 'whatsnew'>(null)
  const docs = useDocs()

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(formatBytes(e.usage ?? 0)))
  }, [docs])

  return (
    <div className="tab-page">
      <div className="topbar">
        <h1 className="tab-title">{t('tab.settings')}</h1>
      </div>
      <ShareAppCard />

      <h2 className="settings-label">{t('general')}</h2>
      <div className="settings">
        <button className="setting" onClick={() => setSheet('lang')}>
          <Icon name="globe" />
          <span>{t('language')}</span>
          <span className="setting-value">{LANGS.find((l) => l.code === lang)?.name}</span>
          <Icon name="chevron" size={18} />
        </button>
        <button className="setting" onClick={() => setSheet('theme')}>
          <Icon name="moon" />
          <span>{t('theme')}</span>
          <span className="setting-value row gap-sm">
            <ThemeSwatch look={activeLook(settings)} /> {settings.theme === 'auto' ? t('themeAuto') : t(settings.theme)} · {t(`look.${activeLook(settings)}`)}
          </span>
          <Icon name="chevron" size={18} />
        </button>
      </div>

      <h2 className="settings-label">{t('scanAndPdf')}</h2>
      <div className="settings">
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
      </div>

      <h2 className="settings-label">{t('storage')}</h2>
      <div className="settings">
        <button className="setting" onClick={() => setSheet('storage')}>
          <Icon name="storage" />
          <span>{t('storageUsed')}</span>
          <span className="setting-value">
            {t('nDocs', { n: docs?.length ?? 0 })} · {usage}
          </span>
          <Icon name="chevron" size={18} />
        </button>
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

      <h2 className="settings-label">{t('about')}</h2>
      <div className="settings">
        <button className="setting" onClick={() => setSheet('whatsnew')}>
          <Icon name="quality" />
          <span>{t('whatsNew')}</span>
          <span className="setting-value">v{APP_VERSION}</span>
          <Icon name="chevron" size={18} />
        </button>
        <button className="setting" onClick={() => push('history')}>
          <Icon name="clock" />
          <span>{t('updateHistory')}</span>
          <Icon name="chevron" size={18} />
        </button>
        <CheckUpdateRow />
      </div>

      <div className="free-box">
        <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} width={44} height={44} alt="" />
        <div className="free-title">{t('freeTitle')}</div>
        <ul className="free-list">
          <li>
            <Icon name="check" size={16} stroke={2.6} /> {t('free1')}
          </li>
          <li>
            <Icon name="check" size={16} stroke={2.6} /> {t('free2')}
          </li>
          <li>
            <Icon name="check" size={16} stroke={2.6} /> {t('free3')}
          </li>
        </ul>
        <p className="muted small">{t('privacyNote')}</p>
        <p className="muted small">AnyScan v{APP_VERSION}</p>
        <DisplayInfo />
      </div>

      <Sheet open={sheet === 'lang'} onClose={() => setSheet(null)} title={t('language')}>
        <div className="option-list">
          {LANGS.map((l) => (
            <button
              key={l.code}
              className={`option ${settings.lang === l.code ? 'on' : ''}`}
              onClick={() => {
                setSettings({ lang: l.code as Lang, langChosen: true })
                setSheet(null)
              }}
            >
              {l.name}
              {settings.lang === l.code && <Icon name="check" />}
            </button>
          ))}
        </div>
      </Sheet>
      <ThemeSheet open={sheet === 'theme'} onClose={() => setSheet(null)} />
      <StorageSheet open={sheet === 'storage'} onClose={() => setSheet(null)} />
      <WhatsNewSheet open={sheet === 'whatsnew'} onClose={() => setSheet(null)} />
    </div>
  )
}
