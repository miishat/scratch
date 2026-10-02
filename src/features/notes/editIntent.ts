// A tile's Edit button opens the note straight in the editor instead of the reader.
// The tile records the wish just before navigating; the editor reads it when it
// mounts and clears it, and the tile clears it again if navigation was refused.
let pending: string | null = null
export function requestEdit(noteId: string): void { pending = noteId }
export function wantsEdit(noteId: string): boolean { return pending === noteId }
export function clearEdit(noteId: string): void { if (pending === noteId) pending = null }
