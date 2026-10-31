import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import { useApp, useObjectUrl } from '../state'
import { getPage, type DocRec } from '../lib/db'

export function Header({ title, right, onBack }: { title: ReactNode; right?: ReactNode; onBack?: () => void }) {
  const { back, t } = useApp()
  return (
    <header className="header">
      <button className="icon-btn" onClick={onBack ?? back} aria-label={t('back')}>
        <Icon name="back" />
      </button>
      <h1 className="header-title">{title}</h1>
      <div className="header-right">{right}</div>
    </header>
  )
}

export function Screen({ title, right, children, footer, onBack, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; footer?: ReactNode; onBack?: () => void; className?: string }) {
  return (
    <div className={`screen ${className ?? ''}`}>
      <Header title={title} right={right} onBack={onBack} />
      <main className="screen-body">{children}</main>
      {footer && <footer className="screen-footer">{footer}</footer>}
    </div>
  )
}

export function ToolTile({ icon, color, label, onClick, badge, isNew }: { icon: IconName; color: string; label: string; onClick: () => void; badge?: string; isNew?: boolean }) {
  const { t } = useApp()
  return (
    <button className="tool" onClick={onClick}>
      <span className="tool-icon" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
        <Icon name={icon} size={28} />
        {badge && <span className="tool-badge">{badge}</span>}
        {isNew && <span className="tool-new">{t('newBadge')}</span>}
      </span>
      <span className="tool-label">{label}</span>
    </button>
  )
}

export function PageImg({ pageId, className, alt = '' }: { pageId: string | undefined; className?: string; alt?: string }) {
  const [blob, setBlob] = useState<Blob>()
  useEffect(() => {
    let alive = true
    if (pageId) getPage(pageId).then((p) => alive && setBlob(p?.blob))
    return () => {
      alive = false
    }
  }, [pageId])
  const url = useObjectUrl(blob)
  return url ? <img className={className} src={url} alt={alt} loading="lazy" /> : <div className={`${className ?? ''} img-ph`} />
}

export function formatDate(ms: number, lang: string): string {
  return new Date(ms).toLocaleString(lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export interface SwipeAction {
  label: string
  icon: IconName
  tone?: 'danger' | 'accent'
  run: () => void
}

// Only one row is swiped open at a time.
let closeOpenRow: (() => void) | null = null

/**
 * A document in a list. Swipe left to reveal `swipe` actions; long-press to call `onLongPress`
 * (the click that ends a long press is swallowed so it doesn't also open the document).
 */
export function DocRow({ doc, onClick, selected, onSelect, actions, swipe, onLongPress, extra }: { doc: DocRec; onClick: () => void; selected?: boolean; onSelect?: () => void; actions?: ReactNode; swipe?: SwipeAction[]; onLongPress?: () => void; extra?: ReactNode }) {
  const { lang } = useApp()
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const g = useRef<{ x: number; y: number; start: number; dir: 'h' | 'v' | null; timer: number; long: boolean } | null>(null)
  const swallowClick = useRef(false)
  const width = (swipe?.length ?? 0) * 76
  const close = () => setDx(0)

  const down = (e: React.PointerEvent) => {
    // A swipe or long-press may not be followed by a click (touch rarely is), so reset per gesture.
    swallowClick.current = false
    // Up/down from the checkbox is drag-to-select (see dragSelect.ts); sideways still swipes. No long-press there.
    const onCheck = !!(e.target as Element).closest('.check')
    const timer = onLongPress && !onCheck
      ? window.setTimeout(() => {
          if (!g.current || g.current.dir) return
          g.current.long = true
          swallowClick.current = true
          navigator.vibrate?.(15)
          onLongPress()
        }, 500)
      : 0
    g.current = { x: e.clientX, y: e.clientY, start: dx, dir: null, timer, long: false }
  }
  const move = (e: React.PointerEvent) => {
    const s = g.current
    if (!s) return
    const mx = e.clientX - s.x
    const my = e.clientY - s.y
    if (!s.dir && Math.hypot(mx, my) > 8) {
      s.dir = Math.abs(mx) > Math.abs(my) ? 'h' : 'v'
      window.clearTimeout(s.timer)
      if (s.dir === 'h' && width) {
        if (closeOpenRow && closeOpenRow !== close) closeOpenRow()
        setDragging(true)
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }
    }
    if (s.dir === 'h' && width) setDx(Math.min(0, Math.max(-width - 30, s.start + mx)))
  }
  const up = () => {
    const s = g.current
    g.current = null
    if (!s) return
    window.clearTimeout(s.timer)
    if (s.dir === 'h' && width) {
      swallowClick.current = true
      setDragging(false)
      const open = dx < -width / 3
      setDx(open ? -width : 0)
      closeOpenRow = open ? close : null
    }
  }
  const tap = (fn: () => void) => () => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    if (dx !== 0) return close()
    fn()
  }

  return (
    <div className={`doc-row-wrap ${selected ? 'selected' : ''}`} data-sel-id={doc.id}>
      <div className="swipe-box">
        {swipe && dx !== 0 && (
          <div className="swipe-actions" style={{ width }}>
            {swipe.map((a) => (
              <button
                key={a.label}
                className={`swipe-action ${a.tone ?? ''}`}
                onClick={() => {
                  close()
                  a.run()
                }}
              >
                <Icon name={a.icon} size={20} />
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        )}
        <div
          className="doc-row"
          style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : 'transform 0.2s ease' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onContextMenu={(e) => onLongPress && e.preventDefault()}
        >
          <button className="doc-row-main" onClick={tap(onClick)}>
            <PageImg pageId={doc.pageIds[0]} className="doc-thumb" />
            <span className="doc-meta">
              <span className="doc-name">{doc.name}</span>
              <span className="doc-sub">
                {formatDate(doc.updatedAt, lang)} <span className="dot" /> <Icon name="docs" size={14} /> {doc.pageIds.length}
              </span>
              {extra}
            </span>
          </button>
          {onSelect && (
            <button className={`check ${selected ? 'on' : ''}`} onClick={tap(onSelect)} aria-pressed={selected} aria-label="select">
              {selected && <Icon name="check" size={16} stroke={2.6} />}
            </button>
          )}
        </div>
      </div>
      {actions && <div className="doc-actions">{actions}</div>}
    </div>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  if (!open) return null
  // Portalled to <body> so screen footers and scroll containers can't cover or clip it.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        {title && <div className="sheet-title">{title}</div>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function TextDialog({ open, title, initial, onCancel, onOk, type = 'text', placeholder }: { open: boolean; title: string; initial: string; onCancel: () => void; onOk: (v: string) => void; type?: string; placeholder?: string }) {
  const { t } = useApp()
  const [v, setV] = useState(initial)
  useEffect(() => setV(initial), [initial, open])
  if (!open) return null
  return createPortal(
    <div className="sheet-backdrop center" onClick={onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (v.trim()) onOk(v.trim())
        }}
      >
        <div className="dialog-title">{title}</div>
        <input className="input" autoFocus type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!v.trim()}>
            {t('ok')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

export function Empty({ icon, text, children }: { icon: IconName; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={44} stroke={1.4} />
      <p>{text}</p>
      {children}
    </div>
  )
}
