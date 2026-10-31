// Recycle Bin: deleted documents and albums, kept for 30 days before they are removed for good.
import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { DocRow, Empty, Screen, Sheet } from '../components/ui'
import { BIN_DAYS, daysLeft, deleteForever, emptyBin, listBin, onDbChange, restore, type AlbumRec, type BinContents, type DocRec } from '../lib/db'
import { useApp } from '../state'

type Item = { kind: 'doc'; doc: DocRec } | { kind: 'album'; album: AlbumRec; docs: DocRec[] }

export function BinScreen() {
  const { t, toast } = useApp()
  const [bin, setBin] = useState<BinContents | null>(null)
  const [picked, setPicked] = useState<Item | null>(null)
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
          <button
            className="link danger-text"
            onClick={async () => {
              if (!window.confirm(t('deleteForeverConfirm', { n: total }))) return
              await emptyBin()
              toast(t('deleted'))
            }}
          >
            {t('emptyBin')}
          </button>
        ) : undefined
      }
    >
      <p className="pad muted small bin-note">
        <Icon name="clock" size={15} /> {t('binNote', { n: BIN_DAYS })}
      </p>
      {bin && items.length === 0 && <Empty icon="trash" text={t('binEmpty')} />}
      <div className="list">
        {items.map((it) =>
          it.kind === 'doc' ? (
            <DocRow
              key={it.doc.id}
              doc={it.doc}
              onClick={() => setPicked(it)}
              onLongPress={() => setPicked(it)}
              swipe={[
                { label: t('restore'), icon: 'undo', tone: 'accent', run: () => doRestore(it) },
                { label: t('delete'), icon: 'trash', tone: 'danger', run: () => doDelete(it) },
              ]}
              extra={left(it.doc.deletedAt)}
            />
          ) : (
            <div key={it.album.id} className="doc-row-wrap">
              <button className="doc-row-main album-bin-row" onClick={() => setPicked(it)}>
                <span className="album-thumb">
                  <Icon name="album" size={30} />
                </span>
                <span className="doc-meta">
                  <span className="doc-name">{it.album.name}</span>
                  <span className="doc-sub">{t('albumWithFiles', { n: it.docs.length })}</span>
                  {left(it.album.deletedAt)}
                </span>
              </button>
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
