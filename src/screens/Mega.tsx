// Mega Scan: several overlapping photos of something large (poster, map, blueprint) joined into
// one picture, which then goes through the normal scan editor for cropping and filters.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Screen } from '../components/ui'
import { defaultDocName } from '../lib/db'
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d, imageToCanvas, loadImage } from '../lib/image'
import { composite, features, grayFromRGBA, inv, mul, planMosaic, scale, translate, type Mosaic } from '../lib/mega'
import { shareOrDownload } from '../lib/share'
import { useApp } from '../state'

/** Photos are matched at this size: plenty of detail for matching, quick on a phone. */
const ANALYSIS = 900
/** Each photo is drawn from at most this size… */
const SOURCE = 2400
/** …into a result of at most this many pixels on its longer side (memory on phones). */
const OUT = 4000
/** Longest side of the finished page, so the scan editor keeps the detail. */
export const MEGA_PAGE = OUT

interface Photo {
  file: File
  url: string
}

export interface MegaResult {
  canvas: HTMLCanvasElement
  used: number
  left: number
}

/** Matches the photos and draws them into one canvas. Returns null if fewer than two fit together. */
export async function joinPhotos(files: File[], onProgress: (f: number) => void): Promise<MegaResult | null> {
  const feats = []
  const sizes: { w: number; h: number }[] = []
  const full: number[] = [] // longest side each photo will be drawn from
  for (const [i, f] of files.entries()) {
    const im = await loadImage(f)
    full.push(Math.min(SOURCE, Math.max(im.naturalWidth, im.naturalHeight)))
    const c = imageToCanvas(im, ANALYSIS)
    const img = ctx2d(c).getImageData(0, 0, c.width, c.height)
    feats.push(features(grayFromRGBA(img.data, c.width, c.height)))
    sizes.push({ w: c.width, h: c.height })
    onProgress((0.25 * (i + 1)) / files.length)
    await new Promise((r) => setTimeout(r, 0))
  }
  const m: Mosaic = planMosaic(feats, sizes, (f) => onProgress(0.25 + f * 0.35))
  const used = m.H.filter(Boolean).length
  if (used < 2) return null
  const bw = m.box.x1 - m.box.x0
  const bh = m.box.y1 - m.box.y0
  // Output pixels per reference-photo analysis pixel: no more detail than the photos have.
  const S = Math.min(full[m.ref] / Math.max(sizes[m.ref].w, sizes[m.ref].h), OUT / Math.max(bw, bh))
  const ow = Math.round(bw * S)
  const oh = Math.round(bh * S)
  const out = createCanvas(ow, oh)
  const octx = ctx2d(out)
  const outImg = octx.createImageData(ow, oh)
  const best = new Float32Array(ow * oh)
  let k = 0
  for (const [i, f] of files.entries()) {
    const H = m.H[i]
    if (!H) continue
    const c = await blobToCanvas(f, SOURCE)
    const fs = c.width / sizes[i].w
    // output pixel → reference analysis coords → this photo's analysis coords → its full-size pixels
    const toSrc = mul(scale(fs), mul(inv(H), mul(translate(m.box.x0, m.box.y0), scale(1 / S))))
    const src = ctx2d(c).getImageData(0, 0, c.width, c.height)
    composite(outImg.data, best, ow, oh, src.data, c.width, c.height, toSrc, m.gain[i])
    c.width = c.height = 1 // free the memory now
    onProgress(0.6 + (0.4 * ++k) / used)
    await new Promise((r) => setTimeout(r, 0))
  }
  // Areas no photo covered (the ragged edge) become white.
  const d = outImg.data
  for (let p = 0; p < ow * oh; p++)
    if (!d[p * 4 + 3]) {
      d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255
      d[p * 4 + 3] = 255
    }
  octx.putImageData(outImg, 0, 0)
  return { canvas: out, used, left: files.length - used }
}

export function MegaScreen({ files: initial }: { files?: File[] }) {
  const { t, pickFiles, replace, toast } = useApp()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [working, setWorking] = useState<number | null>(null)
  const [result, setResult] = useState<{ url: string; blob: Blob; w: number; h: number; used: number; left: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const name = useRef(defaultDocName(t('tool.mega')))
  const run = useRef(0)

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos])
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result])

  const join = async (list: Photo[]) => {
    const id = ++run.current
    setResult(null)
    setFailed(false)
    if (list.length < 2) return
    setWorking(0)
    try {
      const r = await joinPhotos(
        list.map((p) => p.file),
        (f) => id === run.current && setWorking(f),
      )
      if (id !== run.current) return
      if (!r) return setFailed(true)
      const blob = await canvasToBlob(r.canvas, 'image/jpeg', 0.92)
      setResult({ url: URL.createObjectURL(blob), blob, w: r.canvas.width, h: r.canvas.height, used: r.used, left: r.left })
      r.canvas.width = r.canvas.height = 1
    } catch (e) {
      console.error(e)
      if (id === run.current) setFailed(true)
    } finally {
      if (id === run.current) setWorking(null)
    }
  }

  const setAndJoin = (files: File[]) => {
    const list = files.map((file) => ({ file, url: URL.createObjectURL(file) }))
    setPhotos(list)
    join(list)
  }

  const started = useRef(false)
  useEffect(() => {
    if (started.current || !initial?.length) return
    started.current = true
    setAndJoin(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async (camera: boolean) => {
    const f = await pickFiles({ accept: 'image/*', multiple: !camera, capture: camera })
    if (f.length) setAndJoin([...photos.map((p) => p.file), ...f])
  }
  const remove = (i: number) => setAndJoin(photos.filter((_, k) => k !== i).map((p) => p.file))

  const next = () => {
    if (!result) return
    const file = new File([result.blob], `${name.current}.jpg`, { type: 'image/jpeg' })
    replace('scan', { files: [file], kind: 'mega', filter: 'original', maxSide: MEGA_PAGE })
  }

  return (
    <Screen
      title={t('tool.mega')}
      footer={
        result ? (
          <div className="row gap">
            <button className="btn soft grow" onClick={() => shareOrDownload([{ blob: result.blob, name: `${name.current}.jpg` }]).catch(() => toast(t('saveFailed')))}>
              <Icon name="share" /> {t('saveImage')}
            </button>
            <button className="btn primary grow" onClick={next}>
              <Icon name="crop" /> {t('megaNext')}
            </button>
          </div>
        ) : (
          <div className="row gap">
            <button className="btn soft grow" onClick={() => (photos.length ? add(false) : pickFiles({ accept: 'image/*', multiple: true }).then((f) => f.length && setAndJoin(f)))}>
              <Icon name="image" /> {t('megaChoose')}
            </button>
            <button className="btn primary grow" onClick={() => (photos.length ? add(true) : replace('camera', { mode: 'mega' }))}>
              <Icon name="camera" /> {t('megaTake')}
            </button>
          </div>
        )
      }
    >
      <div className="pad stack">
        {photos.length < 2 && (
          <div className="stitch-intro">
            <div className="mega-art" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
            <h2>{t('megaTitle')}</h2>
            <ol>
              <li>{t('megaStep1')}</li>
              <li>{t('megaStep2')}</li>
              <li>{t('megaStep3')}</li>
            </ol>
          </div>
        )}

        {photos.length > 0 && (
          <div className="stitch-strip">
            {photos.map((p, i) => (
              <div key={p.url} className="stitch-thumb">
                <img src={p.url} alt="" />
                <span className="stitch-n">{i + 1}</span>
                <div className="stitch-thumb-btns">
                  <button onClick={() => remove(i)} aria-label={t('delete')} disabled={working != null}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button className="stitch-add" onClick={() => add(false)} aria-label={t('megaAdd')} disabled={working != null}>
              <Icon name="plus" size={26} />
            </button>
          </div>
        )}

        {photos.length === 1 && <p className="muted small">{t('megaNeedTwo')}</p>}

        {working != null && (
          <div className="stack-sm">
            <div className="progress">
              <div style={{ width: `${Math.round(working * 100)}%` }} />
            </div>
            <p className="muted small">{t('megaJoining')}</p>
          </div>
        )}

        {failed && <p className="danger-text">{t('megaFailed')}</p>}

        {result && (
          <>
            <p className="muted small">{t('megaInfo', { n: result.used, w: result.w, h: result.h })}</p>
            {result.left > 0 && <p className="danger-text small">{t('megaLeftOut', { n: result.left })}</p>}
            <div className="mega-result">
              <img src={result.url} alt="" />
            </div>
          </>
        )}
      </div>
    </Screen>
  )
}
