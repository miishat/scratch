import type { ReactNode } from 'react'

export function TileGrid({ children, label }: { children: ReactNode, label?: string }) {
  return <ul className="tile-grid" aria-label={label}>{children}</ul>
}
