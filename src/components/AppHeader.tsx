type Props = { onAdd?: () => void, onSettings?: () => void }
export function AppHeader({ onAdd, onSettings }: Props) {
  return <header className="app-header"><div className="header-inner">
    <a className="wordmark" href="/" aria-label="Scratch home">Scratch</a>
    <label className="header-search"><span className="visually-hidden">Search</span><input type="search" placeholder="Search" aria-label="Search" /></label>
    {/* TODO (Task 5): wire the Add menu through onAdd. */}
    <button className="primary-button header-add" type="button" aria-label="Add" onClick={onAdd}>+ Add</button>
    <button className="icon-button header-settings" type="button" aria-label="Settings" onClick={onSettings}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M10 2h4l.5 2.2 1.8.8 2-.9 2.8 2.8-.9 2 .8 1.8L23 11v4l-2.2.5-.8 1.8.9 2-2.8 2.8-2-.9-1.8.8L14 23h-4l-.5-2.2-1.8-.8-2 .9-2.8-2.8.9-2-.8-1.8L1 15v-4l2.2-.5.8-1.8-.9-2 2.8-2.8 2 .9 1.8-.8z" transform="translate(0 -1) scale(1 .96)"/></svg>
    </button>
  </div></header>
}
