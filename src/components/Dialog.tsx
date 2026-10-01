import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

type DialogProps = { title: string, children: ReactNode, onRequestClose: () => void, canClose: () => boolean }
const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({ title, children, onRequestClose, canClose }: DialogProps) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement
    const first = ref.current?.querySelector<HTMLElement>(focusable)
    ;(first ?? ref.current)?.focus()
    return () => previousFocus.current?.focus()
  }, [])

  useEffect(() => {
    function guard(event: FocusEvent) {
      const target = event.target as HTMLElement
      if (ref.current && !ref.current.contains(target)) {
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
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
    <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label="Close dialog" onClick={requestClose}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
      {children}
    </div>
  </div>
}
