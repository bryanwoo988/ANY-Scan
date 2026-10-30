import { useEffect, useState, type ReactNode } from 'react'
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

export function ToolTile({ icon, color, label, onClick, badge }: { icon: IconName; color: string; label: string; onClick: () => void; badge?: string }) {
  return (
    <button className="tool" onClick={onClick}>
      <span className="tool-icon" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
        <Icon name={icon} size={28} />
        {badge && <span className="tool-badge">{badge}</span>}
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

export function DocRow({ doc, onClick, selected, onSelect, actions }: { doc: DocRec; onClick: () => void; selected?: boolean; onSelect?: () => void; actions?: ReactNode }) {
  const { lang } = useApp()
  return (
    <div className="doc-row-wrap">
      <div className="doc-row">
        <button className="doc-row-main" onClick={onClick}>
          <PageImg pageId={doc.pageIds[0]} className="doc-thumb" />
          <span className="doc-meta">
            <span className="doc-name">{doc.name}</span>
            <span className="doc-sub">
              {formatDate(doc.updatedAt, lang)} <span className="dot" /> <Icon name="docs" size={14} /> {doc.pageIds.length}
            </span>
          </span>
        </button>
        {onSelect && (
          <button className={`check ${selected ? 'on' : ''}`} onClick={onSelect} aria-pressed={selected} aria-label="select">
            {selected && <Icon name="check" size={16} stroke={2.6} />}
          </button>
        )}
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
