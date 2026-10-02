// The app mark: a note page on a rounded square. It matches the installed app icon and
// takes its colors from the active scheme, so it follows the theme.
export function Logo({ className }: { className?: string }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 48 48">
    <rect width="48" height="48" rx="11" fill="var(--action)" />
    <path d="M12 12a4 4 0 0 1 4-4h12l8 8v20a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z" fill="var(--action-text)" />
    <path d="M28 8v8h8z" fill="var(--action)" opacity="0.3" />
    <path d="M17 23h14M17 29h14M17 35h8" fill="none" stroke="var(--action)" strokeWidth="3" strokeLinecap="round" />
  </svg>
}
