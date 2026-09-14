import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, modelInfo } from '../src/engine/index.ts'
import { inline } from '../src/engine/inline.ts'
import { samples } from '../src/samples.ts'

const renderer = createRenderer({ backend: 'cpu' })
const render = async (source: string) => (await renderer.render(source)).html

test('bundled weights came from CUDA PyTorch training', () => {
  assert.equal(modelInfo.training.framework, 'PyTorch')
  assert.equal(modelInfo.training.device, 'cuda')
  assert.equal(modelInfo.parameters, 6539)
  assert.ok(modelInfo.training.testLineAgreement > 0.95)
})
test('empty input and newline normalization', async () => {
  assert.equal(await render(''), '')
  assert.equal(await render('\r\n\r\n'), '')
  assert.equal(await render('# Hello\r\n\r\nWorld\r'), '<h1>Hello</h1>\n<p>World</p>\n')
})
test('all heading levels and literal seven-hash text', async () => {
  for (let level = 1; level <= 6; level++)
    assert.equal(await render(`${'#'.repeat(level)} Hello`), `<h${level}>Hello</h${level}>\n`)
  assert.equal(await render('####### Hello'), '<p>####### Hello</p>\n')
  assert.equal(await render('## Hello ##'), '<h2>Hello</h2>\n')
})
test('paragraphs, setext headings, and rules', async () => {
  assert.equal(await render('Hello\nworld\n\nAgain'), '<p>Hello\nworld</p>\n<p>Again</p>\n')
  assert.equal(await render('Hello\n==='), '<h1>Hello</h1>\n')
  assert.equal(await render('Hello\n---'), '<h2>Hello</h2>\n')
  for (const source of ['---', '***', '___', '* * *'])
    assert.equal(await render(source), '<hr />\n')
})
test('code fences override line predictions and preserve literal code', async () => {
  assert.equal(
    await render('```js\n# heading\n<script>\n```'),
    '<pre><code class="language-js"># heading\n&lt;script&gt;\n</code></pre>\n',
  )
  assert.equal(await render('````\n```\n# code\n````'), '<pre><code>```\n# code\n</code></pre>\n')
  assert.equal(await render('~~~\n# code\n~~~'), '<pre><code># code\n</code></pre>\n')
})
test('unclosed fences and longer/shorter/mismatched closing fences', async () => {
  assert.equal(await render('```\nhello\n'), '<pre><code>hello\n</code></pre>\n')
  assert.equal(await render('```\nhello'), '<pre><code>hello\n</code></pre>\n')
  assert.equal(await render('```\nhello\n~~~'), '<pre><code>hello\n~~~\n</code></pre>\n')
  assert.equal(await render('```\nhello\n````'), '<pre><code>hello\n</code></pre>\n')
})
test('nested lists and ordered start offsets', async () => {
  assert.equal(await render('- one\n- two'), '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n')
  assert.equal(
    await render('3. three\n4. four'),
    '<ol start="3">\n<li>three</li>\n<li>four</li>\n</ol>\n',
  )
  const nested = await render('- one\n  - child\n- two')
  assert.match(nested, /<li>one\n<ul>\n<li>child<\/li>/)
  assert.equal((nested.match(/<ul>/g) ?? []).length, 2)
})
test('loose list items retain paragraphs', async () => {
  const html = await render('- one\n\n- two')
  assert.match(html, /<li>\n<p>one<\/p>/)
  assert.match(html, /<li>\n<p>two<\/p>/)
})
test('tasks emit disabled controls', async () => {
  const html = await render('- [x] done\n- [ ] todo')
  assert.match(html, /type="checkbox" disabled checked/)
  assert.match(html, /type="checkbox" disabled> todo/)
})
test('nested quotes and indented code', async () => {
  assert.equal(
    await render('> quote\n>\n> > nested'),
    '<blockquote>\n<p>quote</p>\n<blockquote>\n<p>nested</p>\n</blockquote>\n</blockquote>\n',
  )
  assert.equal(await render('    # code'), '<pre><code># code\n</code></pre>\n')
})
test('tables preserve alignment, inline code pipes, and escaped pipes', async () => {
  const html = await render('| Name | Value |\n| :--- | ---: |\n| a\\|b | `x|y` |')
  assert.match(html, /<table>/)
  assert.match(html, /<th style="text-align:right">Value<\/th>/)
  assert.match(html, /<td style="text-align:left">a\|b<\/td>/)
  assert.match(html, /<code>x\|y<\/code>/)
})
test('inline formatting, escapes, code spans, and Unicode', () => {
  assert.equal(
    inline('**bold** *italic* ~~gone~~'),
    '<strong>bold</strong> <em>italic</em> <del>gone</del>',
  )
  assert.equal(inline('`**literal**`'), '<code>**literal**</code>')
  assert.equal(inline('\\*literal\\*'), '*literal*')
  assert.equal(inline('snake_case_name 世界 🚀'), 'snake_case_name 世界 🚀')
  assert.equal(inline('``a ` b``'), '<code>a ` b</code>')
})
test('links allow balanced URLs and escape attributes', () => {
  assert.equal(
    inline('[docs](https://example.com/a_(b))'),
    '<a href="https://example.com/a_(b)">docs</a>',
  )
  assert.equal(
    inline('[**docs**](/docs "A title")'),
    '<a href="/docs" title="A title"><strong>docs</strong></a>',
  )
  assert.match(
    inline('![alt](https://example.com/x.png)'),
    /<img src="https:\/\/example.com\/x.png" alt="alt" \/>/,
  )
})
test('raw HTML and dangerous destinations never become executable HTML', async () => {
  const unsafe = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,test',
    'vbscript:test',
    '//evil.example',
    'java\tscript:test',
    'jav&#x61;script:alert(1)',
    'javascript&colon;alert(1)',
    'java&#10;script:alert(1)',
  ]
  for (const url of unsafe) {
    assert.doesNotMatch(inline(`[test](${url})`), /<a /)
    assert.doesNotMatch(inline(`![test](${url})`), /<img /)
  }
  const html = await render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
  assert.doesNotMatch(html, /<script|<img/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(
    await render('```x" onmouseover="alert(1)\nhello\n```'),
    /class="[^"]*" onmouseover=/,
  )
})
test('all bundled demos render their main structures', async () => {
  const field = await render(samples['Field notes'])
  for (const tag of ['<h1>', '<h2>', '<ol>', '<blockquote>', '<pre>', '<table>'])
    assert.ok(field.includes(tag), `Missing ${tag}`)
  const kitchen = await render(samples['Kitchen sink'])
  for (const tag of ['<h1>', '<ul>', '<ol start="3">', '<table>', '<del>'])
    assert.ok(kitchen.includes(tag), `Missing ${tag}`)
})
test('CPU predictions expose finite confidence and timing', async () => {
  const result = await renderer.render('# Hello\n\nA paragraph.')
  assert.equal(result.backend, 'cpu')
  assert.equal(result.predictions[0].label, 'heading')
  for (const prediction of result.predictions) {
    assert.ok(prediction.confidence > 0 && prediction.confidence <= 1)
    assert.equal(prediction.candidates.length, 2)
    assert.equal(prediction.candidates[0].label, prediction.label)
    assert.equal(prediction.candidates[0].confidence, prediction.confidence)
    assert.notEqual(prediction.candidates[0].label, prediction.candidates[1].label)
    assert.ok(prediction.candidates[1].confidence <= prediction.confidence)
    assert.ok(prediction.candidates[1].confidence >= 0)
  }
  assert.ok(result.timings.total >= result.timings.inference)
})
test('automatic fallback is visible and required WebGPU fails without it', async () => {
  const auto = createRenderer()
  const result = await auto.render('# Hello')
  assert.equal(result.backend, 'cpu')
  assert.match(result.fallbackReason!, /WebGPU/)
  await auto.destroy()
  const gpu = createRenderer({ backend: 'gpu' })
  await assert.rejects(gpu.render('# Hello'), /WebGPU/)
  await gpu.destroy()
})
test('concurrent requests retain their own outputs; destroy prevents reuse', async () => {
  const instance = createRenderer({ backend: 'cpu' })
  const results = await Promise.all(['A', 'B', 'C'].map((text) => instance.render(`# ${text}`)))
  assert.deepEqual(
    results.map((result) => result.html),
    ['<h1>A</h1>\n', '<h1>B</h1>\n', '<h1>C</h1>\n'],
  )
  await instance.destroy()
  await assert.rejects(instance.render('D'), /destroyed/)
})
test('input limits fail before allocating large feature buffers', async () => {
  await assert.rejects(renderer.render('a'.repeat(2_000_001)), /characters/)
  await assert.rejects(renderer.render('\n'.repeat(50_000)), /lines/)
})

test('larger render limits preserve references across a whole file', async () => {
  const large = createRenderer({
    backend: 'cpu',
    limits: { maxCharacters: 3_000_000, maxLines: 60_000 },
  })
  try {
    const source = '[link][end]\n' + '\n'.repeat(50_000) + '[end]: /last\n'
    await assert.rejects(renderer.render(source), /lines/)
    assert.equal((await large.render(source)).html, '<p><a href="/last">link</a></p>\n')
    await assert.rejects(large.render('\n'.repeat(60_000)), /60,000 lines/)
    await assert.rejects(large.render('a'.repeat(3_000_001)), /3,000,000 source characters/)
  } finally {
    await large.destroy()
  }
  for (const value of [0, -1, NaN, Infinity, 1.5])
    assert.throws(() => createRenderer({ limits: { maxLines: value } }), /positive safe integers/)
})

test('forward, collapsed, shortcut, and container references share definitions', async () => {
  assert.equal(
    await render('[one][id] [id][] [ID]\n\n> [id]: /docs "A &amp; B"'),
    '<p><a href="/docs" title="A &amp; B">one</a> <a href="/docs" title="A &amp; B">id</a> <a href="/docs" title="A &amp; B">ID</a></p>\n<blockquote>\n</blockquote>\n',
  )
  assert.doesNotMatch(await render('[unsafe]\n\n[unsafe]: jav&#x61;script:alert(1)'), /<a /)
})

test('source HTML is an explicit opt-in; generated attributes remain escaped', async () => {
  const trusted = createRenderer({ backend: 'cpu', allowHtml: true })
  try {
    assert.equal(
      (await trusted.render('<div>\n*literal*\n</div>')).html,
      '<div>\n*literal*\n</div>\n',
    )
    assert.equal(
      (await trusted.render('An <i>inline</i> tag.')).html,
      '<p>An <i>inline</i> tag.</p>\n',
    )
    assert.equal(
      await render('An <i>inline</i> tag.'),
      '<p>An &lt;i&gt;inline&lt;/i&gt; tag.</p>\n',
    )
    assert.equal(
      (await trusted.render('[link](/safe "&quot; onmouseover=&quot;x")')).html,
      '<p><a href="/safe" title="&quot; onmouseover=&quot;x">link</a></p>\n',
    )
  } finally {
    await trusted.destroy()
  }
})

test('large unmatched delimiters and deeply nested emphasis render without recursion', () => {
  const unmatched = '*a '.repeat(20_000).trim()
  assert.equal(inline(unmatched), unmatched)
  const count = 10_000
  assert.equal(
    inline('*'.repeat(count * 2) + 'x' + '*'.repeat(count * 2)),
    '<strong>'.repeat(count) + 'x' + '</strong>'.repeat(count),
  )
})

test('long lazy continuations preserve blockquote scope', async () => {
  const continuation = Array.from({ length: 5000 }, (_, i) => `Continuation ${i}`).join('\n')
  assert.equal(
    await render(`> Start\n${continuation}`),
    `<blockquote>\n<p>Start\n${continuation}</p>\n</blockquote>\n`,
  )
})

test('unmatched backtick runs of different lengths stay literal', () => {
  const source = Array.from({ length: 700 }, (_, i) => '`'.repeat(i + 1) + 'x').join(' ')
  assert.equal(inline(source), source)
})
