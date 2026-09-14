import type { RenderResult } from './engine'

export const LARGE_BENCHMARK_CHARACTERS = 5_560_000
export const BENCHMARK_LIMITS = { maxCharacters: 8_000_000, maxLines: 500_000 }
export type BenchmarkSize = number | 'large'
export function benchmarkSource(document: string, size: BenchmarkSize) {
  const unit = document.trimEnd()
  if (size === 'large' && !unit)
    throw new Error('Enter a Markdown document before running the large-file benchmark.')
  const repeat =
    size === 'large' ? Math.ceil((LARGE_BENCHMARK_CHARACTERS + 1) / (unit.length + 2)) : size
  if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > BENCHMARK_LIMITS.maxLines)
    throw new Error('Choose a larger document or a smaller repetition count.')
  if (
    (unit.length + 2) * repeat - 1 > BENCHMARK_LIMITS.maxCharacters ||
    (unit.split('\n').length + 1) * repeat > BENCHMARK_LIMITS.maxLines
  )
    throw new Error(
      'Benchmark exceeds 8 million characters or 500,000 lines. Choose a smaller size or a document with longer lines.',
    )
  return { source: Array.from({ length: repeat }, () => unit).join('\n\n') + '\n', repeat }
}

export const BENCHMARK_WARMUPS = 3
export const BENCHMARK_RUNS = 7
export const BENCHMARK_METHOD =
  'Three warm-ups; median of seven measured runs with rotating engine order. Complete Markdown-to-HTML, including features, transfers, inference and assembly; DOM excluded. No document/result cache.'

type Detail = {
  html: string
  backend?: string
  adapter?: string
  timings?: RenderResult['timings']
}
export type BenchmarkEngine = { name: string; run: () => Promise<Detail>; verifyHTML?: boolean }
export type BenchmarkRun = Omit<Detail, 'html'> & { total: number }
export type BenchmarkMeasurement = {
  name: string
  median: number
  representative: BenchmarkRun
  runs: BenchmarkRun[]
  matchesReference: boolean
}

/** Benchmark complete render calls; retain the stages from the actual median run. */
export async function measureEngines(engines: BenchmarkEngine[], referenceHTML: string) {
  const runs = engines.map(() => [] as BenchmarkRun[])
  const matchesReference: boolean[] = []
  let expectedHTML: string | undefined
  for (let warm = 0; warm < BENCHMARK_WARMUPS; warm++) {
    for (const engine of engines) {
      const result = await engine.run()
      if (engine.verifyHTML) {
        expectedHTML ??= result.html
        if (result.html !== expectedHTML) throw new Error(`HTML mismatch: ${engine.name}`)
      }
    }
  }
  for (let run = 0; run < BENCHMARK_RUNS; run++) {
    for (let offset = 0; offset < engines.length; offset++) {
      const index = (offset + run) % engines.length
      const start = performance.now()
      const result = await engines[index].run()
      const total = performance.now() - start
      if (engines[index].verifyHTML && result.html !== expectedHTML)
        throw new Error(`HTML mismatch: ${engines[index].name}`)
      runs[index].push({
        total,
        timings: result.timings,
        backend: result.backend,
        adapter: result.adapter,
      })
      matchesReference[index] = (matchesReference[index] ?? true) && result.html === referenceHTML
    }
  }
  return engines.map((engine, i): BenchmarkMeasurement => {
    const representative = runs[i].slice().sort((a, b) => a.total - b.total)[
      Math.floor(BENCHMARK_RUNS / 2)
    ]
    return {
      name: engine.name,
      median: representative.total,
      representative,
      runs: runs[i],
      matchesReference: matchesReference[i],
    }
  })
}

export interface BenchmarkWorkload {
  name: string
  characters: number
  lines: number
  sourceSHA256: string
  engines: BenchmarkMeasurement[]
}
