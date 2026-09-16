import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { preview } from 'vite'
import { browserSession, captureBrowserFailure } from './browser-session'

// Exercise the actual emitted worker/assets, including a static-host subdirectory.
const server = await preview({
  base: '/demo/',
  preview: { host: '127.0.0.1', port: 0, strictPort: false },
})
const browser = browserSession('production')
try {
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('Could not determine the production preview URL.')
  await browser('--webgpu', 'open', url)
  await browser('wait', '--fn', '!!document.querySelector("#preview h1")')
  // Auto mode may legitimately fall back during adapter startup. Require GPU explicitly
  // so the built worker must execute WebGPU and reports a concrete error if it cannot.
  await browser('select', '#backend', 'gpu')
  await browser('fill', '#source', '# Production WebGPU\n\n**Built worker**')
  await browser(
    'wait',
    '--fn',
    'document.querySelector("#preview h1")?.textContent === "Production WebGPU" || document.querySelector("#status").textContent === "Render failed"',
  )
  assert.match(
    await browser('get', 'text', '#status'),
    /WebGPU/,
    await browser('get', 'text', '#notice'),
  )
  await browser('snapshot', '-i')
  await browser('select', '#backend', 'cpu')
  await browser('fill', '#source', '# Production build\n\n**Local assets**')
  await browser(
    'wait',
    '--fn',
    'document.querySelector("#preview h1")?.textContent === "Production build" && document.querySelector("#status").textContent.includes("CPU")',
  )
  const report = JSON.parse(
    await browser(
      'eval',
      `({
    url: location.href,
    title: document.querySelector('#preview h1').textContent,
    bold: document.querySelector('#preview strong').textContent,
    worker: performance.getEntriesByType('resource').some(r => /worker-.*\\.js/.test(r.name)),
    externalResources: performance.getEntriesByType('resource').filter(r => new URL(r.name).origin !== location.origin).map(r => r.name),
    overlay: !!document.querySelector('vite-error-overlay'),
  })`,
    ),
  ) as {
    url: string
    title: string
    bold: string
    worker: boolean
    externalResources: string[]
    overlay: boolean
  }
  assert.match(report.url, /\/demo\/$/)
  assert.equal(report.title, 'Production build')
  assert.equal(report.bold, 'Local assets')
  assert.equal(report.worker, true)
  assert.deepEqual(report.externalResources, [])
  assert.equal(report.overlay, false)
  assert.equal((await browser('errors')).trim(), '')
  await mkdir('artifacts', { recursive: true })
  await browser('screenshot', 'artifacts/release-production.png', '--full')
  await writeFile(
    'artifacts/production-verification.json',
    JSON.stringify({ passed: true, ...report }, null, 2) + '\n',
  )
  console.log(
    'Production playground verified: emitted worker, local assets, subdirectory hosting, editing, and no browser errors.',
  )
} catch (error) {
  await captureBrowserFailure(browser, 'production')
  throw error
} finally {
  try {
    await browser('close')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    )
  }
}
