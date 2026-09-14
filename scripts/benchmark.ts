import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'
import { BENCHMARK_METHOD } from '../src/benchmark'

import { browserSession } from './browser-session'
import type { BenchmarkWorkload } from '../src/benchmark'
const cdp = process.env.GPU_MD_CDP
const url = process.env.GPU_MD_URL ?? 'http://localhost:5173'
const baseline = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice(11)
const largeOnly = process.argv.includes('--large')
const publishChart = process.argv.includes('--publish-chart')
if (publishChart && !process.env.GPU_MD_EXPECT_VENDOR)
  throw new Error(
    'Set GPU_MD_EXPECT_VENDOR to verify the hardware before publishing chart measurements.',
  )
const browser = browserSession('perf')
const evaluate = async (code: string) => JSON.parse(await browser('eval', code))
const workerURL = new URL('/scripts/benchmark-worker.ts', url)
workerURL.searchParams.set(largeOnly ? 'large' : 'all', '1')
if (baseline)
  workerURL.searchParams.set(
    'baseline64',
    Buffer.from('/' + baseline.replace(/^\/+/, '')).toString('base64'),
  )
await mkdir('artifacts', { recursive: true })
try {
  await browser(...(cdp ? [] : ['--webgpu']), 'open', url)
  await evaluate(
    `(()=>{window.perfResult=undefined;const w=new Worker(${JSON.stringify(workerURL.href)},{type:'module'});window.perfWorker=w;w.onmessage=e=>{if(e.data.progress)window.perfProgress=e.data.progress;else{window.perfResult=e.data;w.terminate()}};w.onerror=e=>window.perfResult={error:e.message || 'Benchmark worker failed to load. Check the dev-server log.'};return true})()`,
  )
  const deadline = Date.now() + 180_000
  while (!(await evaluate('window.perfResult !== undefined'))) {
    if (Date.now() > deadline)
      throw new Error(`Benchmark timed out: ${await evaluate('window.perfProgress')}`)
    await setTimeout(1000)
  }
  const result = (await evaluate('window.perfResult')) as {
    error?: string
    report?: BenchmarkWorkload[]
  }
  if (result.error) throw new Error(result.error)
  if (!Array.isArray(result.report))
    throw new Error(`Invalid benchmark response: ${JSON.stringify(result)}`)
  const adapter = result.report[0]?.engines.find((e) => e.name === 'current GPU')?.representative
    .adapter
  if (!adapter) throw new Error('Benchmark report has no GPU adapter.')
  if (publishChart && /swiftshader|llvmpipe|software/i.test(adapter))
    throw new Error('Chart publishing requires a hardware WebGPU adapter.')
  if (process.env.GPU_MD_EXPECT_VENDOR)
    assert.match(adapter, new RegExp(process.env.GPU_MD_EXPECT_VENDOR, 'i'))
  const digest = async (path: string) =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
  const report = {
    date: new Date().toISOString(),
    adapter,
    browser: await evaluate('navigator.userAgent'),
    method: `Production ES modules. ${BENCHMARK_METHOD}`,
    buildSHA256: await digest('lib/gpu-md.js'),
    baselineSHA256: baseline ? await digest(baseline) : undefined,
    workloads: result.report,
  }
  await writeFile('artifacts/performance.json', JSON.stringify(report, null, 2) + '\n')
  const summary = {
    ...report,
    workloads: report.workloads.map((w) => ({
      ...w,
      engines: w.engines.map(({ runs: _runs, ...e }) => e),
    })),
  }
  if (publishChart) {
    const large = report.workloads.find((workload) => workload.name === 'field-large')
    if (!large) throw new Error('Chart publishing needs the large-file workload.')
    await writeFile(
      'demo-performance.json',
      JSON.stringify({ ...report, workloads: [large] }, null, 2) + '\n',
    )
  }
  if (!largeOnly) await writeFile('performance.json', JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
} finally {
  await browser('close')
}
