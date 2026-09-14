import { decodeHTMLStrict } from 'entities'
import {
  escapeHTML,
  normalizeReference,
  safeURL,
  readDestination,
  readTitle,
  readLabel,
  skipSpace,
  escapable,
  entity,
  type Reference,
  type InlineOptions,
} from './inline-syntax.js'
export { escapeHTML, decodeMarkdown, readReference, type References } from './inline-syntax.js'

type Kind =
  'text' | 'code' | 'softbreak' | 'hardbreak' | 'html' | 'em' | 'strong' | 'del' | 'link' | 'image'
interface Node {
  kind: Kind
  text: string
  children?: Node[]
  destination?: string
  title?: string
  prev?: Node
  next?: Node
}
interface Delimiter {
  index: number
  node: Node
  char: string
  length: number
  original: number
  open: boolean
  close: boolean
  prev?: Delimiter
  next?: Delimiter
}
interface Bracket {
  node: Node
  pos: number
  image: boolean
  active: boolean
  bottom?: Delimiter
}
const punctuation = /[\p{P}\p{S}]/u
const whitespace = /\s/u
const htmlTag =
  /^(?:<!--(?:>|->|[\s\S]*?-->)|<\?[\s\S]*?\?>|<![A-Z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^ \t\n\r"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>)/

function renderNodes(nodes: Node[], options: InlineOptions, alt = false): string {
  // An explicit work stack handles deeply nested emphasis and images without recursion.
  const work: (string | { node: Node; alt: boolean })[] = []
  const output: string[] = []
  const children = (nodes: Node[], alt: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) work.push({ node: nodes[i], alt })
  }
  children(nodes, alt)
  while (work.length) {
    const task = work.pop()!
    if (typeof task === 'string') {
      output.push(task)
      continue
    }
    const { node, alt } = task
    if (node.kind === 'text' || node.kind === 'code') {
      const text = escapeHTML(node.text)
      output.push(alt || node.kind === 'text' ? text : `<code>${text}</code>`)
      continue
    }
    if (node.kind === 'softbreak') {
      output.push('\n')
      continue
    }
    if (node.kind === 'hardbreak') {
      output.push(alt ? '\n' : '<br />\n')
      continue
    }
    if (node.kind === 'html') {
      if (!alt) output.push(options.allowHtml ? node.text : escapeHTML(node.text))
      continue
    }
    if (node.kind === 'image') {
      if (!alt) {
        output.push(`<img src="${escapeHTML(node.destination!)}" alt="`)
        work.push(`"${node.title ? ` title="${escapeHTML(node.title)}"` : ''} />`)
      }
      children(node.children!, true)
      continue
    }
    if (alt) {
      children(node.children!, true)
      continue
    }
    if (node.kind === 'link') {
      output.push(
        `<a href="${escapeHTML(node.destination!)}"${node.title ? ` title="${escapeHTML(node.title)}"` : ''}>`,
      )
      work.push('</a>')
    } else {
      output.push(`<${node.kind}>`)
      work.push(`</${node.kind}>`)
    }
    children(node.children!, false)
  }
  return output.join('')
}

/** Plain text can be emitted before reference definitions are collected. */
export function plainInline(input: string): string | undefined {
  if (/[\\`*_~[<&]/.test(input) || /[ \t]+\n|\n[ \t]/.test(input)) return undefined
  return escapeHTML(input.replace(/^[ \t]+|[ \t]+$/g, ''))
}

/** Bracket and delimiter stacks implement precedence without a full Markdown parser dependency. */
export function inline(input: string, options: InlineOptions = {}): string {
  const source = input.replace(/^[ \t]+|[ \t]+$/g, '')
  // Ordinary text needs no token tree or delimiter/bracket bookkeeping.
  const plain = plainInline(source)
  if (plain !== undefined) return plain
  const root: Node = { kind: 'text', text: '' }
  let tail = root,
    firstDelimiter: Delimiter | undefined,
    lastDelimiter: Delimiter | undefined
  const brackets: Bracket[] = []
  let delimiterIndex = 0
  let backticks: Map<number, { positions: number[]; cursor: number }> | undefined
  const closingBacktick = (position: number, length: number): number => {
    if (!backticks) {
      backticks = new Map()
      const runs = /`+/g
      let match: RegExpExecArray | null
      while ((match = runs.exec(source))) {
        let entry = backticks.get(match[0].length)
        if (!entry) backticks.set(match[0].length, (entry = { positions: [], cursor: 0 }))
        entry.positions.push(match.index)
      }
    }
    const entry = backticks.get(length)!
    while (entry.cursor < entry.positions.length && entry.positions[entry.cursor] <= position)
      entry.cursor++
    return entry.positions[entry.cursor] ?? -1
  }
  const append = (kind: Kind, text = '') => {
    const node: Node = { kind, text, prev: tail }
    tail.next = node
    tail = node
    return node
  }
  const removeNode = (node: Node) => {
    if (node.prev) node.prev.next = node.next
    if (node.next) node.next.prev = node.prev
    if (tail === node) tail = node.prev!
  }
  const removeDelimiter = (delimiter: Delimiter) => {
    if (delimiter.prev) delimiter.prev.next = delimiter.next
    else firstDelimiter = delimiter.next
    if (delimiter.next) delimiter.next.prev = delimiter.prev
    else lastDelimiter = delimiter.prev
  }
  function processDelimiters(bottom?: Delimiter) {
    const lowerBounds = new Map<string, number>()
    let closer = bottom ? bottom.next : firstDelimiter
    while (closer) {
      if (!closer.close) {
        closer = closer.next
        continue
      }
      const key = `${closer.char}:${Number(closer.open)}:${closer.original % 3}`
      const lower = lowerBounds.get(key) ?? bottom?.index ?? -1
      let opener = closer.prev
      while (opener && opener !== bottom && opener.index > lower) {
        const odd =
          (opener.close || closer.open) &&
          (opener.original + closer.original) % 3 === 0 &&
          (opener.original % 3 !== 0 || closer.original % 3 !== 0)
        if (opener.char === closer.char && opener.open && (closer.char === '~' || !odd)) break
        opener = opener.prev
      }
      if (!opener || opener === bottom || opener.index <= lower) {
        lowerBounds.set(key, closer.prev?.index ?? -1)
        const next = closer.next
        if (!closer.open) removeDelimiter(closer)
        closer = next
        continue
      }
      const use = closer.char === '~' ? 2 : Math.min(opener.length, closer.length) >= 2 ? 2 : 1
      const children: Node[] = []
      for (let node = opener.node.next; node && node !== closer.node; node = node.next)
        children.push(node)
      const wrapper: Node = {
        kind: closer.char === '~' ? 'del' : use === 2 ? 'strong' : 'em',
        text: '',
        children,
        prev: opener.node,
        next: closer.node,
      }
      opener.node.next = wrapper
      closer.node.prev = wrapper
      for (let between = opener.next; between && between !== closer;) {
        const next = between.next
        removeDelimiter(between)
        between = next
      }
      opener.length -= use
      closer.length -= use
      opener.node.text = opener.node.text.slice(0, -use)
      closer.node.text = closer.node.text.slice(use)
      if (!opener.length) {
        removeNode(opener.node)
        removeDelimiter(opener)
      }
      if (!closer.length) {
        const next = closer.next
        removeNode(closer.node)
        removeDelimiter(closer)
        closer = next
      }
    }
    for (let current = bottom ? bottom.next : firstDelimiter; current;) {
      const next = current.next
      removeDelimiter(current)
      current = next
    }
  }
  for (let pos = 0; pos < source.length;) {
    const char = source[pos],
      rest = source.slice(pos)
    if (char === '\\' && source[pos + 1] === '\n') {
      append('hardbreak')
      pos += 2
      while (source[pos] === ' ' || source[pos] === '\t') pos++
      continue
    }
    if (char === '\\' && escapable.test(source[pos + 1] ?? '')) {
      append('text', source[pos + 1])
      pos += 2
      continue
    }
    if (char === '\n') {
      const trailing = tail.kind === 'text' ? (/[ \t]+$/.exec(tail.text)?.[0] ?? '') : ''
      if (trailing) tail.text = tail.text.slice(0, -trailing.length)
      append(trailing.endsWith('  ') ? 'hardbreak' : 'softbreak')
      pos++
      while (source[pos] === ' ' || source[pos] === '\t') pos++
      continue
    }
    if (char === '`') {
      const marker = /^`+/.exec(rest)![0]
      const end = closingBacktick(pos, marker.length)
      if (end >= 0) {
        let text = source.slice(pos + marker.length, end).replace(/\n/g, ' ')
        if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text))
          text = text.slice(1, -1)
        append('code', text)
        pos = end + marker.length
      } else {
        append('text', marker)
        pos += marker.length
      }
      continue
    }
    if (char === '&') {
      const match = entity.exec(rest)
      if (match) {
        append('text', decodeHTMLStrict(match[0]))
        pos += match[0].length
        continue
      }
    }
    if (char === '<') {
      const link = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\u0000-\u0020]*)>/.exec(rest)
      const email =
        /^<([a-zA-Z0-9.!#$%&'*+\/?=^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/.exec(
          rest,
        )
      const match = link ?? email
      if (match) {
        const destination = safeURL((email && !link ? 'mailto:' : '') + match[1])
        if (destination !== null) {
          const node = append('link')
          node.children = [{ kind: 'text', text: match[1] }]
          node.destination = destination
          for (const bracket of brackets) if (!bracket.image) bracket.active = false
          pos += match[0].length
          continue
        }
      }
      const html = htmlTag.exec(rest)
      if (html) {
        append('html', html[0])
        pos += html[0].length
        continue
      }
    }
    if (char === '[' || (char === '!' && source[pos + 1] === '[')) {
      const image = char === '!'
      const node = append('text', image ? '![' : '[')
      brackets.push({ node, pos: pos + Number(image), image, active: true, bottom: lastDelimiter })
      pos += image ? 2 : 1
      continue
    }
    if (char === ']') {
      const opener = brackets.pop()
      if (opener?.active) {
        let end = pos + 1,
          reference: Reference | undefined
        if (source[end] === '(') {
          const destinationStart = skipSpace(source, end + 1)
          const destination = readDestination(source, destinationStart)
          if (destination) {
            let finish = skipSpace(source, destination.end),
              title = ''
            if (finish > destination.end) {
              const parsedTitle = readTitle(source, finish)
              if (parsedTitle) {
                title = parsedTitle.value
                finish = skipSpace(source, parsedTitle.end)
              }
            }
            if (source[finish] === ')') {
              reference = { destination: destination.value, title }
              end = finish + 1
            }
          }
        }
        if (!reference) {
          const label = readLabel(source, pos + 1)
          const raw = source.slice(opener.pos + 1, pos)
          const key = label?.value || raw
          if (key.length <= 999 && !/(?<!\\)[\[\]]/.test(key))
            reference = options.references?.get(normalizeReference(key))
          if (reference && label) end = label.end
        }
        const destination = reference && safeURL(reference.destination)
        if (reference && destination !== null && destination !== undefined) {
          processDelimiters(opener.bottom)
          const children: Node[] = []
          for (let node = opener.node.next; node; node = node.next) children.push(node)
          opener.node.kind = opener.image ? 'image' : 'link'
          opener.node.children = children
          opener.node.destination = destination
          opener.node.title = reference.title
          opener.node.next = undefined
          tail = opener.node
          if (!opener.image)
            for (const bracket of brackets) if (!bracket.image) bracket.active = false
          pos = end
          continue
        }
      }
      append('text', ']')
      pos++
      continue
    }
    if (char === '*' || char === '_' || (char === '~' && source[pos + 1] === '~')) {
      let end = pos
      while (source[end] === char) end++
      const length = end - pos
      const before = Array.from(source.slice(Math.max(0, pos - 2), pos)).at(-1) ?? '\n'
      const after = String.fromCodePoint(source.codePointAt(end) ?? 10)
      const left =
        !whitespace.test(after) &&
        (!punctuation.test(after) || whitespace.test(before) || punctuation.test(before))
      const right =
        !whitespace.test(before) &&
        (!punctuation.test(before) || whitespace.test(after) || punctuation.test(after))
      const node = append('text', source.slice(pos, end))
      if (char !== '~' || length === 2) {
        const delimiter: Delimiter = {
          index: delimiterIndex++,
          node,
          char,
          length,
          original: length,
          open: char === '_' ? left && (!right || punctuation.test(before)) : left,
          close: char === '_' ? right && (!left || punctuation.test(after)) : right,
          prev: lastDelimiter,
        }
        if (lastDelimiter) lastDelimiter.next = delimiter
        else firstDelimiter = delimiter
        lastDelimiter = delimiter
      }
      pos = end
      continue
    }
    const plain = /^[^\\\n`!*_[\]<&~]+/.exec(rest)?.[0] ?? char
    append('text', plain)
    pos += plain.length
  }
  processDelimiters()
  const nodes: Node[] = []
  for (let node = root.next; node; node = node.next) nodes.push(node)
  return renderNodes(nodes, options)
}
