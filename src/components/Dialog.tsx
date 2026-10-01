import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'

type DialogProps = {
  title: string
  children: ReactNode
  onRequestClose: () => void
  canClose: () => boolean
  // Adds a modifier class to the dialog and `<name>-backdrop` to its backdrop.
  className?: string
  // Selector for the element that takes focus on open instead of the first control.
  initialFocus?: string
}
const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
// Open dialogs, oldest first. Only the newest keeps focus inside itself, so two
// stacked dialogs never pull focus back and forth.
const openDialogs: HTMLElement[] = []

// Each open dialog offers a slot just under its heading. Page-level notices (the
// update prompt) render into the topmost slot, so they sit inside the dialog's own
// focus containment and are reachable by Tab and by screen readers.
const slots: HTMLElement[] = []
const slotListeners = new Set<() => void>()
function subscribeSlots(listener: () => void) {
  slotListeners.add(listener)
  return () => { slotListeners.delete(listener) }
}
let topSlot: HTMLElement | null = null
function publishSlots() {
  topSlot = slots[slots.length - 1] ?? null
  slotListeners.forEach((listener) => listener())
}
export function useTopDialogSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribeSlots, () => topSlot)
}

export function Dialog({ title, children, onRequestClose, canClose, className, initialFocus }: DialogProps) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const slot = slotRef.current
    if (slot) { slots.push(slot); publishSlots() }
    previousFocus.current = document.activeElement as HTMLElement
    const element = ref.current
    if (element) openDialogs.push(element)
    const first = (initialFocus ? element?.querySelector<HTMLElement>(initialFocus) : null) ?? element?.querySelector<HTMLElement>(focusable)
    ;(first ?? element)?.focus()
    return () => {
      const slotIndex = slot ? slots.indexOf(slot) : -1
      if (slotIndex >= 0) { slots.splice(slotIndex, 1); publishSlots() }
      const index = element ? openDialogs.indexOf(element) : -1
      if (index >= 0) openDialogs.splice(index, 1)
      previousFocus.current?.focus()
    }
    // Focus is placed once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function guard(event: FocusEvent) {
      const target = event.target as HTMLElement
      if (ref.current && openDialogs[openDialogs.length - 1] === ref.current && !ref.current.contains(target)) {
        const first = ref.current.querySelector<HTMLElement>(focusable)
        ;(first ?? ref.current)?.focus()
      }
    }
    document.addEventListener('focusin', guard)
    return () => document.removeEventListener('focusin', guard)
  }, [])

  function requestClose() { if (canClose()) onRequestClose() }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.stopPropagation(); requestClose(); return }
    if (event.key !== 'Tab') return
    const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>(focusable) ?? [])
    if (elements.length === 0) { event.preventDefault(); ref.current?.focus(); return }
    const first = elements[0]
    const last = elements[elements.length - 1]
    const active = document.activeElement
    const inside = !!ref.current?.contains(active)
    if (event.shiftKey) { if (!inside || active === first || active === ref.current) { event.preventDefault(); last.focus() } }
    else if (!inside || active === last) { event.preventDefault(); first.focus() }
  }
  return <div className={className ? `dialog-backdrop ${className}-backdrop` : 'dialog-backdrop'} onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
    <div ref={ref} className={className ? `dialog ${className}` : 'dialog'} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label="Close dialog" onClick={requestClose}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
      <div className="dialog-notice-slot" ref={slotRef} />
      {children}
    </div>
  </div>
}
