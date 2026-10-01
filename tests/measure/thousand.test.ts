import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeBackup } from '../../src/features/backup/backup'
import { buildSearchIndex, searchItems } from '../../src/features/search/search'
import type { LibraryItem } from '../../src/features/library/types'
import { createVault, encryptItem } from '../../src/features/vault/crypto'
import type { VaultSession } from '../../src/features/vault/types'
import { fixturePassphrase } from '../fixtures/library'

// Measurement helper, not a regression test: runs only with MEASURE=1. It builds the
// 1,000-item library of the performance targets (20 collections, 980 short notes,
// every tenth note Secret) with the real vault and the real 600,000-iteration key
// derivation, writes it as an encrypted backup for the browser measurement
// (tests/e2e/measure.spec.ts), and times search index build and queries in Node.
// Everything is synthetic.

const OUT = resolve(process.cwd(), 'measure-output')
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const WORDS = ['river', 'invoice', 'garden', 'recipe', 'meeting', 'router', 'ticket', 'budget', 'pasta', 'flight', 'passport', 'guitar', 'backup', 'staging', 'receipt', 'dentist']

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
}

describe.skipIf(process.env.MEASURE !== '1')('1,000-item library', () => {
  it('writes the backup fixture and times search in Node', async () => {
    const created = await createVault(fixturePassphrase)
    const session: VaultSession = { header: created.header, generation: 1, dataKey: created.dataKey }
    const base = 1_700_000_000_000
    const items: LibraryItem[] = []
    for (let c = 0; c < 20; c++) {
      items.push({ id: uid(c + 1), vaultId: created.header.vaultId, parentId: null, kind: 'collection', version: 1, createdAt: base + c, updatedAt: base + c, title: `Collection ${c + 1} ${WORDS[c % WORDS.length]}`, body: null, isSecret: false, color: (['sage', 'clay', 'ochre', 'slate'] as const)[c % 4] })
    }
    for (let n = 0; n < 980; n++) {
      const parent = uid((n % 20) + 1)
      const secret = n % 10 === 0
      const word = (offset: number) => WORDS[(n + offset) % WORDS.length]
      items.push({
        id: uid(100 + n), vaultId: created.header.vaultId, parentId: parent, kind: 'note', version: 1, createdAt: base + 100 + n, updatedAt: base + 100 + n,
        title: secret ? `Key ${n} ${word(0)}` : null,
        body: secret ? `synthetic-secret-${n}-NOT-A-REAL-KEY` : `Note ${n}: ${word(0)} and ${word(3)} with ${word(5)}.\nSecond line about ${word(7)} ${n}, a little longer so the preview has something to clamp.`,
        isSecret: secret, color: null,
      })
    }
    expect(items).toHaveLength(1000)
    const stored = []
    for (const item of items) stored.push(await encryptItem(session, item))
    const written = await writeBackup(session, stored)
    if (!written.ok) throw new Error(written.message)
    mkdirSync(OUT, { recursive: true })
    writeFileSync(resolve(OUT, 'thousand.scratch'), Buffer.from(await written.blob.arrayBuffer()))

    const builds: number[] = []
    let index = buildSearchIndex(items)
    for (let run = 0; run < 15; run++) {
      const start = performance.now()
      index = buildSearchIndex(items)
      builds.push(performance.now() - start)
    }
    const queries: Record<string, number> = {}
    for (const query of ['river', 'a', 'second line about router 9', 'zzzz no match', 'Key 4']) {
      const times: number[] = []
      let hits = 0
      for (let run = 0; run < 30; run++) {
        const start = performance.now()
        hits = searchItems(index, query).length
        times.push(performance.now() - start)
      }
      queries[`${query} (${hits} hits)`] = Math.round(median(times) * 100) / 100
    }
    writeFileSync(resolve(OUT, 'node-search.json'), JSON.stringify({ items: items.length, indexBuildMsMedian: Math.round(median(builds) * 100) / 100, indexBuildMsMax: Math.round(Math.max(...builds) * 100) / 100, queryMsMedian: queries }, null, 2))
  }, 120000)
})
