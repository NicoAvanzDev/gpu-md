import { decodeHTMLStrict } from 'entities'
import { encode as encodeURL } from 'mdurl'

export function escapeHTML(value: string): string {
  // All generated attributes use double quotes. Apostrophes stay literal, as in CommonMark.
  return value.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  )
}

export const escapable = /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/
export const entity = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/
export function decodeMarkdown(source: string): string {
  return source.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g,
    (match, escaped) => escaped ?? decodeHTMLStrict(match),
  )
}
export interface Reference {
  destination: string
  title: string
}
export type References = Map<string, Reference>
export interface InlineOptions {
  references?: References
  allowHtml?: boolean
}
export const normalizeReference = (label: string) =>
  label
    .trim()
    .replace(/[ \t\r\n]+/g, ' ')
    .toLowerCase()
    .toUpperCase()

export function safeURL(source: string): string | null {
  if (
    /^[\s]*?(?:javascript|vbscript|file|data):/i.test(source) ||
    /^[\s]*\/\//.test(source) ||
    /[\u0000-\u001f\u007f]/.test(source)
  )
    return null
  return encodeURL(source)
}

export function readDestination(
  source: string,
  start: number,
): { value: string; end: number } | null {
  let pos = start
  if (source[pos] === '<') {
    pos++
    while (pos < source.length) {
      if (source[pos] === '\\' && escapable.test(source[pos + 1] ?? '')) {
        pos += 2
        continue
      }
      if (source[pos] === '\n' || source[pos] === '<') return null
      if (source[pos] === '>')
        return { value: decodeMarkdown(source.slice(start + 1, pos)), end: pos + 1 }
      pos++
    }
    return null
  }
  let depth = 0
  while (pos < source.length) {
    const char = source[pos]
    if (char === '\\' && escapable.test(source[pos + 1] ?? '')) {
      pos += 2
      continue
    }
    if (/[\u0000-\u0020\u007f]/.test(char)) break
    if (char === '(') {
      if (++depth > 32) return null
    }
    if (char === ')') {
      if (depth === 0) break
      depth--
    }
    pos++
  }
  return depth === 0 ? { value: decodeMarkdown(source.slice(start, pos)), end: pos } : null
}

export function readTitle(source: string, start: number): { value: string; end: number } | null {
  const opener = source[start],
    closer = opener === '(' ? ')' : opener
  if (!['"', "'", '('].includes(opener)) return null
  let pos = start + 1
  while (pos < source.length) {
    if (source[pos] === '\\' && escapable.test(source[pos + 1] ?? '')) {
      pos += 2
      continue
    }
    if (source[pos] === closer) {
      const value = source.slice(start + 1, pos)
      return /\n[ \t]*\n/.test(value) ? null : { value: decodeMarkdown(value), end: pos + 1 }
    }
    if (opener === '(' && source[pos] === '(') return null
    pos++
  }
  return null
}

export function readLabel(source: string, start: number): { value: string; end: number } | null {
  if (source[start] !== '[') return null
  let pos = start + 1
  while (pos < source.length && pos - start <= 1000) {
    if (source[pos] === '\\') {
      pos += 2
      continue
    }
    if (source[pos] === '[') return null
    if (source[pos] === ']') return { value: source.slice(start + 1, pos), end: pos + 1 }
    pos++
  }
  return null
}
export const skipSpace = (source: string, pos: number) =>
  pos + (/^[ \t]*(?:\n[ \t]*)?/.exec(source.slice(pos))?.[0].length ?? 0)

/** Definitions are extracted from paragraph starts, before deferred inline rendering. */
export function readReference(source: string, references: References): number {
  const indent = /^ {0,3}/.exec(source)![0].length
  const label = readLabel(source, indent)
  if (!label || !normalizeReference(label.value) || source[label.end] !== ':') return 0
  const start = skipSpace(source, label.end + 1)
  const destination = readDestination(source, start)
  if (!destination || destination.end === start) return 0
  const endOfDestination = destination.end
  let pos = skipSpace(source, endOfDestination),
    title = ''
  if (pos > endOfDestination) {
    const candidate = readTitle(source, pos)
    if (candidate && /^[ \t]*(?:\n|$)/.test(source.slice(candidate.end))) {
      pos = candidate.end
      title = candidate.value
    } else pos = endOfDestination
  }
  const ending = /^[ \t]*(?:\n|$)/.exec(source.slice(pos))
  if (!ending) return 0
  const key = normalizeReference(label.value)
  if (!references.has(key)) references.set(key, { destination: destination.value, title })
  return pos + ending[0].length
}
