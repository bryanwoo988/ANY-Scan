// QR code content builders/parsers, generation and decoding.
import QRCode from 'qrcode'
import jsQR from 'jsqr'

export type QrKind = 'text' | 'url' | 'wifi' | 'contact' | 'phone' | 'email' | 'sms'

export interface WifiData {
  ssid: string
  password: string
  security: 'WPA' | 'WEP' | 'nopass'
  hidden: boolean
}

export interface ContactData {
  name: string
  phone: string
  email: string
  org: string
  url: string
}

// Characters that must be escaped inside WIFI: and MECARD-style fields.
const escWifi = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')
const escVcard = (s: string) => s.replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n')

export function buildWifi(w: WifiData): string {
  let s = `WIFI:T:${w.security};S:${escWifi(w.ssid)};`
  if (w.security !== 'nopass') s += `P:${escWifi(w.password)};`
  if (w.hidden) s += 'H:true;'
  return s + ';'
}

export function buildContact(c: ContactData): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escVcard(c.name)}`, `N:${escVcard(c.name)};;;;`]
  if (c.phone) lines.push(`TEL:${escVcard(c.phone)}`)
  if (c.email) lines.push(`EMAIL:${escVcard(c.email)}`)
  if (c.org) lines.push(`ORG:${escVcard(c.org)}`)
  if (c.url) lines.push(`URL:${escVcard(c.url)}`)
  lines.push('END:VCARD')
  return lines.join('\n')
}

export function normalizeUrl(u: string): string {
  const t = u.trim()
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
}

/** Splits a `key:value;key:value;` string honouring backslash escapes. */
function splitFields(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  let cur = ''
  let esc = false
  const fields: string[] = []
  for (const ch of body) {
    if (esc) {
      cur += ch
      esc = false
    } else if (ch === '\\') esc = true
    else if (ch === ';') {
      fields.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) fields.push(cur)
  for (const f of fields) {
    const i = f.indexOf(':')
    if (i > 0) out[f.slice(0, i).toUpperCase()] = f.slice(i + 1)
  }
  return out
}

export type Parsed =
  | { kind: 'url'; url: string }
  | { kind: 'wifi'; wifi: WifiData }
  | { kind: 'contact'; name: string; phone: string; email: string; org: string }
  | { kind: 'phone'; phone: string }
  | { kind: 'email'; email: string }
  | { kind: 'sms'; phone: string; body: string }
  | { kind: 'text'; text: string }

export function parseQr(raw: string): Parsed {
  const s = raw.trim()
  if (/^WIFI:/i.test(s)) {
    // Fields are escaped, but the leading "WIFI:" is not a field.
    const f = splitFields(s.slice(5))
    const t = (f.T || 'nopass').toUpperCase()
    return {
      kind: 'wifi',
      wifi: {
        ssid: f.S ?? '',
        password: f.P ?? '',
        security: t === 'WPA' || t === 'WPA2' || t === 'WPA3' || t === 'SAE' ? 'WPA' : t === 'WEP' ? 'WEP' : 'nopass',
        hidden: (f.H ?? '').toLowerCase() === 'true',
      },
    }
  }
  if (/^BEGIN:VCARD/i.test(s)) {
    const get = (k: string) => {
      const m = s.match(new RegExp(`^${k}(?:;[^:\\n]*)?:(.*)$`, 'im'))
      return m ? m[1].replace(/\\([,;\\])/g, '$1').trim() : ''
    }
    return { kind: 'contact', name: get('FN') || get('N').replace(/;+/g, ' ').trim(), phone: get('TEL'), email: get('EMAIL'), org: get('ORG') }
  }
  if (/^MECARD:/i.test(s)) {
    const f = splitFields(s.slice(7))
    return { kind: 'contact', name: (f.N ?? '').replace(/,/g, ' '), phone: f.TEL ?? '', email: f.EMAIL ?? '', org: f.ORG ?? '' }
  }
  if (/^tel:/i.test(s)) return { kind: 'phone', phone: s.slice(4) }
  if (/^mailto:/i.test(s)) return { kind: 'email', email: s.slice(7).split('?')[0] }
  if (/^(sms|smsto):/i.test(s)) {
    const [, rest] = s.split(/:(.*)/s)
    const [phone, ...body] = rest.split(/[:?]/)
    return { kind: 'sms', phone, body: body.join(':').replace(/^body=/i, '') }
  }
  if (/^https?:\/\/\S+$/i.test(s) || /^www\.\S+\.\S+$/i.test(s)) return { kind: 'url', url: normalizeUrl(s) }
  return { kind: 'text', text: s }
}

export interface QrStyle {
  fg: string
  bg: string
  ecc: 'L' | 'M' | 'Q' | 'H'
}

export async function renderQr(canvas: HTMLCanvasElement, text: string, style: QrStyle, size = 720): Promise<void> {
  await QRCode.toCanvas(canvas, text || ' ', {
    width: size,
    margin: 2,
    errorCorrectionLevel: style.ecc,
    color: { dark: style.fg, light: style.bg },
  })
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }

let detector: Detector | null | undefined
function nativeDetector(): Detector | null {
  if (detector !== undefined) return detector
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector
  try {
    detector = BD ? new BD({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'data_matrix', 'pdf417'] }) : null
  } catch {
    detector = null
  }
  return detector
}

/** Decodes a QR code (or other barcode where the browser supports it) from a canvas. */
export async function decodeCanvas(c: HTMLCanvasElement): Promise<string | null> {
  const nd = nativeDetector()
  if (nd) {
    try {
      const r = await nd.detect(c)
      if (r.length) return r[0].rawValue
    } catch {
      /* fall through to jsQR */
    }
  }
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  return res?.data ?? null
}

export interface QrHistoryItem {
  id: string
  text: string
  at: number
  source: 'scan' | 'create'
}
export const QR_HISTORY_KEY = 'anyscan.qrHistory'
