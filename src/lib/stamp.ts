// Photo timestamp templates. Each template measures its block, then draws it at the chosen
// corner. Sizes are relative to the photo so the stamp looks the same on any resolution.

export type StampTemplate = 'timeLocation' | 'onSite' | 'clockIn' | 'digital' | 'classic'
export const STAMP_TEMPLATES: StampTemplate[] = ['timeLocation', 'onSite', 'clockIn', 'digital', 'classic']
/** Top/bottom × left/centre/right. */
export type StampPos = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'
export const STAMP_POSITIONS: StampPos[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br']

export interface StampOptions {
  template: StampTemplate
  when: Date
  hour24: boolean
  showDate: boolean
  location: string
  coords: string // GPS coordinates line, '' to hide
  note: string
  brand: string // the user's own watermark line, e.g. a company name
  logo: HTMLImageElement | null
  pos: StampPos // where the time / date / location / note group goes
  size: number // 0.6 – 1.6, size of that group
  // The user's watermark (logo + text) is a separate group with its own position and size.
  brandPos: StampPos
  brandSize: number // 0.5 – 4
  locale: string // BCP 47, for the weekday name
  labels: { onSite: string; clockIn: string; time: string; location: string; note: string; gps: string }
}

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Noto Sans", "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
const pad2 = (n: number) => String(n).padStart(2, '0')

export function formatTime(d: Date, hour24: boolean, seconds = true): string {
  const s = seconds ? `:${pad2(d.getSeconds())}` : ''
  if (hour24) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}${s}`
  const h = d.getHours() % 12 || 12
  return `${pad2(h)}:${pad2(d.getMinutes())}${s} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

/** dd/mm/yyyy, the usual order in Malaysia. */
export function formatDate(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function weekday(d: Date, locale: string): string {
  try {
    return d.toLocaleDateString(locale, { weekday: 'long' })
  } catch {
    return d.toLocaleDateString('en', { weekday: 'long' })
  }
}

interface Block {
  w: number
  h: number
  draw: (x: number, y: number) => void
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function pin(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color = '#ff5a3c') {
  // Map pin: circle head with a point, centred on (x, y + s/2).
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x + s / 2, y + s * 0.38, s * 0.36, Math.PI * 0.85, Math.PI * 2.15)
  ctx.lineTo(x + s / 2, y + s)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(x + s / 2, y + s * 0.38, s * 0.14, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  ctx.font = font
  return ctx.measureText(text).width
}

/** The user's watermark line (logo + text), shared by all templates. */
function brandLine(ctx: CanvasRenderingContext2D, o: StampOptions, u: number, color: string): Block | null {
  if (!o.brand && !o.logo) return null
  const fs = 2.6 * u
  const font = `500 ${fs}px ${FONT}`
  const logoH = o.logo ? fs * 1.5 : 0
  const logoW = o.logo ? (logoH * o.logo.width) / o.logo.height : 0
  const gap = o.logo && o.brand ? fs * 0.5 : 0
  const tw = o.brand ? measure(ctx, font, o.brand) : 0
  return {
    w: logoW + gap + tw,
    h: Math.max(logoH, fs * 1.3),
    draw: (x, y) => {
      const h = Math.max(logoH, fs * 1.3)
      if (o.logo) ctx.drawImage(o.logo, x, y + (h - logoH) / 2, logoW, logoH)
      if (o.brand) {
        ctx.save()
        ctx.font = font
        ctx.fillStyle = color
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,.55)'
        ctx.shadowBlur = fs * 0.18
        ctx.fillText(o.brand, x + logoW + gap, y + h / 2)
        ctx.restore()
      }
    },
  }
}

/** Stacks blocks vertically with a gap, left-aligned. */
function stack(blocks: (Block | null)[], gap: number): Block {
  const list = blocks.filter((b): b is Block => !!b)
  const w = Math.max(...list.map((b) => b.w))
  const h = list.reduce((s, b) => s + b.h, 0) + gap * (list.length - 1)
  return {
    w,
    h,
    draw: (x, y) => {
      let yy = y
      for (const b of list) {
        b.draw(x, yy)
        yy += b.h + gap
      }
    },
  }
}

function textBlock(ctx: CanvasRenderingContext2D, text: string, font: string, fs: number, color: string, shadow = true): Block {
  return {
    w: measure(ctx, font, text),
    h: fs * 1.2,
    draw: (x, y) => {
      ctx.save()
      ctx.font = font
      ctx.fillStyle = color
      ctx.textBaseline = 'middle'
      if (shadow) {
        ctx.shadowColor = 'rgba(0,0,0,.55)'
        ctx.shadowBlur = fs * 0.18
        ctx.shadowOffsetY = fs * 0.04
      }
      ctx.fillText(text, x, y + fs * 0.6)
      ctx.restore()
    },
  }
}

function pinLine(ctx: CanvasRenderingContext2D, text: string, fs: number, color: string): Block {
  const t = textBlock(ctx, text, `600 ${fs}px ${FONT}`, fs, color)
  const s = fs * 1.05
  return {
    w: s + fs * 0.4 + t.w,
    h: t.h,
    draw: (x, y) => {
      pin(ctx, x, y + (t.h - s) / 2, s)
      t.draw(x + s + fs * 0.4, y)
    },
  }
}

function dateLine(o: StampOptions): string {
  return `${weekday(o.when, o.locale)} | ${formatDate(o.when)}`
}

function buildBlock(ctx: CanvasRenderingContext2D, o: StampOptions, u: number): Block {
  const white = '#ffffff'
  switch (o.template) {
    case 'timeLocation':
      return stack(
        [
          textBlock(ctx, formatTime(o.when, o.hour24), `600 ${11 * u}px ${FONT}`, 11 * u, white),
          o.showDate ? textBlock(ctx, dateLine(o), `600 ${3.6 * u}px ${FONT}`, 3.6 * u, white) : null,
          o.location ? pinLine(ctx, o.location, 3.6 * u, white) : null,
          o.coords ? textBlock(ctx, o.coords, `500 ${3 * u}px ${FONT}`, 3 * u, white) : null,
          o.note ? textBlock(ctx, o.note, `500 ${3.2 * u}px ${FONT}`, 3.2 * u, white) : null,
        ],
        1.2 * u,
      )
    case 'onSite': {
      const fs = 3.4 * u
      const p = 1.8 * u
      const rows: [string, string][] = [[o.labels.time, `${o.showDate ? formatDate(o.when) + ' ' : ''}${formatTime(o.when, o.hour24, false)}`]]
      if (o.location) rows.push([o.labels.location, o.location])
      if (o.coords) rows.push([o.labels.gps, o.coords])
      if (o.note) rows.push([o.labels.note, o.note])
      const lab = Math.max(...rows.map((r) => measure(ctx, `600 ${fs}px ${FONT}`, r[0] + ':')))
      const val = Math.max(...rows.map((r) => measure(ctx, `500 ${fs}px ${FONT}`, r[1])))
      const head = 5.5 * u
      const w = Math.max(p * 2 + lab + fs + val, measure(ctx, `600 ${4.2 * u}px ${FONT}`, o.labels.onSite) + p * 2)
      const h = head + p * 2 + rows.length * fs * 1.7
      const card: Block = {
        w,
        h,
        draw: (x, y) => {
          ctx.save()
          ctx.fillStyle = 'rgba(205,210,218,.92)'
          ctx.fillRect(x, y, w, h)
          ctx.fillStyle = '#1f4fe0'
          ctx.fillRect(x, y, w, head)
          ctx.fillStyle = '#fff'
          ctx.font = `600 ${4.2 * u}px ${FONT}`
          ctx.textBaseline = 'middle'
          ctx.fillText(o.labels.onSite, x + p, y + head / 2)
          rows.forEach(([k, v], i) => {
            const yy = y + head + p + fs * 1.7 * i + fs * 0.85
            ctx.font = `600 ${fs}px ${FONT}`
            ctx.fillStyle = '#1f4fe0'
            ctx.fillText(k + ':', x + p, yy)
            ctx.font = `500 ${fs}px ${FONT}`
            ctx.fillStyle = '#1b1f27'
            ctx.fillText(v, x + p + lab + fs, yy)
          })
          ctx.restore()
        },
      }
      return card
    }
    case 'clockIn': {
      const big = 10 * u
      const timeW = measure(ctx, `700 ${big}px ${FONT}`, formatTime(o.when, o.hour24))
      const w = timeW + 6 * u
      const head = 6 * u
      const h = head + big * 1.5
      const card: Block = {
        w,
        h,
        draw: (x, y) => {
          ctx.save()
          roundRect(ctx, x, y, w, h, 1.6 * u)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          ctx.save()
          ctx.clip()
          ctx.fillStyle = '#2fbf8f'
          ctx.fillRect(x, y, w, head)
          ctx.restore()
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = '#fff'
          ctx.font = `600 ${4.2 * u}px ${FONT}`
          ctx.fillText(o.labels.clockIn, x + w / 2, y + head / 2)
          ctx.fillStyle = '#12161c'
          ctx.font = `700 ${big}px ${FONT}`
          ctx.fillText(formatTime(o.when, o.hour24), x + w / 2, y + head + big * 0.78)
          ctx.restore()
        },
      }
      return stack(
        [
          card,
          o.showDate ? textBlock(ctx, dateLine(o), `600 ${3.4 * u}px ${FONT}`, 3.4 * u, '#fff') : null,
          o.location ? pinLine(ctx, o.location, 3.4 * u, '#fff') : null,
          o.coords ? textBlock(ctx, o.coords, `500 ${2.9 * u}px ${FONT}`, 2.9 * u, '#fff') : null,
          o.note ? textBlock(ctx, o.note, `500 ${3.1 * u}px ${FONT}`, 3.1 * u, '#fff') : null,
        ],
        1.2 * u,
      )
    }
    case 'digital': {
      const big = 11 * u
      const small = 3.2 * u
      const time = formatTime(o.when, true)
      const timeW = measure(ctx, `700 ${big}px ${MONO}`, time)
      const w = timeW + 5 * u
      const h = small * 2 + big * 1.25
      const day = o.when.toLocaleDateString('en', { weekday: 'short' }).toUpperCase()
      const panel: Block = {
        w,
        h,
        draw: (x, y) => {
          ctx.save()
          roundRect(ctx, x, y, w, h, 1.4 * u)
          ctx.fillStyle = '#f2f3f0'
          ctx.fill()
          roundRect(ctx, x + 0.8 * u, y + 0.8 * u, w - 1.6 * u, h - 1.6 * u, 0.8 * u)
          ctx.fillStyle = '#c9cdc4'
          ctx.fill()
          ctx.fillStyle = '#1d2119'
          ctx.textBaseline = 'middle'
          ctx.font = `600 ${small}px ${MONO}`
          if (o.showDate) ctx.fillText(formatDate(o.when), x + 2.5 * u, y + small * 1.3)
          ctx.textAlign = 'right'
          ctx.fillText(day, x + w - 2.5 * u, y + small * 1.3)
          ctx.textAlign = 'center'
          ctx.font = `700 ${big}px ${MONO}`
          ctx.fillText(time, x + w / 2, y + small * 2 + big * 0.55)
          ctx.restore()
        },
      }
      return stack(
        [
          panel,
          o.location ? pinLine(ctx, o.location, 3.4 * u, '#fff') : null,
          o.coords ? textBlock(ctx, o.coords, `500 ${2.9 * u}px ${FONT}`, 2.9 * u, '#fff') : null,
          o.note ? textBlock(ctx, o.note, `500 ${3.1 * u}px ${FONT}`, 3.1 * u, '#fff') : null,
        ],
        1.2 * u,
      )
    }
    case 'classic': {
      const fs = 4.5 * u
      const d = o.when
      const text = `${o.showDate ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` : ''}${formatTime(d, true, false)}`
      return stack(
        [
          textBlock(ctx, text, `700 ${fs}px ${MONO}`, fs, '#ff8a00'),
          o.location ? textBlock(ctx, o.location, `600 ${3 * u}px ${FONT}`, 3 * u, '#ff8a00') : null,
          o.coords ? textBlock(ctx, o.coords, `500 ${2.8 * u}px ${MONO}`, 2.8 * u, '#ff8a00') : null,
          o.note ? textBlock(ctx, o.note, `500 ${3 * u}px ${FONT}`, 3 * u, '#ff8a00') : null,
        ],
        0.8 * u,
      )
    }
  }
}

/** Top-left corner for a block of size w×h at position `pos`, `margin` from the edges. */
function place(pos: StampPos, w: number, h: number, W: number, H: number, margin: number) {
  const x = pos.endsWith('l') ? margin : pos.endsWith('r') ? W - margin - w : (W - w) / 2
  const y = pos.startsWith('t') ? margin : H - margin - h
  return { x, y }
}

/**
 * Draws the stamp onto `c` (which already holds the photo): the time/info group at `pos` and the
 * user's watermark group at `brandPos`, each with its own size. If both are put in the same spot
 * they are stacked (info first) so they don't overlap.
 */
export function drawStamp(c: HTMLCanvasElement, o: StampOptions): void {
  const ctx = c.getContext('2d')!
  const base = Math.min(c.width, c.height) / 100
  const W = c.width
  const H = c.height
  const brandColor = o.template === 'classic' ? '#ff8a00' : 'rgba(255,255,255,.92)'
  ctx.save()
  // Shrink a group to fit if a long location, note or watermark would run off the photo.
  const fitted = (build: (scale: number) => Block | null, scale: number, margin: number) => {
    const b = build(scale)
    if (!b) return null
    const f = Math.min(1, (W - margin * 2) / b.w, (H - margin * 2) / b.h)
    return f < 1 ? build(scale * f) : b
  }
  const margin = 4 * base
  const info = fitted((k) => buildBlock(ctx, { ...o, size: k }, base * k), o.size, margin)!
  const brand = fitted((k) => brandLine(ctx, o, base * k, brandColor), o.brandSize, margin)
  if (brand && o.brandPos === o.pos) {
    const gap = 1.2 * base * o.size
    const both = stack([info, brand], gap)
    const xy = place(o.pos, both.w, both.h, W, H, margin)
    // Centre each group within the shared column when the column is centred.
    if (o.pos.endsWith('c')) {
      info.draw(xy.x + (both.w - info.w) / 2, xy.y)
      brand.draw(xy.x + (both.w - brand.w) / 2, xy.y + info.h + gap)
    } else if (o.pos.endsWith('r')) {
      info.draw(xy.x + both.w - info.w, xy.y)
      brand.draw(xy.x + both.w - brand.w, xy.y + info.h + gap)
    } else both.draw(xy.x, xy.y)
  } else {
    const a = place(o.pos, info.w, info.h, W, H, margin)
    info.draw(a.x, a.y)
    if (brand) {
      const b = place(o.brandPos, brand.w, brand.h, W, H, margin)
      brand.draw(b.x, b.y)
    }
  }
  ctx.restore()
}
