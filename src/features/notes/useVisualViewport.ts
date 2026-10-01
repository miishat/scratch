import { useEffect } from 'react'

// On phones the software keyboard shrinks the visual viewport without always
// shrinking the layout viewport. While an editor is open, publish the visual
// viewport's height and offset as CSS variables so the sheet and its sticky
// Save and Cancel row stay above the keyboard.
export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    const apply = () => {
      root.style.setProperty('--visual-height', `${viewport.height}px`)
      root.style.setProperty('--visual-top', `${viewport.offsetTop}px`)
    }
    apply()
    viewport.addEventListener('resize', apply)
    viewport.addEventListener('scroll', apply)
    return () => {
      viewport.removeEventListener('resize', apply)
      viewport.removeEventListener('scroll', apply)
      root.style.removeProperty('--visual-height')
      root.style.removeProperty('--visual-top')
    }
  }, [])
}
