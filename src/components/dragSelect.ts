// Drag-to-select for lists, like the Photos app: put a finger on a row's checkbox and slide up or down.
// Every row between the start and the finger takes the start row's new state (select, or deselect if it
// was already selected); sliding back releases rows again. Near the top or bottom edge the list scrolls.
import { useRef, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'

const EDGE_TOP = 70
const EDGE_BOTTOM = 170 // room for the selection bar and tab bar that float over the list
const MAX_SPEED = 14

/** Index of the row at height `y`, clamped to the first/last row. Rows carry `data-sel-id`. */
export function rowIndexAt(rows: { top: number; bottom: number }[], y: number): number {
  if (!rows.length) return -1
  if (y < rows[0].top) return 0
  for (let i = 0; i < rows.length; i++) if (y < rows[i].bottom) return i
  return rows.length - 1
}

/** New selection when dragging from `ids[from]` to `ids[to]`, starting from `base`. */
export function dragSelection(ids: string[], base: string[], from: number, to: number, adding: boolean): string[] {
  const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1)
  if (adding) return [...base, ...range.filter((id) => !base.includes(id))]
  return base.filter((id) => !range.includes(id))
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/**
 * Returns props for the list element. `ids` are the visible rows in order; each row element needs
 * `data-sel-id`, and a drag starts on its `.check` button. A plain tap still reaches the checkbox.
 */
export function useDragSelect(ids: string[], sel: string[], setSel: (s: string[]) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef({ ids, sel, setSel })
  latest.current = { ids, sel, setSel }
  const swallowClick = useRef(false)

  const onPointerDown = (e: RPointerEvent) => {
    const target = e.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-sel-id]')
    if (!target.closest('.check') || !row || !ref.current) return
    const from = latest.current.ids.indexOf(row.dataset.selId!)
    if (from < 0) return
    const adding = !latest.current.sel.includes(row.dataset.selId!)
    const base = latest.current.sel
    const startX = e.clientX
    const startY = e.clientY
    let y = e.clientY
    let moved = false
    let raf = 0
    const scroller = scrollParent(ref.current)

    const apply = () => {
      const rows = [...ref.current!.querySelectorAll<HTMLElement>('[data-sel-id]')]
      const rects = rows.map((r) => r.getBoundingClientRect())
      const i = rowIndexAt(rects, y)
      if (i < 0) return
      const to = latest.current.ids.indexOf(rows[i].dataset.selId!)
      if (to >= 0) latest.current.setSel(dragSelection(latest.current.ids, base, from, to, adding))
    }
    const tick = () => {
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        const v = y > r.bottom - EDGE_BOTTOM ? Math.min(1, (y - (r.bottom - EDGE_BOTTOM)) / EDGE_BOTTOM) : y < r.top + EDGE_TOP ? -Math.min(1, (r.top + EDGE_TOP - y) / EDGE_TOP) : 0
        if (v) {
          scroller.scrollTop += v * MAX_SPEED
          apply()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      y = ev.clientY
      if (!moved) {
        const dx = Math.abs(ev.clientX - startX)
        const dy = Math.abs(y - startY)
        if (Math.hypot(dx, dy) < 8) return
        // A sideways start is a swipe on the row, not a selection.
        if (dx > dy) return up(ev)
      }
      if (!moved) {
        moved = true
        navigator.vibrate?.(10)
        raf = requestAnimationFrame(tick)
      }
      apply()
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      cancelAnimationFrame(raf)
      if (moved) {
        // The drag already set the selection; don't let the checkbox's click toggle it again.
        swallowClick.current = true
        window.setTimeout(() => (swallowClick.current = false), 50)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onClickCapture = (e: RMouseEvent) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    e.stopPropagation()
    e.preventDefault()
  }

  return { ref, onPointerDown, onClickCapture }
}
