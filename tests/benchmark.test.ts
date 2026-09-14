import test from 'node:test'
import assert from 'node:assert/strict'
import {
  benchmarkSource,
  measureEngines,
  BENCHMARK_RUNS,
  BENCHMARK_WARMUPS,
  LARGE_BENCHMARK_CHARACTERS,
} from '../src/benchmark'
import { samples } from '../src/samples'

test('large benchmark builds one complete Markdown file of at least 5.56M characters', () => {
  const { source, repeat } = benchmarkSource(samples['Field notes'], 'large')
  assert.ok(source.length >= LARGE_BENCHMARK_CHARACTERS)
  assert.ok(source.length < LARGE_BENCHMARK_CHARACTERS + samples['Field notes'].length + 2)
  assert.equal(source, Array(repeat).fill(samples['Field notes'].trimEnd()).join('\n\n') + '\n')
  assert.equal(source.split('\n').length, 177981)
  assert.equal(benchmarkSource(samples['Field notes'], 100).source.length, 128099)
})

test('benchmark size guard rejects invalid or oversized workloads before expansion', () => {
  for (const repeat of [NaN, Infinity, -1, 0, 1.5, 1_000_000])
    assert.throws(() => benchmarkSource('# Heading', repeat))
  assert.throws(() => benchmarkSource('   ', 'large'), /Enter a Markdown document/)
  assert.throws(() => benchmarkSource('x', 'large'), /larger document/)
  assert.throws(() => benchmarkSource('x'.repeat(100_000), 100), /8 million/)
})

test('benchmark excludes warm-ups, keeps the median run stages, and reports HTML disagreement', async () => {
  const calls = [0, 0]
  const result = await measureEngines(
    calls.map((_, i) => ({
      name: `engine ${i}`,
      run: async () => {
        calls[i]++
        return {
          html: i === 0 ? 'correct' : 'different',
          timings: { features: calls[i], inference: 0, assemble: 0, total: 0 },
        }
      },
    })),
    'correct',
  )
  assert.deepEqual(calls, [BENCHMARK_RUNS + BENCHMARK_WARMUPS, BENCHMARK_RUNS + BENCHMARK_WARMUPS])
  assert.deepEqual(
    result.map((engine) => engine.matchesReference),
    [true, false],
  )
  for (const engine of result) {
    assert.equal(engine.runs.length, BENCHMARK_RUNS)
    assert.ok(engine.runs.every((run) => run.timings!.features > BENCHMARK_WARMUPS))
    const median = engine.runs.slice().sort((a, b) => a.total - b.total)[3]
    assert.equal(engine.representative, median)
    assert.equal(engine.median, median.total)
  }
})

test('benchmark rejects a renderer that changes output after warm-up', async () => {
  let calls = 0
  await assert.rejects(
    measureEngines(
      [
        {
          name: 'gpu',
          verifyHTML: true,
          run: async () => ({ html: ++calls <= BENCHMARK_WARMUPS ? 'correct' : 'different' }),
        },
      ],
      'correct',
    ),
    /HTML mismatch: gpu/,
  )
})
