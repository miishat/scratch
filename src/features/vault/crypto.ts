import type { Generation, ItemId, ItemKind, LibraryItem, StoredItem, VaultId } from '../library/types'
import { validateItem, validatePassphrase } from '../library/validation'
import type {
  CipherEnvelope,
  CreatedVault,
  SealPurpose,
  UnlockResult,
  VaultHeader,
  VaultSession,
} from './types'

// Authenticated encryption primitives for the Scratch vault. The data key is a
// nonextractable AES-GCM-256 key held only in memory. Key material is wrapped
// with AES-GCM under a PBKDF2-SHA-256 wrapping key, using a documented canonical
// associated-data array. Raw key bytes are released promptly after use.

const FORMAT_VERSION = 1
const PBKDF2_ITERATIONS = 600000
const PBKDF2_HASH = 'SHA-256'
const SALT_BYTES = 16
const DATA_KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BITS = 128

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Byte values passed to Web Crypto are always backed by an ArrayBuffer.
type Bytes = Uint8Array<ArrayBuffer>

// --- base64 / UTF-8 helpers -------------------------------------------------

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

function isBase64(text: string): boolean {
  return BASE64_RE.test(text) && text.length % 4 === 0
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(text: string): Bytes {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function tryDecodeBase64(text: string): Bytes | null {
  if (typeof text !== 'string' || !isBase64(text)) return null
  try {
    return base64ToBytes(text)
  } catch {
    return null
  }
}

function utf8Encode(text: string): Bytes {
  return encoder.encode(text)
}

function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

// --- canonical associated data ---------------------------------------------

// Item AAD authenticates the format, vault, and every structural field.
function itemAad(item: {
  vaultId: VaultId
  id: ItemId
  parentId: ItemId | null
  kind: ItemKind
  version: number
  createdAt: number
  updatedAt: number
}): Bytes {
  return utf8Encode(
    JSON.stringify([
      'scratch-item',
      1,
      item.vaultId,
      item.id,
      item.parentId,
      item.kind,
      item.version,
      item.createdAt,
      item.updatedAt,
    ]),
  )
}

// Wrap AAD authenticates the KDF parameters with the wrapped key.
function wrapAad(vaultId: VaultId, saltBase64: string, iterations: number): Bytes {
  return utf8Encode(JSON.stringify(['scratch-wrap', 1, vaultId, saltBase64, iterations]))
}

// Envelope AAD authenticates the vault and the purpose (backup or draft).
function envelopeAad(vaultId: VaultId, purpose: SealPurpose): Bytes {
  return utf8Encode(JSON.stringify(['scratch-envelope', 1, vaultId, purpose]))
}

// --- key operations ---------------------------------------------------------

async function deriveWrappingKey(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', utf8Encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function importDataKey(bytes: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function wrapDataKeyBytes(rawKey: Bytes, wrappingKey: CryptoKey, aad: Bytes): Promise<CipherEnvelope> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: TAG_BITS },
    wrappingKey,
    rawKey,
  )
  return { nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

async function unwrapDataKeyBytes(header: VaultHeader, wrappingKey: CryptoKey): Promise<Bytes> {
  const nonce = base64ToBytes(header.wrappedDataKey.nonce)
  const ciphertext = base64ToBytes(header.wrappedDataKey.ciphertext)
  const aad = wrapAad(header.vaultId, header.salt, header.iterations)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: TAG_BITS },
    wrappingKey,
    ciphertext,
  )
  return new Uint8Array(plaintext)
}

function assertValidPassphrase(passphrase: string): void {
  const issues = validatePassphrase(passphrase)
  if (issues.length > 0) throw new Error(issues[0].message)
}

// --- vault lifecycle ----------------------------------------------------------

export async function createVault(passphrase: string): Promise<CreatedVault> {
  assertValidPassphrase(passphrase)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const dataKeyBytes = crypto.getRandomValues(new Uint8Array(DATA_KEY_BYTES))
  const vaultId = crypto.randomUUID()
  try {
    const saltBase64 = bytesToBase64(salt)
    const wrappingKey = await deriveWrappingKey(passphrase, salt, PBKDF2_ITERATIONS)
    const wrappedDataKey = await wrapDataKeyBytes(
      dataKeyBytes,
      wrappingKey,
      wrapAad(vaultId, saltBase64, PBKDF2_ITERATIONS),
    )
    const header: VaultHeader = {
      formatVersion: FORMAT_VERSION,
      vaultId,
      salt: saltBase64,
      iterations: PBKDF2_ITERATIONS,
      wrappedDataKey,
    }
    const dataKey = await importDataKey(dataKeyBytes)
    return { header, dataKey }
  } finally {
    dataKeyBytes.fill(0)
  }
}

export async function unlockVault(
  header: VaultHeader,
  passphrase: string,
  generation: Generation,
): Promise<UnlockResult> {
  if (header.formatVersion !== FORMAT_VERSION) {
    return { ok: false, code: 'unsupported-format', message: 'This vault uses an unsupported format.' }
  }
  if (header.iterations !== PBKDF2_ITERATIONS) {
    return { ok: false, code: 'unsupported-iterations', message: 'This vault uses unsupported key derivation.' }
  }

  const salt = tryDecodeBase64(header.salt)
  if (!salt || salt.length !== SALT_BYTES) {
    return { ok: false, code: 'malformed-header', message: 'The vault header is malformed.' }
  }
  const nonce = tryDecodeBase64(header.wrappedDataKey.nonce)
  if (!nonce || nonce.length !== NONCE_BYTES) {
    return { ok: false, code: 'malformed-header', message: 'The vault header is malformed.' }
  }
  const wrapped = tryDecodeBase64(header.wrappedDataKey.ciphertext)
  if (!wrapped || wrapped.length < DATA_KEY_BYTES + TAG_BITS / 8) {
    return { ok: false, code: 'malformed-header', message: 'The vault header is malformed.' }
  }

  let dataKeyBytes: Bytes | null = null
  try {
    const wrappingKey = await deriveWrappingKey(passphrase, salt, PBKDF2_ITERATIONS)
    dataKeyBytes = await unwrapDataKeyBytes(header, wrappingKey)
    const dataKey = await importDataKey(dataKeyBytes)
    return { ok: true, session: { header, generation, dataKey } }
  } catch {
    return { ok: false, code: 'wrong-passphrase', message: 'Could not unlock this vault. Check the passphrase.' }
  } finally {
    if (dataKeyBytes) dataKeyBytes.fill(0)
  }
}

// --- item payload encryption -------------------------------------------------

type ItemPayload =
  | { title: string | null; body: string; isSecret: boolean }
  | { title: string | null; color: string | null }

function itemPayloadBytes(item: LibraryItem): Bytes {
  const payload: ItemPayload =
    item.kind === 'collection'
      ? { title: item.title, color: item.color }
      : { title: item.title, body: item.body ?? '', isSecret: item.isSecret }
  return utf8Encode(JSON.stringify(payload))
}

function isCollectionColorValue(value: unknown): boolean {
  return value === 'sage' || value === 'clay' || value === 'ochre' || value === 'slate'
}

function parseItemPayload(stored: StoredItem, bytes: Uint8Array): LibraryItem | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(utf8Decode(bytes))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>

  const base = {
    id: stored.id,
    vaultId: stored.vaultId,
    parentId: stored.parentId,
    version: stored.version,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }

  if (stored.kind === 'collection') {
    return {
      ...base,
      kind: 'collection',
      title: typeof obj.title === 'string' ? obj.title : null,
      body: null,
      isSecret: false,
      color: isCollectionColorValue(obj.color) ? (obj.color as LibraryItem['color']) : null,
    }
  }

  return {
    ...base,
    kind: 'note',
    title: typeof obj.title === 'string' ? obj.title : null,
    body: typeof obj.body === 'string' ? obj.body : null,
    isSecret: obj.isSecret === true,
    color: null,
  }
}

export async function encryptItem(session: VaultSession, item: LibraryItem): Promise<StoredItem> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: itemAad(item), tagLength: TAG_BITS },
    session.dataKey,
    itemPayloadBytes(item),
  )
  return {
    id: item.id,
    vaultId: item.vaultId,
    parentId: item.parentId,
    kind: item.kind,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    payload: { nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) },
  }
}

export type DecryptItemResult =
  | { ok: true; item: LibraryItem }
  | { ok: false; code: 'corrupt'; message: string }

export async function decryptItem(session: VaultSession, stored: StoredItem): Promise<DecryptItemResult> {
  const nonce = tryDecodeBase64(stored.payload.nonce)
  if (!nonce || nonce.length !== NONCE_BYTES) return corruptItem()
  const ciphertext = tryDecodeBase64(stored.payload.ciphertext)
  if (!ciphertext) return corruptItem()

  let plaintext: Uint8Array
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: itemAad(stored), tagLength: TAG_BITS },
        session.dataKey,
        ciphertext,
      ),
    )
  } catch {
    return corruptItem()
  }

  const item = parseItemPayload(stored, plaintext)
  if (!item) return corruptItem()
  if (validateItem(item).length > 0) return corruptItem()
  return { ok: true, item }
}

function corruptItem(): { ok: false; code: 'corrupt'; message: string } {
  return { ok: false, code: 'corrupt', message: 'This item is corrupted.' }
}

// --- purpose-bound envelopes ---------------------------------------------------

export async function sealEnvelope(
  session: VaultSession,
  purpose: SealPurpose,
  plaintext: Uint8Array,
): Promise<CipherEnvelope> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: envelopeAad(session.header.vaultId, purpose), tagLength: TAG_BITS },
    session.dataKey,
    plaintext as BufferSource,
  )
  return { nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

export type OpenEnvelopeResult =
  | { ok: true; plaintext: Uint8Array }
  | { ok: false; code: 'corrupt'; message: string }

export async function openEnvelope(
  session: VaultSession,
  purpose: SealPurpose,
  envelope: CipherEnvelope,
): Promise<OpenEnvelopeResult> {
  const nonce = tryDecodeBase64(envelope.nonce)
  if (!nonce || nonce.length !== NONCE_BYTES) return corruptEnvelope()
  const ciphertext = tryDecodeBase64(envelope.ciphertext)
  if (!ciphertext) return corruptEnvelope()

  try {
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: envelopeAad(session.header.vaultId, purpose), tagLength: TAG_BITS },
        session.dataKey,
        ciphertext,
      ),
    )
    return { ok: true, plaintext }
  } catch {
    return corruptEnvelope()
  }
}

function corruptEnvelope(): { ok: false; code: 'corrupt'; message: string } {
  return { ok: false, code: 'corrupt', message: 'This envelope is corrupted.' }
}

// --- rewrap --------------------------------------------------------------------

// Validates the current passphrase by unwrapping the old wrapper to raw key
// bytes, then rewraps those bytes under the new passphrase. The nonextractable
// data key is never exported.
export async function rewrapVault(
  session: VaultSession,
  currentPassphrase: string,
  newPassphrase: string,
): Promise<VaultHeader> {
  assertValidPassphrase(newPassphrase)
  const header = session.header

  const salt = tryDecodeBase64(header.salt)
  if (!salt || salt.length !== SALT_BYTES) throw new Error('The vault header is malformed.')

  const oldWrappingKey = await deriveWrappingKey(currentPassphrase, salt, header.iterations)
  const dataKeyBytes = await unwrapDataKeyBytes(header, oldWrappingKey)
  try {
    const newSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    const newWrappingKey = await deriveWrappingKey(newPassphrase, newSalt, PBKDF2_ITERATIONS)
    const newSaltBase64 = bytesToBase64(newSalt)
    const wrappedDataKey = await wrapDataKeyBytes(
      dataKeyBytes,
      newWrappingKey,
      wrapAad(header.vaultId, newSaltBase64, PBKDF2_ITERATIONS),
    )
    return {
      formatVersion: FORMAT_VERSION,
      vaultId: header.vaultId,
      salt: newSaltBase64,
      iterations: PBKDF2_ITERATIONS,
      wrappedDataKey,
    }
  } finally {
    dataKeyBytes.fill(0)
  }
}
