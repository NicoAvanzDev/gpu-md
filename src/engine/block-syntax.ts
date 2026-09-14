export const listMarker = /^( {0,3})([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/
export const fenceMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/
export const rule = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/

export function indentation(line: string): number {
  let column = 0
  for (const char of line) {
    if (char === ' ') column++
    else if (char === '\t') column += 4 - (column % 4)
    else break
  }
  return column
}

export function stripIndent(line: string, count: number): string {
  let column = 0,
    pos = 0
  while (pos < line.length && column < count && (line[pos] === ' ' || line[pos] === '\t')) {
    column += line[pos++] === ' ' ? 1 : 4 - (column % 4)
  }
  // Preserve the original tab stops when a container prefix consumed part of a tab.
  let remainder = line.slice(pos)
  if (column > count || count % 4 !== 0) {
    while (remainder[0] === ' ' || remainder[0] === '\t') {
      const width = remainder[0] === ' ' ? 1 : 4 - (column % 4)
      column += width
      remainder = remainder.slice(1)
    }
    return ' '.repeat(column - count) + remainder
  }
  return remainder
}

export function listInfo(line: string) {
  const match = listMarker.exec(line)
  if (!match) return null
  const ordered = /^\d/.test(match[2]),
    markerEnd = match[1].length + match[2].length
  let column = markerEnd
  for (const char of match[3] ?? '') column += char === ' ' ? 1 : 4 - (column % 4)
  const space = column - markerEnd
  const text = match[4] ?? ''
  const padding = !text || space > 4 ? 1 : space
  return {
    ordered,
    start: ordered ? parseInt(match[2]) : 1,
    markerType: ordered ? match[2].at(-1)! : match[2],
    contentIndent: markerEnd + padding,
    content: ' '.repeat(Math.max(0, space - padding)) + text,
  }
}

const continuationStates = new WeakMap<string[], { processed: number; fenced?: string }>()
export function canContinueParagraph(lines: string[]): boolean {
  if (!lines.at(-1)?.trim()) return false
  const state = continuationStates.get(lines) ?? { processed: 0, fenced: undefined }
  let fenced = state.fenced
  for (let index = state.processed; index < lines.length; index++) {
    const line = lines[index]
    const marker = fenceMarker.exec(line.trimStart())
    if (marker) {
      if (!fenced) fenced = marker[1]
      else if (marker[1][0] === fenced[0] && marker[1].length >= fenced.length && !marker[2].trim())
        fenced = undefined
    }
  }
  state.processed = lines.length
  state.fenced = fenced
  continuationStates.set(lines, state)
  let leaf = lines.at(-1)!
  while (/^ {0,3}>/.test(leaf)) leaf = leaf.replace(/^ {0,3}> ?/, '')
  const last = leaf.trimStart()
  return (
    indentation(leaf) < 4 &&
    !fenced &&
    !fenceMarker.test(last) &&
    !rule.test(last) &&
    !/^#{1,6}(?:\s|$)/.test(last)
  )
}

export function cells(line: string): string[] {
  let value = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
  const result: string[] = []
  let current = '',
    ticks = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && value[i + 1] === '|') {
      current += '|'
      i++
      continue
    }
    if (value[i] === '`') {
      let end = i
      while (value[end] === '`') end++
      const length = end - i
      if (ticks === 0) ticks = length
      else if (ticks === length) ticks = 0
      current += value.slice(i, end)
      i = end - 1
      continue
    }
    if (value[i] === '|' && ticks === 0) {
      result.push(current.trim())
      current = ''
    } else current += value[i]
  }
  result.push(current.trim())
  return result
}

export function separator(line: string): boolean {
  return line.includes('|') && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell))
}
