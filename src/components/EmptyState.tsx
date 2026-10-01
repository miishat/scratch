type Props = { onAddNote?: () => void, onAddCollection?: () => void }
export function EmptyState({ onAddNote, onAddCollection }: Props) {
  return <section className="empty-state" aria-labelledby="empty-title">
    <h1 id="empty-title">A place for the little things.</h1>
    <p>Keep your notes and collections together in Scratch.</p>
    <div className="empty-actions">
      {/* TODO (Tasks 4/5): connect the note and collection creation callbacks. */}
      <button className="primary-button" type="button" onClick={onAddNote}>Add note</button>
      <button type="button" onClick={onAddCollection}>Add collection</button>
    </div>
  </section>
}
