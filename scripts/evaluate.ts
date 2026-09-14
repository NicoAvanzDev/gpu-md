import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { createRenderer, modelInfo } from '../src/engine/index.ts'

import { loadCommonMark, COMMONMARK_URL } from './commonmark'

const corpus = await loadCommonMark()
const checking = process.argv.includes('--check')
const renderer = createRenderer({ backend: 'cpu' })
const trustedRenderer = createRenderer({ backend: 'cpu', allowHtml: true })
const teacher = new MarkdownIt('commonmark', { html: false })
const sections: Record<
  string,
  { examples: number; exactSpecMatches: number; exactTeacherMatches: number }
> = {}
let trustedMatches = 0
const trustedFailures: typeof failures = []
let specMatches = 0,
  teacherMatches = 0
const failures: {
  example: number
  section: string
  markdown: string
  expected: string
  actual: string
}[] = []
for (const item of corpus) {
  const { html } = await renderer.render(item.markdown)
  const trusted = await trustedRenderer.render(item.markdown)
  if (trusted.html === item.html) trustedMatches++
  else
    trustedFailures.push({
      example: item.example,
      section: item.section,
      markdown: item.markdown,
      expected: item.html,
      actual: trusted.html,
    })
  const specMatch = html === item.html,
    teacherMatch = html === teacher.render(item.markdown)
  const section = (sections[item.section] ??= {
    examples: 0,
    exactSpecMatches: 0,
    exactTeacherMatches: 0,
  })
  section.examples++
  section.exactSpecMatches += Number(specMatch)
  section.exactTeacherMatches += Number(teacherMatch)
  specMatches += Number(specMatch)
  teacherMatches += Number(teacherMatch)
  if (!specMatch)
    failures.push({
      example: item.example,
      section: item.section,
      markdown: item.markdown,
      expected: item.html,
      actual: html,
    })
}
const report = {
  source: COMMONMARK_URL,
  corpusLicense: 'CC BY-SA 4.0; John MacFarlane',
  modelTraining: modelInfo.training,
  examples: corpus.length,
  exactSpecMatches: specMatches,
  exactSpecAgreement: specMatches / corpus.length,
  exactTeacherMatches: teacherMatches,
  exactTeacherAgreement: teacherMatches / corpus.length,
  sections,
  trustedHtml: {
    exactSpecMatches: trustedMatches,
    exactSpecAgreement: trustedMatches / corpus.length,
    allowHtml: true,
  },
  note: 'Strict byte-for-byte HTML comparison. The primary score keeps source HTML escaped. trustedHtml explicitly enables source HTML to match the specification. This corpus is a development regression suite, not held-out evidence of generalization.',
}
await writeFile(
  '.training/evaluation.json',
  JSON.stringify({ ...report, failures, trustedFailures }, null, 2),
)
if (!checking) await writeFile('evaluation.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
await renderer.destroy()
await trustedRenderer.destroy()
if (checking) {
  assert.equal(corpus.length, 652, 'Unexpected CommonMark corpus size')
  assert.equal(
    trustedMatches,
    corpus.length,
    `CommonMark regressions: ${trustedFailures.map((item) => item.example).join(', ')}`,
  )
  assert.ok(specMatches >= 580, `HTML-escaped baseline regressed: ${specMatches}/652`)
  assert.ok(
    teacherMatches >= 637,
    `HTML-disabled teacher agreement regressed: ${teacherMatches}/652`,
  )
}
