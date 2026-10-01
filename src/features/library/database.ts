import Dexie, { type Table } from 'dexie'
import type { Generation, ItemId, MetaRecord, StoredItem } from './types'
import type { VaultHeader } from '../vault/types'

// The single IndexedDB database Scratch uses. There is exactly one active vault;
// the header and meta rows use fixed keys, and items keep their structural
// metadata unencrypted so the tree can be read without the data key.

export const DEFAULT_DATABASE_NAME = 'scratch-v1'
export const HEADER_KEY = 'header'
export const META_KEY = 'meta'

export interface VaultRow {
  key: string
  header: VaultHeader
}

export interface MetaRow {
  key: string
  revision: number
  generation: Generation
}

export class ScratchDatabase extends Dexie {
  vault!: Table<VaultRow, string>
  items!: Table<StoredItem, ItemId>
  meta!: Table<MetaRow, string>

  constructor(name: string = DEFAULT_DATABASE_NAME) {
    super(name)
    this.version(1).stores({
      vault: 'key',
      items: 'id, parentId, vaultId, kind',
      meta: 'key',
    })
  }
}

let instance: ScratchDatabase | null = null
let instanceName = DEFAULT_DATABASE_NAME

// The repository gets its database through this accessor. It opens lazily on the
// first operation so the app can decide setup versus locked before touching it.
export function getDatabase(): ScratchDatabase {
  if (!instance) instance = new ScratchDatabase(instanceName)
  return instance
}

// Point the repository at a different database. Used only by tests to isolate
// each case in a fresh database.
export function useDatabaseName(name: string): void {
  if (instance) {
    instance.close()
    instance = null
  }
  instanceName = name
}

export function currentDatabaseName(): string {
  return instanceName
}

export async function closeDatabase(): Promise<void> {
  if (instance) {
    instance.close()
    instance = null
  }
}

export async function deleteDatabase(name: string = instanceName): Promise<void> {
  await Dexie.delete(name)
}

export type { MetaRecord }
