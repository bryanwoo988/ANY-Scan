import { describe, expect, it } from 'vitest'
import { buildContact, buildWifi, normalizeUrl, parseQr } from '../src/lib/qr'

describe('Wi-Fi QR', () => {
  it('builds the standard format and escapes special characters', () => {
    expect(buildWifi({ ssid: 'Home;Net', password: 'p:a"s\\s', security: 'WPA', hidden: false })).toBe('WIFI:T:WPA;S:Home\\;Net;P:p\\:a\\"s\\\\s;;')
  })
  it('omits the password for open networks and marks hidden ones', () => {
    expect(buildWifi({ ssid: 'Cafe', password: 'x', security: 'nopass', hidden: true })).toBe('WIFI:T:nopass;S:Cafe;H:true;;')
  })
  it('round-trips through the parser', () => {
    const w = { ssid: 'My, Wi;Fi', password: 'a;b:c\\d', security: 'WPA' as const, hidden: true }
    const p = parseQr(buildWifi(w))
    expect(p).toEqual({ kind: 'wifi', wifi: w })
  })
  it('parses fields in any order', () => {
    expect(parseQr('WIFI:S:Office;P:secret123;T:WPA2;;')).toEqual({ kind: 'wifi', wifi: { ssid: 'Office', password: 'secret123', security: 'WPA', hidden: false } })
  })
})

describe('contact QR', () => {
  it('round-trips a vCard', () => {
    const v = buildContact({ name: 'Tan, Ah Kow', phone: '+60123456789', email: 'a@b.my', org: 'ACME; Sdn Bhd', url: '' })
    expect(v).toContain('BEGIN:VCARD')
    expect(parseQr(v)).toEqual({ kind: 'contact', name: 'Tan, Ah Kow', phone: '+60123456789', email: 'a@b.my', org: 'ACME; Sdn Bhd' })
  })
  it('parses MECARD', () => {
    expect(parseQr('MECARD:N:Lee,Mei;TEL:0123;EMAIL:m@x.com;;')).toMatchObject({ kind: 'contact', name: 'Lee Mei', phone: '0123', email: 'm@x.com' })
  })
})

describe('parseQr', () => {
  it('detects URLs', () => {
    expect(parseQr('https://example.com/a?b=1')).toEqual({ kind: 'url', url: 'https://example.com/a?b=1' })
    expect(parseQr('www.example.com')).toEqual({ kind: 'url', url: 'https://www.example.com' })
  })
  it('detects phone, email and SMS', () => {
    expect(parseQr('tel:+6031234')).toEqual({ kind: 'phone', phone: '+6031234' })
    expect(parseQr('mailto:x@y.com?subject=hi')).toEqual({ kind: 'email', email: 'x@y.com' })
    expect(parseQr('SMSTO:0123:Hello: world')).toEqual({ kind: 'sms', phone: '0123', body: 'Hello: world' })
  })
  it('falls back to text', () => {
    expect(parseQr('hello world')).toEqual({ kind: 'text', text: 'hello world' })
  })
  it('normalizes URLs without a scheme', () => {
    expect(normalizeUrl('anyscan.app')).toBe('https://anyscan.app')
    expect(normalizeUrl('http://a.b')).toBe('http://a.b')
  })
})
