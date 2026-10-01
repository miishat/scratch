import { beforeAll, describe, expect, it } from 'vitest'
import {
  createVault,
  decryptItem,
  encryptItem,
  openEnvelope,
  rewrapVault,
  sealEnvelope,
  unlockVault,
} from '../src/features/vault/crypto'
import type { CreatedVault, VaultHeader, VaultSession } from '../src/features/vault/types'
import type { StoredItem } from '../src/features/library/types'
import { fixturePassphrase, makeCollection, makeNote } from './fixtures/library'

const PASSPHRASE = fixturePassphrase
const OTHER_PASSPHRASE = 'a completely different passphrase'
const NEW_PASSPHRASE = 'brand new passphrase!'

function sessionFrom(vault: CreatedVault): VaultSession {
  return { header: vault.header, generation: 1, dataKey: vault.dataKey }
}

describe('vault crypto', () => {
  let vault: CreatedVault

  beforeAll(async () => {
    vault = await createVault(PASSPHRASE)
  }, 30000)

  it('round-trips a multiline Unicode note exactly', async () => {
    const session = sessionFrom(vault)
    const item = makeNote({ title: 'A \u2713 note', body: 'First line.\nSecond line \u2713.\n', isSecret: false })
    const stored = await encryptItem(session, item)
    const result = await decryptItem(session, stored)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('decrypt failed')
    expect(result.item.title).toBe(item.title)
    expect(result.item.body).toBe(item.body)
    expect(result.item.isSecret).toBe(item.isSecret)
  })

  it('randomizes nonce and ciphertext for the same item and both decrypt', async () => {
    const session = sessionFrom(vault)
    const item = makeNote({ title: 'Same', body: 'same body', isSecret: false })
    const first = await encryptItem(session, item)
    const second = await encryptItem(session, item)
    expect(first.payload.nonce).not.toBe(second.payload.nonce)
    expect(first.payload.ciphertext).not.toBe(second.payload.ciphertext)
    expect((await decryptItem(session, first)).ok).toBe(true)
    expect((await decryptItem(session, second)).ok).toBe(true)
  })

  it('fails to unlock with the wrong passphrase and creates no vault', async () => {
    const result = await unlockVault(vault.header, OTHER_PASSPHRASE, 1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected success')
    expect(result.code).toBe('wrong-passphrase')
    // A wrong passphrase produces no session and no new empty vault.
    expect('session' in result).toBe(false)
  })

  // A header whose wrapped key has the right passphrase and AAD but the wrong length.
  // The pre-check on the ciphertext length already refuses short keys; this pins that
  // no weaker AES key (16 or 24 bytes) or odd length can ever be installed.
  async function headerWrapping(keyLength: number): Promise<VaultHeader> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const saltBase64 = btoa(String.fromCharCode(...salt))
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASSPHRASE), 'PBKDF2', false, ['deriveKey'])
    const wrappingKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    const vaultId = crypto.randomUUID()
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const aad = new TextEncoder().encode(JSON.stringify(['scratch-wrap', 1, vaultId, saltBase64, 600000]))
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, wrappingKey, crypto.getRandomValues(new Uint8Array(keyLength))))
    const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    return { formatVersion: 1, vaultId, salt: saltBase64, iterations: 600000, wrappedDataKey: { nonce: encode(nonce), ciphertext: encode(sealed) } }
  }

  it('never installs a data key that is not exactly 32 bytes', async () => {
    for (const length of [16, 24, 40]) {
      const result = await unlockVault(await headerWrapping(length), PASSPHRASE, 1)
      expect(result.ok, `${length} byte key`).toBe(false)
      expect('session' in result).toBe(false)
    }
    const good = await unlockVault(await headerWrapping(32), PASSPHRASE, 1)
    expect(good.ok).toBe(true)
  })

  it('fails authentication when a ciphertext bit is flipped', async () => {
    const session = sessionFrom(vault)
    const item = makeNote({ title: 'T', body: 'tamper me', isSecret: false })
    const stored = await encryptItem(session, item)
    const result = await decryptItem(session, flipCiphertextBit(stored))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected success')
    expect(result.code).toBe('corrupt')
  })

  it('fails authentication when structural metadata changes', async () => {
    const session = sessionFrom(vault)
    const item = makeNote({ title: 'T', body: 'meta tamper', isSecret: false })
    const stored = await encryptItem(session, item)

    const mutations: StoredItem[] = [
      { ...stored, parentId: makeCollection({ title: 'X' }).id },
      { ...stored, kind: 'collection' },
      { ...stored, version: stored.version + 1 },
    ]
    for (const mutated of mutations) {
      const result = await decryptItem(session, mutated)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unexpected success')
      expect(result.code).toBe('corrupt')
    }
  })

  it('rejects opening a backup envelope as a draft', async () => {
    const session = sessionFrom(vault)
    const envelope = await sealEnvelope(session, 'backup', new TextEncoder().encode('secret payload'))
    const result = await openEnvelope(session, 'draft', envelope)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected success')
    expect(result.code).toBe('corrupt')
  })

  it('round-trips a purpose-bound envelope', async () => {
    const session = sessionFrom(vault)
    const plaintext = new TextEncoder().encode('draft payload')
    const envelope = await sealEnvelope(session, 'draft', plaintext)
    const result = await openEnvelope(session, 'draft', envelope)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('open failed')
    expect([...result.plaintext]).toEqual([...plaintext])
  })

  it('rejects unsupported iteration counts before derivation', async () => {
    for (const iterations of [999_999_999, 12_345, 2 ** 32]) {
      const header = { ...vault.header, iterations } as VaultHeader
      const result = await unlockVault(header, PASSPHRASE, 1)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unexpected success')
      expect(result.code).toBe('unsupported-iterations')
    }
  })

  it('rejects an unknown format version', async () => {
    const header = { ...vault.header, formatVersion: 2 } as unknown as VaultHeader
    const result = await unlockVault(header, PASSPHRASE, 1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected success')
    expect(result.code).toBe('unsupported-format')
  })
})

describe('rewrap', () => {
  it('changes the passphrase and keeps existing records decryptable', async () => {
    const created = await createVault(PASSPHRASE)
    const session = sessionFrom(created)
    const item = makeNote({ title: 'Persists', body: 'survive rewrap', isSecret: false })
    const stored = await encryptItem(session, item)

    const newHeader = await rewrapVault(session, PASSPHRASE, NEW_PASSPHRASE)

    const newUnlock = await unlockVault(newHeader, NEW_PASSPHRASE, 1)
    expect(newUnlock.ok).toBe(true)
    if (!newUnlock.ok) throw new Error('unlock failed')
    const decrypted = await decryptItem(newUnlock.session, stored)
    expect(decrypted.ok).toBe(true)
    if (!decrypted.ok) throw new Error('decrypt failed')
    expect(decrypted.item.body).toBe('survive rewrap')

    // The old wrapper remains valid only under the old passphrase.
    const oldUnlock = await unlockVault(created.header, PASSPHRASE, 1)
    expect(oldUnlock.ok).toBe(true)
    const wrongNew = await unlockVault(created.header, NEW_PASSPHRASE, 1)
    expect(wrongNew.ok).toBe(false)
  }, 30000)
})

function flipCiphertextBit(stored: StoredItem): StoredItem {
  const bytes = base64ToBytes(stored.payload.ciphertext)
  bytes[0] ^= 0x01
  return { ...stored, payload: { ...stored.payload, ciphertext: bytesToBase64(bytes) } }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
