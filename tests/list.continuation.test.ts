import { describe, expect, it } from 'vitest'
import { continueNumberedList } from '../src/features/notes/listContinuation'

describe('continueNumberedList', () => {
  it('starts the next number at the end of a numbered line', () => {
    const value = '1. one\n2. two'
    expect(continueNumberedList(value, value.length, value.length)).toEqual({ value: `${value}\n3. `, caret: value.length + 4 })
  })
  it('keeps indent and the ")" style', () => {
    const value = '  9) nine'
    expect(continueNumberedList(value, value.length, value.length)?.value).toBe('  9) nine\n  10) ')
  })
  it('ends the list on an empty item', () => {
    const value = '1. one\n2. '
    expect(continueNumberedList(value, value.length, value.length)).toEqual({ value: '1. one\n', caret: 7 })
  })
  it('leaves other lines and mid-line Enter alone', () => {
    expect(continueNumberedList('plain', 5, 5)).toBeNull()
    expect(continueNumberedList('1. one', 3, 3)).toBeNull()
    expect(continueNumberedList('1. one', 0, 6)).toBeNull()
  })
})
