import Dexie, { type Table } from 'dexie'
import { currentDatabaseName } from '../library/database'
import type { Generation, VaultId } from '../library/types'
import type { VaultSession } from './types'

// Opt-in "do not ask for the passphrase on this device". The nonextractable data
// key is stored as a CryptoKey object in its own IndexedDB database, beside the
// library database, so the library format and backups are unchanged. The browser
// keeps the key material; it can be used but never read back as bytes. Anyone who
// can open this browser profile can then open the library without the passphrase.
// The row's presence is the setting: absent means the passphrase is asked for.

const DEVICE_KEY = 'device'

export interface DeviceKeyRow {
  key: string
  vaultId: VaultId
  generation: Generation
  dataKey: CryptoKey
}

class DeviceDatabase extends Dexie {
  keys!: Table<DeviceKeyRow, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({ keys: 'key' })
  }
}

let instance: DeviceDatabase | null = null

// Follows the library database name so tests that isolate a library also isolate
// its remembered key.
function database(): DeviceDatabase {
  const name = `${currentDatabaseName()}-device`
  if (!instance || instance.name !== name) {
    instance?.close()
    instance = new DeviceDatabase(name)
  }
  return instance
}

export async function readDeviceKey(): Promise<DeviceKeyRow | null> {
  try {
    return (await database().keys.get(DEVICE_KEY)) ?? null
  } catch {
    return null
  }
}

export async function saveDeviceKey(session: VaultSession): Promise<boolean> {
  try {
    await database().keys.put({
      key: DEVICE_KEY,
      vaultId: session.header.vaultId,
      generation: session.generation,
      dataKey: session.dataKey,
    })
    return true
  } catch {
    return false
  }
}

export async function forgetDeviceKey(): Promise<boolean> {
  try {
    await database().keys.delete(DEVICE_KEY)
    return true
  } catch {
    return false
  }
}

export function deviceKeyMatches(row: DeviceKeyRow, vaultId: VaultId, generation: Generation): boolean {
  return row.vaultId === vaultId && row.generation === generation
}
