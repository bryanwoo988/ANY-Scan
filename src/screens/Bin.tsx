// Recycle Bin: deleted documents and albums, kept for 30 days before they are removed for good.
import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { DocRow, Empty, Screen, Sheet } from '../components/ui'
import { BIN_DAYS, daysLeft, deleteForever, emptyBin, listBin, onDbChange, restore, type AlbumRec, type BinContents, type DocRec } from '../lib/db'
import { useApp } from '../state'
import { useDragSelect } from '../components/dragSelect'

type Item = { kind: 'doc'; doc: DocRec } | { kind: 'album'; album: AlbumRec; docs: DocRec[] }

export function BinScreen() {
  const { t, toast } = useApp()
  const [bin, setBin] = useState<BinContents | null>(null)
  const [picked, setPicked] = useState<Item | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () => listBin().then((b) => alive && setBin(b))
    load()
    const off = onDbChange(load)
    return () => {
      alive = false
      off()
    }
  }, [])

  // Documents deleted together with their album are shown inside the album.
  const binAlbums = new Set(bin?.albums.map((a) => a.id))
  const items: Item[] = bin
    ? [
        ...bin.albums.map((album): Item => ({ kind: 'album', album, docs: bin.docs.filter((d) => d.albumId === album.id) })),
        ...bin.docs.filter((d) => !(d.albumId && binAlbums.has(d.albumId))).map((doc): Item => ({ kind: 'doc', doc })),
      ]
    : []
  const total = (bin?.docs.length ?? 0) + (bin?.albums.length ?? 0)
  const key = (it: Item) => (it.kind === 'doc' ? it.doc.id : it.album.id)
  const keys = items.map(key)
  const selecting = selectMode || sel.length > 0
  const endSelect = () => {
    setSel([])
    setSelectMode(false)
  }
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const allSelected = keys.length > 0 && keys.every((k) => sel.includes(k))
  const drag = useDragSelect(keys, sel, setSel)
  // Ids for restore/delete of several items; documents inside a selected album come along.
  const selectedIds = (): [string[], string[]] => {
    const chosen = items.filter((it) => sel.includes(key(it)))
    return [chosen.flatMap((it) => ids(it)[0]), chosen.flatMap((it) => ids(it)[1])]
  }

  const ids = (it: Item): [string[], string[]] => (it.kind === 'doc' ? [[it.doc.id], []] : [it.docs.map((d) => d.id), [it.album.id]])
  const doRestore = async (it: Item) => {
    await restore(...ids(it))
    toast(t('restored'))
  }
  const doDelete = async (it: Item) => {
    const [d, a] = ids(it)
    if (!window.confirm(t('deleteForeverConfirm', { n: d.length + a.length }))) return
    await deleteForever(d, a)
    toast(t('deleted'))
  }
  const left = (deletedAt?: number | null) => <span className="bin-left">{t('daysLeft', { n: daysLeft(deletedAt ?? Date.now()) })}</span>

  return (
    <Screen
      title={t('recycleBin')}
      right={
        total > 0 ? (
          <button className="link select-btn" onClick={() => (selecting ? endSelect() : setSelectMode(true))}>
            {selecting ? t('cancel') : t('select')}
          </button>
        ) : undefined
      }
      footer={
        selecting ? (
          <div className="selection-bar batch in-screen">
            <div className="sel-head">
              <span className="grow">{t('nSelected', { n: sel.length })}</span>
              <button className="link" onClick={() => setSel(allSelected ? [] : keys)}>
                {allSelected ? t('deselectAll') : t('selectAllN', { n: keys.length })}
              </button>
            </div>
            <div className="sel-actions">
              <button
                disabled={!sel.length}
                onClick={async () => {
                  await restore(...selectedIds())
                  toast(t('restored'))
                  endSelect()
                }}
              >
                <Icon name="undo" size={20} />
                <span>{t('restore')}</span>
              </button>
              <button
                className="danger-text"
                disabled={!sel.length}
                onClick={async () => {
                  const [d, a] = selectedIds()
                  if (!window.confirm(t('deleteForeverConfirm', { n: d.length + a.length }))) return
                  await deleteForever(d, a)
                  toast(t('deleted'))
                  endSelect()
                }}
              >
                <Icon name="trash" size={20} />
                <span>{t('deleteForever')}</span>
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="pad bin-note">
        <span className="muted small grow">
          <Icon name="clock" size={15} /> {t('binNote', { n: BIN_DAYS })}
        </span>
        {total > 0 && !selecting && (
          <button
            className="link danger-text small"
            onClick={async () => {
              if (!window.confirm(t('deleteForeverConfirm', { n: total }))) return
              await emptyBin()
              toast(t('deleted'))
            }}
          >
            {t('emptyBin')}
          </button>
        )}
      </div>
      {bin && items.length === 0 && <Empty icon="trash" text={t('binEmpty')} />}
      {selecting && <p className="pad muted small swipe-hint">{t('dragSelectHint')}</p>}
      <div className={`list ${selecting ? 'selecting' : ''}`} {...drag}>
        {items.map((it) =>
          it.kind === 'doc' ? (
            <DocRow
              key={it.doc.id}
              doc={it.doc}
              onClick={() => (selecting ? toggle(it.doc.id) : setPicked(it))}
              onLongPress={selecting ? undefined : () => setSel([it.doc.id])}
              selected={sel.includes(it.doc.id)}
              onSelect={selecting ? () => toggle(it.doc.id) : undefined}
              swipe={
                selecting
                  ? undefined
                  : [
                      { label: t('restore'), icon: 'undo', tone: 'accent', run: () => doRestore(it) },
                      { label: t('delete'), icon: 'trash', tone: 'danger', run: () => doDelete(it) },
                    ]
              }
              extra={left(it.doc.deletedAt)}
            />
          ) : (
            <div key={it.album.id} className={`doc-row-wrap ${sel.includes(it.album.id) ? 'selected' : ''}`} data-sel-id={it.album.id}>
              <div className="doc-row">
                <button className="doc-row-main album-bin-row" onClick={() => (selecting ? toggle(it.album.id) : setPicked(it))}>
                  <span className="album-thumb">
                    <Icon name="album" size={30} />
                  </span>
                  <span className="doc-meta">
                    <span className="doc-name">{it.album.name}</span>
                    <span className="doc-sub">{t('albumWithFiles', { n: it.docs.length })}</span>
                    {left(it.album.deletedAt)}
                  </span>
                </button>
                {selecting && (
                  <button className={`check ${sel.includes(it.album.id) ? 'on' : ''}`} onClick={() => toggle(it.album.id)} aria-pressed={sel.includes(it.album.id)} aria-label="select">
                    {sel.includes(it.album.id) && <Icon name="check" size={16} stroke={2.6} />}
                  </button>
                )}
              </div>
            </div>
          ),
        )}
      </div>
      <Sheet open={!!picked} onClose={() => setPicked(null)} title={picked ? (picked.kind === 'doc' ? picked.doc.name : picked.album.name) : ''}>
        {picked && (
          <div className="option-list">
            <button
              className="option"
              onClick={() => {
                setPicked(null)
                doRestore(picked)
              }}
            >
              <Icon name="undo" /> {t('restore')}
            </button>
            <button
              className="option danger-text"
              onClick={() => {
                setPicked(null)
                doDelete(picked)
              }}
            >
              <Icon name="trash" /> {t('deleteForever')}
            </button>
          </div>
        )}
      </Sheet>
    </Screen>
  )
}
