export function UnsupportedBrowserScreen({ missingApis }: { missingApis: string[] }) {
  return <main className="support-screen"><h1>Browser not supported</h1><p>Scratch needs these browser features: {missingApis.join(', ')}.</p><p>Try a current browser with secure access.</p></main>
}
export function StorageUnavailableScreen({ onRetry }: { onRetry: () => void }) {
  return <main className="support-screen"><h1>Storage unavailable</h1><p>Scratch cannot access local storage right now. Your notes cannot be saved here.</p><button type="button" onClick={onRetry}>Retry</button></main>
}
