import type { KeyboardEvent } from 'react'

// Enter in a passphrase field moves to the next field of the form while that one
// is still empty, instead of submitting a half-filled form (which would report a
// mismatch and clear what was typed). Once the next field is filled, Enter submits.
export function advanceOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  const form = event.currentTarget.form
  if (!form) return
  const fields = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]:not([disabled])'))
  const next = fields[fields.indexOf(event.currentTarget) + 1]
  if (!next || next.value !== '') return
  event.preventDefault()
  next.focus()
}
