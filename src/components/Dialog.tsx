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

  function requestClose() { if (canClose()) onRequestClose() }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.stopPropagation(); requestClose(); return }
    if (event.key !== 'Tab') return
    const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>(focusable) ?? [])
    if (elements.length === 0) { event.preventDefault(); ref.current?.focus(); return }
    const first = elements[0]
    const last = elements[elements.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
    <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" aria-label="Close dialog" onClick={requestClose}>×</button></div>
      {children}
    </div>
  </div>
}
