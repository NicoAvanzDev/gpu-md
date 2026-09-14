import type { RenderResult } from '../src/engine/index'
import { measureEngines, benchmarkSource, BENCHMARK_LIMITS } from '../src/benchmark'
const { createRenderer } = await import(
  /* @vite-ignore */ new URL('/lib/gpu-md.js', location.origin).href
)
import { samples } from '../src/samples'
import MarkdownIt from 'markdown-it'
const options = new URL(location.href).searchParams
const reference = new MarkdownIt({ html: false, xhtmlOut: true })
const currentGPU = createRenderer({ backend: 'gpu', limits: BENCHMARK_LIMITS })
const baselineURL = options.get('baseline64') ? atob(options.get('baseline64')!) : undefined
const baselineRenderer = baselineURL
  ? (await import(/* @vite-ignore */ new URL(baselineURL, location.origin).href)).createRenderer
  : undefined
const oldGPU = baselineRenderer?.({ backend: 'gpu' })
const repeated = (source: string, count: number) => benchmarkSource(source, count).source
const cases = options.get('large')
  ? [['field-large', benchmarkSource(samples['Field notes'], 'large').source]]
  : options.get('all')
    ? [
        ['field-1', samples['Field notes']],
        ['field-100', repeated(samples['Field notes'], 100)],
        ['kitchen-100', repeated(samples['Kitchen sink'], 100)],
        [
          'distinct-100',
          Array.from({ length: 100 }, (_, i) =>
            samples['Field notes'].replaceAll('model', `model ${i}`).replaceAll('GPU', `GPU ${i}`),
          ).join('\n\n'),
        ],
        ['field-1000', repeated(samples['Field notes'], 1000)],
        ['field-large', benchmarkSource(samples['Field notes'], 'large').source],
      ]
    : [['field-100', repeated(samples['Field notes'], 100)]]
const engines: {
  name: string
  renderer: { render: (source: string) => Promise<Partial<RenderResult> & { html: string }> }
}[] = [
  ...(baselineRenderer ? [{ name: 'baseline GPU', renderer: oldGPU }] : []),
  { name: 'current GPU', renderer: currentGPU },
  {
    name: 'markdown-it',
    renderer: {
      render: async (source: string) => ({
        html: reference.render(source),
        adapter: 'markdown-it',
      }),
    },
  },
]
try {
  const report = []
  for (const [name, source] of cases) {
    postMessage({ progress: name })
    // Older saved builds retain the original 2M-character input limit.
    const supported = engines.filter(
      (engine) => name !== 'field-large' || !engine.name.startsWith('baseline'),
    )
    const measured = await measureEngines(
      supported.map((engine) => ({
        name: engine.name,
        run: () => engine.renderer.render(source),
        verifyHTML: engine.name !== 'markdown-it',
      })),
      reference.render(source),
    )
    report.push({
      name,
      characters: source.length,
      lines: source.split('\n').length,
      sourceSHA256: Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join(''),
      engines: measured,
    })
  }
  postMessage({ report })
} catch (error) {
  postMessage({ error: String(error) })
} finally {
  await Promise.all([currentGPU, oldGPU].filter(Boolean).map((r) => r.destroy()))
}
