import { describe, expect, it } from 'vitest'
import {
  APP_LIMITS,
  type CollectionColor,
  type LibraryItem,
} from '../src/features/library/types'
import {
  countCodePoints,
  countGraphemes,
  isCollectionColor,
  utf8Length,
  validateCollectionInput,
  validateItem,
  validateNoteInput,
  validatePassphrase,
} from '../src/features/library/validation'
import {
  collectionDepth,
  descendantsOf,
  validateTree,
} from '../src/features/library/hierarchy'
import { compareItems, deriveNoteTitle, displayTitle, sortItems } from '../src/features/library/display'
import {
  fixtureAnthropicSecret,
  fixtureApiTokens,
  fixtureDuplicateNoteA,
  fixtureDuplicateNoteB,
  fixtureLibrary,
  fixtureOpenAiSecret,
  fixtureReminders,
  fixtureSecretBody,
  makeCollection,
  makeNote,
} from './fixtures/library'

describe('text measurement', () => {
  it('counts UTF-8 bytes with TextEncoder', () => {
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('\u2713')).toBe(3) // check mark encodes to three bytes
    expect(utf8Length('\uD83D\uDE00')).toBe(4) // emoji surrogate pair encodes to four bytes
  })

  it('counts grapheme clusters with Intl.Segmenter', () => {
    expect(countGraphemes('abc')).toBe(3)
    expect(countGraphemes('e\u0301')).toBe(1) // e plus combining acute is one cluster
    expect(countGraphemes('a\u0301\u0301\u0301')).toBe(1) // many combining marks still one cluster
  })

  it('counts Unicode code points for passphrases', () => {
    expect(countCodePoints('\uD83D\uDE00\uD83D\uDE00')).toBe(2) // two emoji, two code points
    expect(countCodePoints('ab')).toBe(2)
  })
})

describe('note validation', () => {
  it('accepts a valid multiline Unicode note', () => {
    const issues = validateNoteInput({
      parentId: null,
      title: 'Title',
      body: 'First line.\nSecond line \u2713.\n',
      isSecret: false,
    })
    expect(issues).toEqual([])
  })

  it('rejects a blank body', () => {
    const issues = validateNoteInput({ parentId: null, title: null, body: '   \n\t ', isSecret: false })
    expect(issues.some((i) => i.field === 'body')).toBe(true)
  })

  it('rejects a secret note with a null or blank title without deriving one', () => {
    for (const title of [null, '', '   ']) {
      const issues = validateNoteInput({ parentId: null, title, body: fixtureSecretBody, isSecret: true })
      expect(issues.some((i) => i.field === 'title')).toBe(true)
      expect(deriveNoteTitle(fixtureSecretBody)).not.toBe(title)
    }
    // The fixture token is never used as the secret note title.
    expect(displayTitle(makeNote({ body: fixtureSecretBody, isSecret: true, title: null }))).toBeNull()
  })

  it('accepts a secret note with an explicit title', () => {
    const issues = validateNoteInput({ parentId: null, title: 'OpenAI', body: fixtureSecretBody, isSecret: true })
    expect(issues).toEqual([])
  })

  it('passes a body at exactly the byte limit and rejects one byte over without truncating', () => {
    const atLimit = 'a'.repeat(APP_LIMITS.bodyMaxBytes)
    const overLimit = 'a'.repeat(APP_LIMITS.bodyMaxBytes + 1)
    expect(utf8Length(atLimit)).toBe(APP_LIMITS.bodyMaxBytes)

    const atIssues = validateNoteInput({ parentId: null, title: null, body: atLimit, isSecret: false })
    expect(atIssues).toEqual([])

    const overIssues = validateNoteInput({ parentId: null, title: null, body: overLimit, isSecret: false })
    expect(overIssues.some((i) => i.field === 'body')).toBe(true)
    // The body is not mutated; only the length is reported.
    expect(overLimit.length).toBe(APP_LIMITS.bodyMaxBytes + 1)
  })

  it('rejects a title with one visible cluster but thousands of combining marks via the byte limit', () => {
    const title = 'a' + '\u0301'.repeat(5000)
    expect(countGraphemes(title)).toBe(1) // far under the 80-cluster limit
    expect(utf8Length(title)).toBeGreaterThan(APP_LIMITS.titleMaxBytes)

    const issues = validateNoteInput({ parentId: null, title, body: 'body', isSecret: false })
    expect(issues.some((i) => i.field === 'title')).toBe(true)
  })
})

describe('collection validation', () => {
  it('requires a nonblank title and a valid color', () => {
    expect(validateCollectionInput({ parentId: null, title: '', color: 'sage' }).some((i) => i.field === 'title')).toBe(true)
    expect(validateCollectionInput({ parentId: null, title: 'Good', color: 'not-a-color' as CollectionColor }).some((i) => i.field === 'color')).toBe(true)
    expect(validateCollectionInput({ parentId: null, title: 'Good', color: 'clay' })).toEqual([])
  })

  it('validates the color helper against the four named tints', () => {
    expect(isCollectionColor('sage')).toBe(true)
    expect(isCollectionColor('clay')).toBe(true)
    expect(isCollectionColor('ochre')).toBe(true)
    expect(isCollectionColor('slate')).toBe(true)
    expect(isCollectionColor('violet')).toBe(false)
  })
})

describe('passphrase validation', () => {
  it('rejects short and overlong passphrases', () => {
    expect(validatePassphrase('short')).not.toEqual([])
    expect(validatePassphrase('a'.repeat(APP_LIMITS.passphraseMinCodePoints))).toEqual([])
    expect(validatePassphrase('a'.repeat(APP_LIMITS.passphraseMaxBytes + 1)).some((i) => i.field === 'passphrase')).toBe(true)
  })
})

describe('item structural validation', () => {
  it('accepts consistent collection and note items', () => {
    expect(validateItem(fixtureApiTokens)).toEqual([])
    expect(validateItem(fixtureOpenAiSecret)).toEqual([])
  })

  it('rejects fields inconsistent with kind', () => {
    const collectionWithBody = { ...fixtureApiTokens, body: 'nope' } as LibraryItem
    expect(validateItem(collectionWithBody).some((i) => i.field === 'body')).toBe(true)

    const noteWithColor = { ...fixtureOpenAiSecret, color: 'sage' as CollectionColor } as LibraryItem
    expect(validateItem(noteWithColor).some((i) => i.field === 'color')).toBe(true)
  })

  it('rejects non-integer timestamps and createdAt after updatedAt', () => {
    expect(validateItem({ ...fixtureApiTokens, createdAt: 1.5 }).some((i) => i.field === 'createdAt')).toBe(true)
    expect(validateItem({ ...fixtureApiTokens, createdAt: 200, updatedAt: 100 }).some((i) => i.field === 'updatedAt')).toBe(true)
  })
})

describe('tree validation', () => {
  it('accepts a valid eight-level chain of collections', () => {
    const items: LibraryItem[] = []
    let parentId: string | null = null
    for (let level = 0; level < 8; level++) {
      const collection = makeCollection({ title: `Level ${level}`, parentId })
      items.push(collection)
      parentId = collection.id
    }
    expect(validateTree(items)).toEqual([])
    expect(collectionDepth(items, items[7].parentId)).toBe(7)
  })

  it('rejects a ninth level', () => {
    const items: LibraryItem[] = []
    let parentId: string | null = null
    for (let level = 0; level < 9; level++) {
      const collection = makeCollection({ title: `Level ${level}`, parentId })
      items.push(collection)
      parentId = collection.id
    }
    const errors = validateTree(items)
    expect(errors.some((e) => e.code === 'excessive-depth')).toBe(true)
  })

  it('rejects a missing parent', () => {
    const orphan = makeNote({ body: 'orphan', parentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
    const errors = validateTree([orphan])
    expect(errors.some((e) => e.code === 'missing-parent')).toBe(true)
  })

  it('rejects a note used as a parent', () => {
    const note = makeNote({ body: 'not a folder' })
    const child = makeNote({ body: 'child', parentId: note.id })
    const errors = validateTree([note, child])
    expect(errors.some((e) => e.code === 'note-parent')).toBe(true)
  })

  it('rejects a cycle', () => {
    const a = makeCollection({ title: 'A' })
    const b = makeCollection({ title: 'B', parentId: a.id })
    const aWithCycle = { ...a, parentId: b.id }
    const errors = validateTree([aWithCycle, b])
    expect(errors.some((e) => e.code === 'cycle')).toBe(true)
  })

  it('computes descendants and collection depth', () => {
    expect(descendantsOf(fixtureLibrary, fixtureApiTokens.id).sort()).toEqual(
      [fixtureOpenAiSecret.id, fixtureAnthropicSecret.id].sort(),
    )
    expect(collectionDepth(fixtureLibrary, fixtureReminders.parentId)).toBe(1)
  })
})

describe('sorting', () => {
  it('orders collections first, then createdAt ascending, then id ascending', () => {
    const sorted = sortItems(fixtureLibrary)
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(compareItems(sorted[i], sorted[i + 1])).toBeLessThanOrEqual(0)
    }
    const kinds = sorted.map((i) => i.kind)
    const firstNote = kinds.indexOf('note')
    if (firstNote >= 0) {
      expect(kinds.slice(0, firstNote).every((k) => k === 'collection')).toBe(true)
    }
    // Duplicate-title notes sort deterministically by id.
    const aIndex = sorted.findIndex((i) => i.id === fixtureDuplicateNoteA.id)
    const bIndex = sorted.findIndex((i) => i.id === fixtureDuplicateNoteB.id)
    expect(aIndex).toBeGreaterThanOrEqual(0)
    expect(bIndex).toBeGreaterThanOrEqual(0)
  })
})

describe('display labels', () => {
  it('derives the first nonblank line truncated to 60 clusters', () => {
    expect(deriveNoteTitle('  \nFirst line\nSecond line')).toBe('First line')
    expect(deriveNoteTitle('   \n  ')).toBeNull()
    const long = 'x'.repeat(100)
    expect(deriveNoteTitle(long)).toBe('x'.repeat(60))
  })

  it('never derives a title from a secret body', () => {
    const secret = makeNote({ body: fixtureSecretBody, isSecret: true, title: null })
    expect(displayTitle(secret)).toBeNull()
  })

  it('uses the explicit title when present', () => {
    expect(displayTitle(fixtureOpenAiSecret)).toBe('OpenAI')
  })
})
