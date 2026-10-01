import type { CollectionColor, ItemId, ItemKind, LibraryItem, VaultId } from '../../src/features/library/types'

// Deterministic synthetic fixtures. No real credentials appear here; the secret
// note body is a fixed placeholder token.

export const fixtureVaultId: VaultId = 'b3d6f0e2-1c4a-4a1e-9b7d-2f5a8c0e1d3f'
export const fixtureGeneration = 1
export const fixtureRevision = 1
export const fixtureSecretBody = 'fixture-secret-DO-NOT-USE'
export const fixturePassphrase = 'correct horse battery staple'

// Fixed IDs keep fixtures reproducible across runs.
export const fixtureIds = {
  apiTokens: '00000000-0000-4000-8000-000000000001',
  openai: '00000000-0000-4000-8000-000000000002',
  anthropic: '00000000-0000-4000-8000-000000000003',
  personal: '00000000-0000-4000-8000-000000000004',
  reminders: '00000000-0000-4000-8000-000000000005',
  welcome: '00000000-0000-4000-8000-000000000006',
  duplicateA: '00000000-0000-4000-8000-000000000007',
  duplicateB: '00000000-0000-4000-8000-000000000008',
} as const

const BASE_TIME = 1_700_000_000_000
let seq = 0

function nextId(): ItemId {
  seq += 1
  return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`
}

interface ItemOverrides {
  id?: ItemId
  parentId?: ItemId | null
  kind: ItemKind
  version?: number
  createdAt?: number
  updatedAt?: number
  title?: string | null
  body?: string | null
  isSecret?: boolean
  color?: CollectionColor | null
}

// Build a deterministic LibraryItem with a monotonically increasing creation time.
export function makeItem(overrides: ItemOverrides): LibraryItem {
  const createdAt = overrides.createdAt ?? BASE_TIME + seq
  return {
    id: overrides.id ?? nextId(),
    vaultId: fixtureVaultId,
    parentId: overrides.parentId ?? null,
    kind: overrides.kind,
    version: overrides.version ?? 1,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    title: overrides.title ?? null,
    body: overrides.body ?? null,
    isSecret: overrides.isSecret ?? false,
    color: overrides.color ?? null,
  }
}

export function makeCollection(overrides: Omit<ItemOverrides, 'kind'> & { title: string }): LibraryItem {
  return makeItem({ ...overrides, kind: 'collection', body: null, isSecret: false })
}

export function makeNote(overrides: Omit<ItemOverrides, 'kind'> & { body: string }): LibraryItem {
  return makeItem({ ...overrides, kind: 'note', color: null })
}

// The root collection "API Tokens".
export const fixtureApiTokens: LibraryItem = makeCollection({
  id: fixtureIds.apiTokens,
  title: 'API Tokens',
  color: 'sage',
})

// A secret note holding the placeholder token.
export const fixtureOpenAiSecret: LibraryItem = makeNote({
  id: fixtureIds.openai,
  parentId: fixtureIds.apiTokens,
  title: 'OpenAI',
  body: fixtureSecretBody,
  isSecret: true,
})

// Another secret note sibling, for duplicate-title scenarios.
export const fixtureAnthropicSecret: LibraryItem = makeNote({
  id: fixtureIds.anthropic,
  parentId: fixtureIds.apiTokens,
  title: 'Anthropic',
  body: fixtureSecretBody,
  isSecret: true,
})

// A nested collection under the root.
export const fixturePersonal: LibraryItem = makeCollection({
  id: fixtureIds.personal,
  title: 'Personal',
  color: 'clay',
})

// A nested collection under Personal.
export const fixtureReminders: LibraryItem = makeCollection({
  id: fixtureIds.reminders,
  parentId: fixtureIds.personal,
  title: 'Reminders',
  color: 'ochre',
})

// An ordinary note with multiline Unicode text and no explicit title.
export const fixtureWelcomeNote: LibraryItem = makeNote({
  id: fixtureIds.welcome,
  body: 'First line of the note.\nSecond line with a unicode em dash-free token \u2713 and more.\nThird line.',
})

// Two notes that share the same title; duplicate titles are allowed.
export const fixtureDuplicateNoteA: LibraryItem = makeNote({
  id: fixtureIds.duplicateA,
  title: 'Shared title',
  body: 'Body of the first duplicate.',
})

export const fixtureDuplicateNoteB: LibraryItem = makeNote({
  id: fixtureIds.duplicateB,
  title: 'Shared title',
  body: 'Body of the second duplicate.',
})

// The full fixture library, stable for tests that need a populated snapshot.
export const fixtureLibrary: LibraryItem[] = [
  fixtureApiTokens,
  fixturePersonal,
  fixtureOpenAiSecret,
  fixtureAnthropicSecret,
  fixtureReminders,
  fixtureWelcomeNote,
  fixtureDuplicateNoteA,
  fixtureDuplicateNoteB,
]
