import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Sheet } from './ui'
import { canvasToBlob, ctx2d, loadImage } from '../lib/image'
import { renderQr } from '../lib/qr'
import { copyText, shareOrDownload } from '../lib/share'
import { useApp } from '../state'

/** Public address of this install of the app, e.g. https://user.github.io/ANY-Scan/ */
export function appUrl(): string {
  return new URL(import.meta.env.BASE_URL, location.href).href
}

/** QR code for the app link with the AnyScan logo in the middle (high error correction keeps it scannable). */
async function drawAppQr(c: HTMLCanvasElement, url: string, size: number) {
  await renderQr(c, url, { fg: '#0e1116', bg: '#ffffff', ecc: 'H' }, size)
  const logo = await loadImage(`${import.meta.env.BASE_URL}icons/logo.svg`)
  const ctx = ctx2d(c)
  const s = c.width * 0.22
  const pad = s * 0.12
  const x = (c.width - s) / 2
  const y = (c.height - s) / 2
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(x - pad, y - pad, s + pad * 2, s + pad * 2, s * 0.28)
  ctx.fill()
  ctx.drawImage(logo, x, y, s, s)
}

function AppQr({ size, className }: { size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) drawAppQr(ref.current, appUrl(), size).catch(() => {})
  }, [size])
  return <canvas ref={ref} className={className} />
}

export function ShareAppCard() {
  const { t, toast } = useApp()
  const [open, setOpen] = useState(false)
  const url = appUrl()
  const message = `${t('shareAppText')} ${url}`

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'AnyScan', text: t('shareAppText'), url })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    await copyText(message)
    toast(t('linkCopied'))
  }

  const saveQr = async () => {
    const c = document.createElement('canvas')
    await drawAppQr(c, url, 900)
    await shareOrDownload([{ blob: await canvasToBlob(c, 'image/png'), name: 'AnyScan-QR.png' }], 'AnyScan').catch(() => toast(t('tapShareAgain')))
  }

  return (
    <>
      <button className="share-card" onClick={() => setOpen(true)}>
        <div className="share-card-text">
          <div className="row gap-sm">
            <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} width={36} height={36} alt="" className="share-logo" />
            <span className="share-title">{t('shareApp')}</span>
          </div>
          <span className="muted small">{t('shareAppSub')}</span>
          <span className="share-cta">
            <Icon name="qr" size={16} /> {t('showQr')}
          </span>
        </div>
        <AppQr size={240} className="share-card-qr" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('shareApp')}>
        <div className="share-sheet">
          <div className="share-qr-frame">
            <AppQr size={720} />
            <span className="share-qr-caption">{t('scanToGet')}</span>
          </div>
          <button className="share-url" onClick={() => copyText(url).then(() => toast(t('linkCopied')))}>
            <Icon name="link" size={18} />
            <span>{url}</span>
            <Icon name="copy" size={18} />
          </button>
          <div className="share-actions">
            <button onClick={shareLink}>
              <span className="share-action-icon">
                <Icon name="share" />
              </span>
              {t('shareLink')}
            </button>
            <button onClick={() => copyText(message).then(() => toast(t('linkCopied')))}>
              <span className="share-action-icon">
                <Icon name="copy" />
              </span>
              {t('copyLink')}
            </button>
            <button onClick={saveQr}>
              <span className="share-action-icon">
                <Icon name="download" />
              </span>
              {t('saveQr')}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  )
}
