import type { ReactNode } from 'react'
import { formatRoute, type AppRoute } from '../app/navigation'
import { isPlainClick, useNavigation } from '../app/useNavigation'

type Props = { route: AppRoute, className?: string, 'aria-label'?: string, onNavigate?: () => void, children: ReactNode }

// A real link with an ID-only href. A plain click is routed through the
// navigation guards; a modified click keeps its normal browser behavior.
export function NavLink({ route, className, onNavigate, children, ...rest }: Props) {
  const navigation = useNavigation()
  return <a
    className={className}
    href={formatRoute(route)}
    aria-label={rest['aria-label']}
    onClick={(event) => {
      if (!isPlainClick(event)) return
      event.preventDefault()
      onNavigate?.()
      void navigation.navigate(route)
    }}
  >{children}</a>
}
