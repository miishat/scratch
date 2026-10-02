// The pencil mark. It draws with currentColor so it follows the surrounding text color.
export function Logo({ className }: { className?: string }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 48 48"><path d="M10 36l3-10 18-18 7 7-18 18zM27 12l7 7M10 43h28" /></svg>
}
