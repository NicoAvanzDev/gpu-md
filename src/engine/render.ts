import {
  fenceMarker,
  rule,
  indentation,
  stripIndent,
  listInfo,
  canContinueParagraph,
  cells,
  separator,
} from './block-syntax.js'
import { sketch, COMPACT_FEATURES, type Label } from './features.js'
import { htmlBlock } from './html.js'
import { classifyCompact, type Prediction } from './model.js'
import {
  escapeHTML,
  inline as renderInline,
  plainInline,
  decodeMarkdown,
  readReference,
  type References,
} from './inline.js'

export interface AssemblyOptions {
  allowHtml?: boolean
}
interface Context {
  references: References
  inlines: string[]
  options: AssemblyOptions
}
interface Looseness {
  value: boolean
  paragraphs?: string[]
}

export function assemble(
  lines: string[],
  predictions: Prediction[],
  options: AssemblyOptions = {},
): string {
  const context: Context = { references: new Map(), inlines: [], options }
  const html = assembleBlocks(lines, predictions, 0, context)
  // Source NULs are replaced during input normalization, so these markers cannot collide with input.
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) =>
    renderInline(context.inlines[Number(index)], {
      references: context.references,
      allowHtml: options.allowHtml,
    }),
  )
}

/** Predictions select block handlers; deterministic state preserves delimiters and valid HTML. */
function assembleBlocks(
  lines: string[],
  predictions: Prediction[],
  depth: number,
  context: Context,
  looseness?: Looseness,
  lazyLines = new Set<number>(),
): string {
  if (depth > 12) return `<pre>${escapeHTML(lines.join('\n'))}</pre>\n`
  const nested = (source: string[], loose?: Looseness, lazy?: Set<number>) => {
    // Candidates for a plain line would all be rejected by kind(). Avoid running
    // the model when no accepted block marker is possible; retain full neighbors
    // when sketching the lines that do need a learned decision.
    const needed: number[] = []
    for (let row = 0; row < source.length; row++) {
      const line = source[row]
      if (
        line.trim() &&
        (indentation(line) >= 4 || line.includes('|') || /^[#>`~*+_\-0-9]/.test(line.trimStart()))
      )
        needed.push(row)
    }
    const predictions: Prediction[] = new Array(source.length)
    if (needed.length) {
      const features = sketch(source)
      const selected = new Float32Array(needed.length * COMPACT_FEATURES)
      for (let i = 0; i < needed.length; i++)
        selected.set(
          features.subarray(needed[i] * COMPACT_FEATURES, (needed[i] + 1) * COMPACT_FEATURES),
          i * COMPACT_FEATURES,
        )
      const classified = classifyCompact(selected)
      for (let i = 0; i < needed.length; i++) predictions[needed[i]] = classified[i]
    }
    return assembleBlocks(source, predictions, depth + 1, context, loose, lazy)
  }
  const inline = (source: string) =>
    plainInline(source) ?? `\u0000${context.inlines.push(source) - 1}\u0000`
  let html = '',
    row = 0,
    gap = false
  let referenceSource: string | undefined
  const lineOffsets: number[] = []
  const kinds: (Label | undefined)[] = new Array(lines.length)
  const kind = (at: number): Label => {
    if (kinds[at] !== undefined) return kinds[at]!
    const line = lines[at] ?? ''
    let selected: Label = 'text'
    // Decode only the two model candidates. Plain text is the fallback after
    // rejecting candidates whose block markers are invalid in this position.
    for (const candidate of predictions[at]?.candidates ?? []) {
      const label = candidate.label
      const fence = label === 'fence' && fenceMarker.exec(line)
      const valid =
        (label === 'blank' && !line.trim()) ||
        (label === 'heading' && /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) ||
        (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) ||
        (label === 'quote' && /^ {0,3}>/.test(line)) ||
        (label === 'bullet' && listInfo(line)?.ordered === false) ||
        (label === 'ordered' && listInfo(line)?.ordered === true) ||
        ((label === 'rule' || label === 'separator') && rule.test(line)) ||
        (label === 'indented' && indentation(line) >= 4) ||
        (label === 'table' && line.includes('|') && !!lines[at + 1] && separator(lines[at + 1]))
      if (valid) {
        selected = label
        break
      }
    }
    kinds[at] = selected
    return selected
  }
  function startsBlock(at: number): boolean {
    const line = lines[at]
    if (lazyLines.has(at)) return false
    if (!line?.trim()) return true
    const label = kind(at)
    if (context.options.allowHtml && htmlBlock(line)?.interrupts) return true
    return (
      (label === 'heading' && /^ {0,3}#{1,6}(?:\s|$)/.test(line)) ||
      (label === 'fence' && fenceMarker.test(line)) ||
      (label === 'quote' && /^ {0,3}>/.test(line)) ||
      ((label === 'bullet' || label === 'ordered') &&
        !!listInfo(line)?.content.trim() &&
        (label !== 'ordered' || listInfo(line)?.start === 1)) ||
      (['rule', 'separator', 'bullet'].includes(label) && rule.test(line)) ||
      (label === 'table' && !!lines[at + 1] && separator(lines[at + 1]))
    )
  }
  while (row < lines.length) {
    const line = lines[row],
      label = kind(row)
    if (!line.trim()) {
      gap = true
      row++
      continue
    }
    if (gap && html && looseness) looseness.value = true
    gap = false
    if (/^ {0,3}\[/.test(line)) {
      if (referenceSource === undefined) {
        referenceSource = lines.join('\n')
        let offset = 0
        for (const line of lines) {
          lineOffsets.push(offset)
          offset += line.length + 1
        }
      }
      const remainder = referenceSource.slice(lineOffsets[row])
      const consumed = readReference(remainder, context.references)
      if (consumed) {
        const text = remainder.slice(0, consumed)
        row += text.split('\n').length - Number(text.endsWith('\n'))
        continue
      }
    }
    const rawHtml = context.options.allowHtml && htmlBlock(line)
    if (rawHtml) {
      const content: string[] = []
      while (row < lines.length) {
        if (!rawHtml.end && !lines[row].trim()) break
        const current = lines[row++]
        content.push(current)
        if (rawHtml.end?.test(current)) break
      }
      if (row === lines.length && content.at(-1) === '') content.pop()
      html += content.join('\n') + '\n'
      continue
    }
    const fence = label === 'fence' && fenceMarker.exec(line)
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      const marker = fence[1],
        content: string[] = []
      const indent = line.length - line.trimStart().length
      const language = decodeMarkdown(fence[2].trim()).split(/\s/)[0]
      const strip = new RegExp(`^ {0,${indent}}`)
      const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
      row++
      while (row < lines.length && !closing.test(lines[row])) {
        content.push(indent ? lines[row].replace(strip, '') : lines[row])
        row++
      }
      // split('\n') includes an empty sentinel at EOF; don't add a second newline.
      if (row === lines.length && content.at(-1) === '') content.pop()
      if (row < lines.length) row++
      html += `<pre><code${language ? ` class="language-${escapeHTML(language)}"` : ''}>${escapeHTML(content.join('\n'))}${content.length ? '\n' : ''}</code></pre>\n`
      continue
    }
    const heading = label === 'heading' && /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(line)
    if (heading) {
      const level = heading[1].length
      html += `<h${level}>${inline((heading[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim())}</h${level}>\n`
      row++
      continue
    }
    if (['rule', 'separator', 'bullet'].includes(label) && rule.test(line)) {
      html += '<hr />\n'
      row++
      continue
    }
    if (label === 'quote' && /^ {0,3}>/.test(line)) {
      const content: string[] = []
      const lazyLines = new Set<number>()
      while (row < lines.length) {
        const quote = /^ {0,3}>/.exec(lines[row])
        if (quote) {
          let text = lines[row].slice(quote[0].length),
            column = quote[0].length,
            space = 0
          while (text[0] === ' ' || text[0] === '\t') {
            const width = text[0] === ' ' ? 1 : 4 - (column % 4)
            space += width
            column += width
            text = text.slice(1)
          }
          content.push(' '.repeat(Math.max(0, space - 1)) + text)
          row++
          continue
        }
        if (lines[row].trim() && !startsBlock(row) && canContinueParagraph(content)) {
          lazyLines.add(content.length)
          content.push(lines[row++])
          continue
        }
        break
      }
      html += `<blockquote>\n${nested(content, undefined, lazyLines)}</blockquote>\n`
      continue
    }
    const marker = (label === 'bullet' || label === 'ordered') && listInfo(line)
    if (marker && !rule.test(line)) {
      const { ordered, markerType } = marker,
        tag = ordered ? 'ol' : 'ul'
      const items: { content: string[]; task: string | undefined; lazy: Set<number> }[] = []
      let loose = false
      while (row < lines.length) {
        const item = listInfo(lines[row])
        if (
          !item ||
          item.ordered !== ordered ||
          item.markerType !== markerType ||
          rule.test(lines[row])
        )
          break
        const task = /^\[([ xX])\][ \t]+(.*)/.exec(item.content)
        const content = [task ? task[2] : item.content]
        const itemLazy = new Set<number>()
        row++
        while (row < lines.length) {
          if (!lines[row].trim()) {
            let next = row + 1
            while (next < lines.length && !lines[next].trim()) next++
            if (next === lines.length) break
            if (!content[0].trim() && content.length === 1 && !listInfo(lines[next])) break
            if (indentation(lines[next]) >= item.contentIndent) {
              content.push(...Array(next - row).fill(''))
              row = next
              continue
            }
            const nextItem = listInfo(lines[next])
            if (
              nextItem &&
              nextItem.ordered === ordered &&
              nextItem.markerType === markerType &&
              !rule.test(lines[next])
            ) {
              loose = true
              row = next
            }
            break
          }
          if (indentation(lines[row]) >= item.contentIndent) {
            content.push(stripIndent(lines[row++], item.contentIndent))
            continue
          }
          if (listInfo(lines[row]) || startsBlock(row)) break
          if (canContinueParagraph(content)) {
            itemLazy.add(content.length)
            content.push(lines[row++].trimStart())
            continue
          }
          break
        }
        items.push({ content, task: task?.[1], lazy: itemLazy })
      }
      const rendered = items.map((item) => {
        const state = { value: false, paragraphs: [] as string[] }
        const body = nested(item.content, state, item.lazy)
        loose ||= state.value
        return { ...item, body, paragraphs: state.paragraphs }
      })
      html += `<${tag}${ordered && marker.start !== 1 ? ` start="${marker.start}"` : ''}${items.some((item) => item.task !== undefined) ? ' class="task-list"' : ''}>\n`
      for (const item of rendered) {
        let body = item.body
        if (!loose) {
          for (const paragraph of item.paragraphs) {
            const index = body.indexOf(paragraph)
            if (index >= 0)
              body =
                body.slice(0, index) +
                paragraph.slice(3, -5) +
                (index + paragraph.length < body.length ? '\n' : '') +
                body.slice(index + paragraph.length)
          }
        }
        const checkbox =
          item.task !== undefined
            ? `<input aria-label="${escapeHTML(item.content[0])}" type="checkbox" disabled${item.task.toLowerCase() === 'x' ? ' checked' : ''}> `
            : ''
        const newline = body && (loose || body.startsWith('<')) ? '\n' : ''
        html += `<li${item.task !== undefined ? ' class="task-item"' : ''}>${newline}${checkbox}${body}</li>\n`
      }
      html += `</${tag}>\n`
      continue
    }
    if (label === 'table' && lines[row + 1] && separator(lines[row + 1])) {
      const headers = cells(line),
        rules = cells(lines[row + 1])
      if (headers.length === rules.length) {
        const attr = (index: number) =>
          rules[index].startsWith(':') && rules[index].endsWith(':')
            ? ' style="text-align:center"'
            : rules[index].endsWith(':')
              ? ' style="text-align:right"'
              : rules[index].startsWith(':')
                ? ' style="text-align:left"'
                : ''
        html += `<table>\n<thead>\n<tr>\n${headers.map((cell, i) => `<th${attr(i)}>${inline(cell)}</th>\n`).join('')}</tr>\n</thead>\n`
        row += 2
        const body: string[] = []
        while (
          row < lines.length &&
          lines[row].trim() &&
          lines[row].includes('|') &&
          !startsBlock(row)
        ) {
          const values = cells(lines[row++])
          body.push(
            `<tr>\n${headers.map((_, i) => `<td${attr(i)}>${inline(values[i] ?? '')}</td>\n`).join('')}</tr>\n`,
          )
        }
        if (body.length) html += `<tbody>\n${body.join('')}</tbody>\n`
        html += '</table>\n'
        continue
      }
    }
    if (label === 'indented' && indentation(line) >= 4) {
      const content: string[] = []
      while (row < lines.length && (indentation(lines[row]) >= 4 || !lines[row].trim()))
        content.push(stripIndent(lines[row++], 4))
      while (content.at(-1) === '') content.pop()
      html += `<pre><code>${escapeHTML(content.join('\n'))}\n</code></pre>\n`
      continue
    }
    const paragraph: string[] = [line.trimStart()]
    row++
    let setext = 0
    while (row < lines.length && lines[row].trim()) {
      if (!lazyLines.has(row) && /^ {0,3}(=+|-+)[ \t]*$/.test(lines[row])) {
        setext = lines[row].trim()[0] === '=' ? 1 : 2
        row++
        break
      }
      if (startsBlock(row)) break
      paragraph.push(lines[row++].trimStart())
    }
    const tag = setext ? `h${setext}` : 'p'
    const markup = `<${tag}>${inline(paragraph.join('\n'))}</${tag}>\n`
    if (tag === 'p') looseness?.paragraphs?.push(markup)
    html += markup
  }
  return html
}
