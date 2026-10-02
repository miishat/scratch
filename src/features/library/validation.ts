import type { CollectionColor, CollectionInput, ItemId, ItemKind, LibraryItem, NoteInput } from './types'
import { APP_LIMITS } from './types'

// Validation helpers for the Scratch model. Limits count Unicode correctly:
// bytes with TextEncoder, grapheme clusters with Intl.Segmenter, and code points
// by iterating the string. Validation never mutates stored text; it only reports.

export interface ValidationIssue {
  field: string
  message: string
}

// Created on first use, not at import: a browser without Intl.Segmenter must still load
// the app far enough to show the unsupported-browser screen.
let graphemeSegmenter: Intl.Segmenter | undefined

export function countGraphemes(text: string): number {
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(graphemeSegmenter.segment(text)).length
}

export function countCodePoints(text: string): number {
  return Array.from(text).length
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

export function isBlank(text: string | null | undefined): boolean {
  return text == null || text.trim() === ''
}

export function isCollectionColor(value: unknown): value is CollectionColor {
  return value === 'sage' || value === 'clay' || value === 'ochre' || value === 'slate' || value === 'rose' || value === 'lilac' || value === 'sky' || value === 'stone'
}

export function isItemKind(value: unknown): value is ItemKind {
  return value === 'collection' || value === 'note'
}

function isValidId(value: unknown): value is ItemId {
  return typeof value === 'string' && value.length > 0
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

export function validateTitle(title: string | null): ValidationIssue[] {
  if (title === null) return []
  const issues: ValidationIssue[] = []
  if (countGraphemes(title) > APP_LIMITS.titleMaxGraphemes) {
    issues.push({ field: 'title', message: `A title must be ${APP_LIMITS.titleMaxGraphemes} characters or fewer.` })
  }
  if (utf8Length(title) > APP_LIMITS.titleMaxBytes) {
    issues.push({ field: 'title', message: `A title must be ${APP_LIMITS.titleMaxBytes} bytes or fewer in UTF-8.` })
  }
  return issues
}

export function validateBody(body: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (isBlank(body)) {
    issues.push({ field: 'body', message: 'A note body cannot be empty.' })
  }
  if (utf8Length(body) > APP_LIMITS.bodyMaxBytes) {
    issues.push({ field: 'body', message: `A note body must be ${APP_LIMITS.bodyMaxBytes} bytes or fewer in UTF-8.` })
  }
  return issues
}

export function validatePassphrase(passphrase: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (countCodePoints(passphrase) < APP_LIMITS.passphraseMinCodePoints) {
    issues.push({ field: 'passphrase', message: `A passphrase must be at least ${APP_LIMITS.passphraseMinCodePoints} characters.` })
  }
  if (utf8Length(passphrase) > APP_LIMITS.passphraseMaxBytes) {
    issues.push({ field: 'passphrase', message: `A passphrase must be ${APP_LIMITS.passphraseMaxBytes} bytes or fewer in UTF-8.` })
  }
  return issues
}

export function validateNoteInput(input: NoteInput): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  issues.push(...validateBody(input.body))
  issues.push(...validateTitle(input.title))
  if (input.isSecret && isBlank(input.title)) {
    issues.push({ field: 'title', message: 'A secret note requires a title.' })
  }
  return issues
}

export function validateCollectionInput(input: CollectionInput): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (isBlank(input.title)) {
    issues.push({ field: 'title', message: 'A collection requires a title.' })
  }
  issues.push(...validateTitle(input.title))
  if (!isCollectionColor(input.color)) {
    issues.push({ field: 'color', message: 'Choose a valid collection color.' })
  }
  return issues
}

// Validate a fully decrypted item, including structural fields and the payload.
export function validateItem(item: LibraryItem): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!isValidId(item.id)) issues.push({ field: 'id', message: 'An item needs an id.' })
  if (!isValidId(item.vaultId)) issues.push({ field: 'vaultId', message: 'An item needs a vault id.' })
  if (!isItemKind(item.kind)) issues.push({ field: 'kind', message: 'Invalid item kind.' })
  if (item.parentId !== null && !isValidId(item.parentId)) issues.push({ field: 'parentId', message: 'Invalid parent id.' })
  if (!Number.isInteger(item.version) || item.version < 1) issues.push({ field: 'version', message: 'Invalid item version.' })
  if (!isValidTimestamp(item.createdAt)) issues.push({ field: 'createdAt', message: 'Invalid creation time.' })
  if (!isValidTimestamp(item.updatedAt)) issues.push({ field: 'updatedAt', message: 'Invalid update time.' })
  if (isValidTimestamp(item.createdAt) && isValidTimestamp(item.updatedAt) && item.createdAt > item.updatedAt) {
    issues.push({ field: 'updatedAt', message: 'Update time precedes creation time.' })
  }

  if (item.kind === 'collection') {
    if (isBlank(item.title)) issues.push({ field: 'title', message: 'A collection requires a title.' })
    issues.push(...validateTitle(item.title))
    if (!isCollectionColor(item.color)) issues.push({ field: 'color', message: 'Choose a valid collection color.' })
    if (item.body !== null) issues.push({ field: 'body', message: 'A collection cannot have a body.' })
    if (item.isSecret) issues.push({ field: 'isSecret', message: 'A collection cannot be secret.' })
  } else {
    issues.push(...validateBody(item.body ?? ''))
    issues.push(...validateTitle(item.title))
    if (item.isSecret && isBlank(item.title)) issues.push({ field: 'title', message: 'A secret note requires a title.' })
    if (item.color !== null) issues.push({ field: 'color', message: 'A note cannot have a color.' })
  }

  return issues
}
