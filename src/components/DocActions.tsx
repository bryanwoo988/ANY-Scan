// Actions on documents shared by Home (Recents), the Documents tab and the document screen:
// a long-press menu, swipe actions, rename, move to album, and delete to the Recycle Bin with Undo.
import { useRef, useState } from 'react'
import { Icon } from './Icon'
import { Sheet, TextDialog, type SwipeAction } from './ui'
import { createAlbum, docFromPages, getPages, moveDocsToAlbum, renameDoc, restore, trashDocs, type DocRec } from '../lib/db'
import { useAlbums, useApp } from '../state'

export function useDocActions() {
  const { t, push, toast } = useApp()
  const albums = useAlbums()
  const [menuDoc, setMenuDoc] = useState<DocRec | null>(null)
  const [renaming, setRenaming] = useState<DocRec | null>(null)
  const [moving, setMoving] = useState<string[] | null>(null)
  const [newAlbum, setNewAlbum] = useState(false)
  const afterMove = useRef<(() => void) | undefined>(undefined)

  const moved = (name: string) => {
    setMoving(null)
    toast(t('movedTo', { name }))
    afterMove.current?.()
    afterMove.current = undefined
  }

  /** Moves documents to the Recycle Bin, with an Undo button. */
  const trash = async (ids: string[]) => {
    await trashDocs(ids)
    toast(t('movedToBin', { n: ids.length }), { label: t('undo'), run: () => restore(ids, []) })
  }

  const swipe = (d: DocRec): SwipeAction[] => [
    { label: t('rename'), icon: 'edit', run: () => setRenaming(d) },
    { label: t('album'), icon: 'album', tone: 'accent', run: () => setMoving([d.id]) },
    { label: t('delete'), icon: 'trash', tone: 'danger', run: () => trash([d.id]) },
  ]

  const albumName = (id?: string | null) => albums.find((a) => a.id === id)?.name

  const sheets = (
    <>
      <Sheet open={!!menuDoc} onClose={() => setMenuDoc(null)} title={menuDoc?.name}>
        {menuDoc && (
          <div className="option-list">
            {(
              [
                ['docs', t('open'), () => push('doc', { id: menuDoc.id })],
                ['edit', t('rename'), () => setRenaming(menuDoc)],
                ['album', menuDoc.albumId ? `${t('moveToAlbum')} · ${albumName(menuDoc.albumId) ?? ''}` : t('moveToAlbum'), () => setMoving([menuDoc.id])],
                ['share', t('share'), () => push('export', { docId: menuDoc.id })],
                [
                  'copy',
                  t('duplicate'),
                  async () => {
                    const d = await docFromPages(`${menuDoc.name} (${t('copy')})`, await getPages(menuDoc))
                    await moveDocsToAlbum([d.id], menuDoc.albumId ?? null)
                    toast(t('saved'))
                  },
                ],
              ] as const
            ).map(([icon, label, run]) => (
              <button
                key={label}
                className="option"
                onClick={() => {
                  setMenuDoc(null)
                  run()
                }}
              >
                <Icon name={icon} /> {label}
              </button>
            ))}
            <button
              className="option danger-text"
              onClick={() => {
                const id = menuDoc.id
                setMenuDoc(null)
                trash([id])
              }}
            >
              <Icon name="trash" /> {t('delete')}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={!!moving}
        onClose={() => {
          setMoving(null)
          afterMove.current = undefined
        }}
        title={t('moveToAlbum')}
      >
        <div className="option-list">
          <button
            className="option"
            onClick={async () => {
              await moveDocsToAlbum(moving!, null)
              moved(t('allDocs'))
            }}
          >
            <Icon name="docs" /> {t('noAlbum')}
          </button>
          {albums.map((a) => (
            <button
              key={a.id}
              className="option"
              onClick={async () => {
                await moveDocsToAlbum(moving!, a.id)
                moved(a.name)
              }}
            >
              <Icon name="album" /> {a.name}
            </button>
          ))}
          <button className="option" onClick={() => setNewAlbum(true)}>
            <Icon name="plus" /> {t('newAlbum')}
          </button>
        </div>
      </Sheet>

      <TextDialog
        open={!!renaming}
        title={t('rename')}
        initial={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onOk={async (v) => {
          if (renaming) await renameDoc(renaming.id, v)
          setRenaming(null)
        }}
      />
      <TextDialog
        open={newAlbum}
        title={t('newAlbum')}
        initial=""
        placeholder={t('albumPlaceholder')}
        onCancel={() => setNewAlbum(false)}
        onOk={async (v) => {
          const a = await createAlbum(v)
          setNewAlbum(false)
          if (moving) {
            await moveDocsToAlbum(moving, a.id)
            moved(a.name)
          }
        }}
      />
    </>
  )

  return {
    swipe,
    menu: (d: DocRec) => setMenuDoc(d),
    move: (ids: string[], done?: () => void) => {
      afterMove.current = done
      setMoving(ids)
    },
    trash,
    sheets,
    albumName,
  }
}
