import { describe, expect, it } from 'vitest'
import { buildSearchIndex, normalizeForSearch, searchItems } from '../src/features/search/search'
import { fixtureIds, fixtureLibrary, fixtureSecretBody, makeCollection, makeNote } from './fixtures/library'

const ids = (index: ReturnType<typeof buildSearchIndex>, query: string) => searchItems(index, query).map((hit) => hit.id)

describe('search index', () => {
  it('finds ordinary note bodies and collection titles regardless of case, with their parent path', () => {
    const index = buildSearchIndex(fixtureLibrary)
    const hits = searchItems(index, 'SECOND LINE WITH')
    expect(hits.map((hit) => hit.id)).toEqual([fixtureIds.welcome])
    expect(hits[0].parentPath).toEqual([])
    expect(searchItems(index, 'reminders')).toEqual([
      expect.objectContaining({ id: fixtureIds.reminders, kind: 'collection', parentPath: ['Personal'] }),
    ])
    const nested = buildSearchIndex([...fixtureLibrary, makeNote({ parentId: fixtureIds.reminders, title: 'Nested', body: 'deep body' })])
    expect(searchItems(nested, 'deep body')[0].parentPath).toEqual(['Personal', 'Reminders'])
  })

  it('treats composed and decomposed forms as equal without changing stored text', () => {
    const composed = 'café menu'
    const decomposed = 'café menu'
    const note = makeNote({ title: 'Cafe', body: composed })
    const index = buildSearchIndex([note])
    expect(ids(index, decomposed)).toEqual([note.id])
    const other = makeNote({ title: 'Cafe', body: decomposed })
    expect(ids(buildSearchIndex([other]), composed)).toEqual([other.id])
    expect(note.body).toBe(composed)
    expect(other.body).toBe(decomposed)
    expect(normalizeForSearch('É')).toBe('é')
  })

  it('never indexes secret bodies, even for the fixture token, but still finds secret titles', () => {
    const index = buildSearchIndex(fixtureLibrary)
    expect(ids(index, fixtureSecretBody)).toEqual([])
    expect(ids(index, 'fixture-secret')).toEqual([])
    expect(ids(index, 'openai')).toEqual([fixtureIds.openai])
    expect(JSON.stringify(index)).not.toContain(fixtureSecretBody)
    const untitled = makeNote({ title: null, body: 'hidden-untitled-token', isSecret: true })
    expect(ids(buildSearchIndex([untitled]), 'hidden-untitled')).toEqual([])
  })

  it('drops the former body match as soon as an ordinary note is rebuilt as secret', () => {
    const ordinary = makeNote({ title: 'Wifi', body: 'router-password-xyz' })
    expect(ids(buildSearchIndex([ordinary]), 'router-password')).toEqual([ordinary.id])
    const converted = { ...ordinary, version: 2, isSecret: true }
    const after = buildSearchIndex([converted])
    expect(ids(after, 'router-password')).toEqual([])
    expect(ids(after, 'wifi')).toEqual([ordinary.id])
  })

  it('requires every word, ignores surrounding space, and returns nothing for an empty query', () => {
    const note = makeNote({ title: 'Plan', body: 'buy milk\nand eggs' })
    const index = buildSearchIndex([note, makeCollection({ title: 'Milk run', color: 'sage' })])
    expect(ids(index, '  milk   eggs ')).toEqual([note.id])
    expect(ids(index, 'milk bread')).toEqual([])
    expect(ids(index, '   ')).toEqual([])
    expect(ids(index, '')).toEqual([])
  })
})
