import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import MarkdownIt from 'markdown-it'
import { FEATURES, HIDDEN, LABELS, featurize } from '../src/engine/features.ts'

// Synthetic documents, independently seeded train/validation splits. markdown-it is the teacher.
const teacher = new MarkdownIt({ html: false })
let seed = 20260909
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
function pick<T>(values: T[]): T {
  return values[Math.floor(random() * values.length)]
}
const words = [
  'parallel',
  'garden',
  'cobalt',
  'render',
  'hello',
  'Markdown',
  'GPU',
  'thread',
  'document',
  '42',
  '世界',
  'café',
  'naïve',
  '🚀',
  'shader',
  'a',
  'with',
  'the',
  'notes',
  'structure',
  'pixels',
  'small',
  'beautiful',
  'quiet',
]
function prose() {
  if (random() < 0.25)
    return pick(['a', 'b', 'c', 'x', '0', '?', '.', '[', ']', '#', '*', '>', '`', '世界', '😃'])
  return Array.from({ length: 1 + Math.floor(random() * 15) }, () => pick(words)).join(' ')
}
function doc(): string {
  const text = prose()
  const indent = ' '.repeat(Math.floor(random() * 4))
  const bullet = pick(['-', '*', '+'])
  const fence = pick(['```', '````', '~~~', '~~~~~'])
  const orderedStart = pick([
    1,
    1 + Math.floor(random() * 9),
    10 + Math.floor(random() * 90),
    100 + Math.floor(random() * 900),
    1000 + Math.floor(random() * 9000),
    10000 + Math.floor(random() * 990000),
    1000000 + Math.floor(random() * 9000000),
    100000000 + Math.floor(random() * 899999999),
  ])
  const orderedMarker = pick(['.', ')'])
  const markerSpace = pick([' ', ' ', '  ', '\t', '    ', '     ', '      ', '          '])
  const symbol = pick(['*', '-', '_'])
  const ruleText = Array.from({ length: 3 + Math.floor(random() * 8) }, () =>
    symbol.repeat(1 + Math.floor(random() * 3)),
  ).join(pick(['', ' ', '  ', '     ', '\t']))
  const codePrefix = pick(['    ', '     ', '        ', '\t', '  \t'])
  const syntax = pick([
    '# ',
    '## ',
    '> ',
    '> > ',
    '- ',
    '- - ',
    '1. ',
    '123456789. ',
    '[reference]: /url',
    '```',
    '~~~',
    '**',
    '_',
    '\\[\\]',
    '<div>',
    ruleText,
  ])
  const variants = [
    () => `${text}\n${prose()}`,
    () =>
      `${indent}${'#'.repeat(1 + Math.floor(random() * 6))}${pick([' ' + text, '', ' '])}${pick(['', ' ##', ' ###'])}`,
    () =>
      `${indent}${fence}${pick(['', 'ts', 'python', 'js', 'rust'])}\n${prose()}\n# this is code\n${indent}${fence}`,
    () => `${indent}> ${pick(['', syntax])}${text}\n${indent}> ${prose()}`,
    () => `${indent}> ${text}\n${prose()}`,
    () => `${indent}> > ${text}\n> > ${prose()}`,
    () => `${indent}> [reference]: /url\n> ${prose()}`,
    () =>
      `${indent}${bullet}${markerSpace}${pick(['', syntax])}${text}\n${indent}${bullet} ${prose()}`,
    () =>
      `${indent}${orderedStart}${orderedMarker}${markerSpace}${text}\n${indent}${orderedStart + 1}${orderedMarker}${markerSpace}${prose()}`,
    () => `${indent}${ruleText}`,
    () => `${prose()}\n${indent}${ruleText}\n${prose()}`,
    () => `${indent}${ruleText}\n${indent}${ruleText}`,
    () => `${indent}${bullet} ${text}\n${indent}${ruleText}\n${indent}${bullet} ${prose()}`,
    () => `| ${text} | ${prose()} |\n| :--- | ---: |\n| ${prose()} | ${prose()} |`,
    () => `${text}\n${pick(['===', '---', '=======', '--------'])}`,
    () =>
      `${codePrefix}${pick(['', syntax, syntax + syntax, ruleText])}${pick(['', text])}${pick(['', `\n${codePrefix}${prose()}`, `\n${codePrefix}${prose()}\n${codePrefix}${prose()}`])}`,
    () => `${bullet} [${pick([' ', 'x', 'X'])}] ${text}`,
    () =>
      pick([
        `#${text}`,
        `####### ${text}`,
        `1.${text}`,
        `*${text}*`,
        `**${text}**`,
        `[${text}](https://example.com)`,
        `\`${text}\``,
        `a | b`,
        `<div>${text}</div>`,
        `---${text}`,
        `>word`,
        `\\# ${text}`,
        `-`,
        `-${markerSpace}`,
        `+${markerSpace}`,
        `*${markerSpace}`,
        `+`,
        `*`,
        `  ${text}`,
      ]),
  ]
  return Array.from({ length: 4 + Math.floor(random() * 8) }, () => pick(variants)()).join(
    pick(['\n', '\n\n', '\n\n', '\n\n\n']),
  )
}

function labelDocument(source: string): number[] {
  const lines = source.split('\n')
  const labels: number[] = lines.map((line) => (line.trim() ? 0 : 1))
  for (const token of teacher.parse(source, {})) {
    if (!token.map) continue
    const [start, end] = token.map
    if (token.type === 'heading_open') {
      if (/^ {0,3}#{1,6}(?:\s|$)/.test(lines[start])) labels[start] = 2
      else labels[end - 1] = 9
    }
    if (token.type === 'fence') {
      labels[start] = 3
      if (end > start + 1 && /^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[end - 1])) labels[end - 1] = 3
      // Interior syntax is intentionally classified independently; the assembler owns fence state.
    }
    if (token.type === 'blockquote_open') {
      for (let i = start; i < end; i++) if (/^ {0,3}>/.test(lines[i])) labels[i] = 4
    }
    if (token.type === 'list_item_open') labels[start] = /^\s*\d+[.)]/.test(lines[start]) ? 6 : 5
    if (token.type === 'hr') labels[start] = 7
    if (token.type === 'table_open') {
      for (let i = start; i < end; i++) labels[i] = i === start + 1 ? 9 : 8
    }
    if (token.type === 'code_block')
      for (let i = start; i < end; i++) if (lines[i].trim()) labels[i] = 10
  }
  // The model predicts candidate block roles. Paragraph interruption and container
  // continuation belong to the decoder. Labeling each candidate with the teacher in
  // isolation avoids contradictory labels for the same visible line (e.g. indented
  // text after a paragraph versus after a blank, or a thematic break after a heading).
  const surfaceTypes: Record<string, number> = {
    heading_open: 2,
    fence: 3,
    blockquote_open: 4,
    bullet_list_open: 5,
    ordered_list_open: 6,
    hr: 7,
    code_block: 10,
  }
  for (let row = 0; row < lines.length; row++) {
    if (!lines[row].trim()) continue
    const first = teacher.parse(lines[row] + '\n', {})[0]
    const surface = first && surfaceTypes[first.type]
    if (surface !== undefined) labels[row] = surface
    else if (labels[row] !== 8 && labels[row] !== 9) labels[row] = 0
  }
  // Exclude fence interiors from training: their surface class is context-independent.
  for (const token of teacher.parse(source, {}))
    if (token.type === 'fence' && token.map) {
      for (let i = token.map[0] + 1; i < token.map[1] - 1; i++) labels[i] = -1
    }
  return labels
}

await mkdir('.training', { recursive: true })
for (const [split, count, splitSeed] of [
  ['train', 1800, 20260909],
  ['validation', 300, 9152026],
  ['test', 300, 12092026],
] as const) {
  seed = splitSeed
  const documents = Array.from({ length: count }, doc)
  const chunks: number[] = [],
    targets: number[] = []
  for (const source of documents) {
    const features = featurize(source.split('\n'))
    labelDocument(source).forEach((label, row) => {
      if (label < 0) return
      chunks.push(...features.subarray(row * FEATURES, (row + 1) * FEATURES))
      targets.push(label)
    })
  }
  await writeFile(`.training/${split}.f32`, new Uint8Array(new Float32Array(chunks).buffer))
  await writeFile(`.training/${split}.labels`, new Uint8Array(targets))
  console.log(`${split}: ${documents.length} synthetic documents, ${targets.length} lines`)
}
await writeFile(
  '.training/config.json',
  JSON.stringify({
    features: FEATURES,
    hidden: HIDDEN,
    labels: LABELS,
    teacher: `markdown-it ${createRequire(import.meta.url)('markdown-it/package.json').version}`,
    documents: { train: 1800, validation: 300, test: 300 },
  }),
)
