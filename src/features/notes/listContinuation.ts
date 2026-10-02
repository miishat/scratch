// Numbered-list continuation for the note textarea. Pressing Enter at the end of
// "3. text" starts "4. " in the same style; Enter on an empty "4. " ends the list.
const numbered = /^(\s*)(\d+)([.)])(\s+)(.*)$/

export interface ListEdit {
  value: string
  caret: number
}

export function continueNumberedList(value: string, start: number, end: number): ListEdit | null {
  if (start !== end) return null
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEndIndex = value.indexOf('\n', start)
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
  // Only continue from the end of the line; Enter mid-line splits it as usual.
  if (start !== lineEnd) return null
  const match = numbered.exec(value.slice(lineStart, lineEnd))
  if (!match) return null
  const [, indent, number, delimiter, space, text] = match
  if (text.trim() === '') {
    const value2 = value.slice(0, lineStart) + value.slice(lineEnd)
    return { value: value2, caret: lineStart }
  }
  const insert = `\n${indent}${Number(number) + 1}${delimiter}${space}`
  return { value: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length }
}
