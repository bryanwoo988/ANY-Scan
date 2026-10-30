import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { Empty, formatDate, Screen, Segmented, Sheet } from '../components/ui'
import { createDoc, defaultDocName, uid } from '../lib/db'
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../lib/image'
import {
  buildContact, buildWifi, decodeCanvas, normalizeUrl, parseQr, QR_HISTORY_KEY, renderQr,
  type ContactData, type Parsed, type QrHistoryItem, type QrKind, type QrStyle, type WifiData,
} from '../lib/qr'
import { loadJSON, saveJSON } from '../lib/settings'
import { copyText, shareOrDownload } from '../lib/share'
import { useApp } from '../state'

function addHistory(text: string, source: 'scan' | 'create') {
  const h = loadJSON<QrHistoryItem[]>(QR_HISTORY_KEY, []).filter((x) => !(x.text === text && x.source === source))
  saveJSON(QR_HISTORY_KEY, [{ id: uid(), text, at: Date.now(), source }, ...h].slice(0, 100))
}

const KIND_ICON: Record<Parsed['kind'], IconName> = { url: 'link', wifi: 'wifi', contact: 'contact', phone: 'phone', email: 'mail', sms: 'sms', text: 'text' }

export function QrResult({ text, onClose }: { text: string; onClose: () => void }) {
  const { t, toast, push } = useApp()
  const p = parseQr(text)
  const copy = (s: string) => copyText(s).then(() => toast(t('copied')))

  const rows: [string, string][] = []
  let primary: { label: string; icon: IconName; run: () => void } | null = null
  switch (p.kind) {
    case 'url':
      rows.push([t('qr.url'), p.url])
      primary = { label: t('openLink'), icon: 'link', run: () => window.open(p.url, '_blank', 'noopener,noreferrer') }
      break
    case 'wifi':
      rows.push([t('qr.ssid'), p.wifi.ssid], [t('qr.password'), p.wifi.password || '—'], [t('qr.security'), p.wifi.security === 'nopass' ? t('qr.open') : p.wifi.security])
      if (p.wifi.password) primary = { label: t('copyPassword'), icon: 'copy', run: () => copy(p.wifi.password) }
      break
    case 'contact':
      rows.push([t('qr.name'), p.name], [t('qr.phone'), p.phone], [t('qr.email'), p.email], [t('qr.org'), p.org])
      primary = {
        label: t('saveContact'),
        icon: 'contact',
        run: () => shareOrDownload([{ blob: new Blob([/^BEGIN:VCARD/i.test(text) ? text : buildContact({ name: p.name, phone: p.phone, email: p.email, org: p.org, url: '' })], { type: 'text/vcard' }), name: `${p.name || 'contact'}.vcf` }]),
      }
      break
    case 'phone':
      rows.push([t('qr.phone'), p.phone])
      primary = { label: t('call'), icon: 'phone', run: () => (location.href = `tel:${p.phone}`) }
      break
    case 'email':
      rows.push([t('qr.email'), p.email])
      primary = { label: t('sendEmail'), icon: 'mail', run: () => (location.href = `mailto:${p.email}`) }
      break
    case 'sms':
      rows.push([t('qr.phone'), p.phone], [t('qr.message'), p.body])
      primary = { label: t('sendSms'), icon: 'sms', run: () => (location.href = `sms:${p.phone}${p.body ? `&body=${encodeURIComponent(p.body)}` : ''}`) }
      break
    case 'text':
      rows.push([t('qr.text'), p.text])
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="row gap-sm">
          <Icon name={KIND_ICON[p.kind]} /> {t(`qr.kind.${p.kind}`)}
        </span>
      }
    >
      <div className="qr-result">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="kv">
              <span className="muted small">{k}</span>
              <span className="kv-v">{v}</span>
            </div>
          ))}
        {p.kind === 'url' && !/^https:/i.test(p.url) && <p className="warn small">{t('insecureLink')}</p>}
        <div className="row gap">
          {primary && (
            <button className="btn primary grow" onClick={primary.run}>
              <Icon name={primary.icon} /> {primary.label}
            </button>
          )}
          <button className="btn soft grow" onClick={() => copy(text)}>
            <Icon name="copy" /> {t('copy')}
          </button>
          <button className="btn soft" onClick={() => push('qrcreate', { text })} aria-label={t('tool.qrCreate')}>
            <Icon name="qr" />
          </button>
        </div>
      </div>
    </Sheet>
  )
}

export function QrHubScreen() {
  const { t, push, lang } = useApp()
  const [hist, setHist] = useState(() => loadJSON<QrHistoryItem[]>(QR_HISTORY_KEY, []))
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    const f = () => setHist(loadJSON<QrHistoryItem[]>(QR_HISTORY_KEY, []))
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [])
  return (
    <Screen
      title={t('tool.qr')}
      right={
        hist.length > 0 && (
          <button
            className="btn ghost sm"
            onClick={() => {
              if (!window.confirm(t('confirmClearHistory'))) return
              saveJSON(QR_HISTORY_KEY, [])
              setHist([])
            }}
          >
            {t('clear')}
          </button>
        )
      }
    >
      <div className="pad row gap">
        <button className="big-btn" onClick={() => push('qrscan')}>
          <Icon name="qrscan" size={36} />
          <span>{t('tool.qrScan')}</span>
        </button>
        <button className="big-btn" onClick={() => push('qrcreate', {})}>
          <Icon name="qr" size={36} />
          <span>{t('tool.qrCreate')}</span>
        </button>
      </div>
      <h2 className="pad section-h">{t('history')}</h2>
      {hist.length === 0 && <Empty icon="qr" text={t('noHistory')} />}
      <div className="list">
        {hist.map((h) => {
          const p = parseQr(h.text)
          return (
            <button key={h.id} className="hist-row" onClick={() => setOpen(h.text)}>
              <Icon name={KIND_ICON[p.kind]} />
              <span className="hist-main">
                <span className="hist-text">{h.text.replace(/\s+/g, ' ')}</span>
                <span className="muted small">
                  {h.source === 'scan' ? t('scanned') : t('created')} · {formatDate(h.at, lang)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {open && <QrResult text={open} onClose={() => setOpen(null)} />}
    </Screen>
  )
}

export function QrScanScreen() {
  const { t, pickFiles, toast } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [result, setResult] = useState<string | null>(null)
  const [camError, setCamError] = useState(false)
  const paused = useRef(false)
  paused.current = !!result

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let alive = true
    const canvas = createCanvas(1, 1)
    let lastScan = 0
    const tick = async (ts: number) => {
      if (!alive) return
      const v = videoRef.current
      if (v && v.readyState >= 2 && !paused.current && ts - lastScan > 150) {
        lastScan = ts
        const s = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight))
        canvas.width = v.videoWidth * s
        canvas.height = v.videoHeight * s
        ctx2d(canvas).drawImage(v, 0, 0, canvas.width, canvas.height)
        const r = await decodeCanvas(canvas)
        if (r && alive && !paused.current) {
          navigator.vibrate?.(60)
          addHistory(r, 'scan')
          setResult(r)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((tr) => tr.stop())
        stream = s
        const v = videoRef.current!
        v.srcObject = s
        v.play().catch(() => {})
        raf = requestAnimationFrame(tick)
      })
      .catch(() => setCamError(true)) ?? setCamError(true)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [])

  const fromAlbum = () =>
    pickFiles({ accept: 'image/*' }).then(async (f) => {
      if (!f.length) return
      const c = await blobToCanvas(f[0], 1600)
      const r = await decodeCanvas(c)
      if (r) {
        addHistory(r, 'scan')
        setResult(r)
      } else toast(t('noQrFound'))
    })

  return (
    <Screen
      title={t('tool.qrScan')}
      className="dark-screen"
      footer={
        <button className="btn soft block" onClick={fromAlbum}>
          <Icon name="image" /> {t('scanFromAlbum')}
        </button>
      }
    >
      <div className="qr-cam">
        <video ref={videoRef} playsInline muted />
        <div className="qr-frame">
          <span />
        </div>
        {camError ? <p className="qr-hint">{t('cameraDenied')}</p> : <p className="qr-hint">{t('qrAim')}</p>}
      </div>
      {result && <QrResult text={result} onClose={() => setResult(null)} />}
    </Screen>
  )
}

const KINDS: { kind: QrKind; icon: IconName }[] = [
  { kind: 'url', icon: 'link' },
  { kind: 'text', icon: 'text' },
  { kind: 'wifi', icon: 'wifi' },
  { kind: 'contact', icon: 'contact' },
  { kind: 'phone', icon: 'phone' },
  { kind: 'email', icon: 'mail' },
  { kind: 'sms', icon: 'sms' },
]

export function QrCreateScreen({ text: initial }: { text?: string }) {
  const { t, toast, replace } = useApp()
  const [kind, setKind] = useState<QrKind>(initial ? 'text' : 'url')
  const [text, setText] = useState(initial ?? '')
  const [url, setUrl] = useState('')
  const [wifi, setWifi] = useState<WifiData>({ ssid: '', password: '', security: 'WPA', hidden: false })
  const [contact, setContact] = useState<ContactData>({ name: '', phone: '', email: '', org: '', url: '' })
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState({ to: '', subject: '', body: '' })
  const [sms, setSms] = useState({ to: '', body: '' })
  const [style, setStyle] = useState<QrStyle>({ fg: '#000000', bg: '#ffffff', ecc: 'M' })
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const content = (() => {
    switch (kind) {
      case 'text':
        return text
      case 'url':
        return url.trim() ? normalizeUrl(url) : ''
      case 'wifi':
        return wifi.ssid ? buildWifi(wifi) : ''
      case 'contact':
        return contact.name || contact.phone ? buildContact(contact) : ''
      case 'phone':
        return phone.trim() ? `tel:${phone.replace(/\s+/g, '')}` : ''
      case 'email': {
        if (!email.to.trim()) return ''
        const q = new URLSearchParams()
        if (email.subject) q.set('subject', email.subject)
        if (email.body) q.set('body', email.body)
        const qs = q.toString().replace(/\+/g, '%20')
        return `mailto:${email.to.trim()}${qs ? `?${qs}` : ''}`
      }
      case 'sms':
        return sms.to.trim() ? `SMSTO:${sms.to.replace(/\s+/g, '')}:${sms.body}` : ''
    }
  })()

  const [tooLong, setTooLong] = useState(false)
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    if (!content) {
      c.width = c.height = 0
      return
    }
    renderQr(c, content, style)
      .then(() => setTooLong(false))
      .catch(() => setTooLong(true))
  }, [content, style])

  const pngBlob = () => canvasToBlob(canvasRef.current!, 'image/png')

  const field = (label: string, value: string, set: (v: string) => void, type = 'text', multiline = false) => (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea className="input textarea sm" value={value} onChange={(e) => set(e.target.value)} />
      ) : (
        <input className="input" type={type} value={value} onChange={(e) => set(e.target.value)} autoCapitalize="off" />
      )}
    </label>
  )

  return (
    <Screen
      title={t('tool.qrCreate')}
      footer={
        <div className="toolbar">
          <button
            disabled={!content || tooLong}
            onClick={async () => {
              addHistory(content, 'create')
              await shareOrDownload([{ blob: await pngBlob(), name: 'AnyScan-QR.png' }])
            }}
          >
            <Icon name="share" />
            <span>{t('share')}</span>
          </button>
          <button disabled={!content} onClick={() => copyText(content).then(() => toast(t('copied')))}>
            <Icon name="copy" />
            <span>{t('copy')}</span>
          </button>
          <button
            className="accent"
            disabled={!content || tooLong}
            onClick={async () => {
              addHistory(content, 'create')
              // Put the code on a white A4-ish page so it can be printed or shared as PDF.
              const qr = canvasRef.current!
              const page = createCanvas(1240, 1754)
              const ctx = ctx2d(page)
              ctx.fillStyle = '#fff'
              ctx.fillRect(0, 0, page.width, page.height)
              ctx.imageSmoothingEnabled = false
              ctx.drawImage(qr, 220, 300, 800, 800)
              const d = await createDoc(defaultDocName('QR'), [{ blob: await canvasToBlob(page, 'image/jpeg', 0.95), w: page.width, h: page.height }])
              toast(t('saved'))
              replace('doc', { id: d.id })
            }}
          >
            <Icon name="docs" />
            <span>{t('saveAsDoc')}</span>
          </button>
        </div>
      }
    >
      <div className="pad stack">
        <div className="chip-row nowrap">
          {KINDS.map((k) => (
            <button key={k.kind} className={`chip ${kind === k.kind ? 'on' : ''}`} onClick={() => setKind(k.kind)}>
              <Icon name={k.icon} size={16} /> {t(`qr.kind.${k.kind}`)}
            </button>
          ))}
        </div>

        {kind === 'text' && field(t('qr.text'), text, setText, 'text', true)}
        {kind === 'url' && field(t('qr.url'), url, setUrl, 'url')}
        {kind === 'wifi' && (
          <>
            {field(t('qr.ssid'), wifi.ssid, (v) => setWifi({ ...wifi, ssid: v }))}
            <Segmented
              value={wifi.security}
              onChange={(v) => setWifi({ ...wifi, security: v })}
              options={[
                { value: 'WPA', label: 'WPA/WPA2/WPA3' },
                { value: 'WEP', label: 'WEP' },
                { value: 'nopass', label: t('qr.open') },
              ]}
            />
            {wifi.security !== 'nopass' && field(t('qr.password'), wifi.password, (v) => setWifi({ ...wifi, password: v }))}
            <label className="switch-row">
              <span>{t('qr.hidden')}</span>
              <input type="checkbox" className="switch" checked={wifi.hidden} onChange={(e) => setWifi({ ...wifi, hidden: e.target.checked })} />
            </label>
          </>
        )}
        {kind === 'contact' && (
          <>
            {field(t('qr.name'), contact.name, (v) => setContact({ ...contact, name: v }))}
            {field(t('qr.phone'), contact.phone, (v) => setContact({ ...contact, phone: v }), 'tel')}
            {field(t('qr.email'), contact.email, (v) => setContact({ ...contact, email: v }), 'email')}
            {field(t('qr.org'), contact.org, (v) => setContact({ ...contact, org: v }))}
            {field(t('qr.url'), contact.url, (v) => setContact({ ...contact, url: v }), 'url')}
          </>
        )}
        {kind === 'phone' && field(t('qr.phone'), phone, setPhone, 'tel')}
        {kind === 'email' && (
          <>
            {field(t('qr.email'), email.to, (v) => setEmail({ ...email, to: v }), 'email')}
            {field(t('qr.subject'), email.subject, (v) => setEmail({ ...email, subject: v }))}
            {field(t('qr.message'), email.body, (v) => setEmail({ ...email, body: v }), 'text', true)}
          </>
        )}
        {kind === 'sms' && (
          <>
            {field(t('qr.phone'), sms.to, (v) => setSms({ ...sms, to: v }), 'tel')}
            {field(t('qr.message'), sms.body, (v) => setSms({ ...sms, body: v }), 'text', true)}
          </>
        )}

        <div className="qr-preview">
          {content ? <canvas ref={canvasRef} /> : <Empty icon="qr" text={t('qrFillIn')} />}
          {tooLong && <p className="warn small">{t('qrTooLong')}</p>}
        </div>

        <div className="row gap wrap">
          <span className="muted">{t('color')}</span>
          {[
            ['#000000', '#ffffff'],
            ['#0b5d4b', '#ffffff'],
            ['#1e3a8a', '#ffffff'],
            ['#7c2d12', '#fff7ed'],
            ['#ffffff', '#111111'],
          ].map(([fg, bg]) => (
            <button key={fg + bg} className={`swatch ${style.fg === fg && style.bg === bg ? 'on' : ''}`} style={{ background: `linear-gradient(135deg, ${fg} 50%, ${bg} 50%)` }} onClick={() => setStyle({ ...style, fg, bg })} aria-label={fg} />
          ))}
        </div>
        <div className="field">
          <span>{t('errorCorrection')}</span>
          <Segmented
            value={style.ecc}
            onChange={(v) => setStyle({ ...style, ecc: v })}
            options={[
              { value: 'L', label: 'L 7%' },
              { value: 'M', label: 'M 15%' },
              { value: 'Q', label: 'Q 25%' },
              { value: 'H', label: 'H 30%' },
            ]}
          />
        </div>
      </div>
    </Screen>
  )
}
