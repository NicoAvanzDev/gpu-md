import { mkdir, writeFile } from 'node:fs/promises'
import { featurize } from '../src/engine/features'
import { samples } from '../src/samples'
const source =
  Array.from({ length: 100 }, () => samples['Field notes'].trimEnd()).join('\n\n') + '\n'
const features = featurize(source.split('\n'))
await mkdir('.training', { recursive: true })
await writeFile('.training/benchmark.f32', new Uint8Array(features.buffer))
console.log(`CUDA input: ${source.length} characters, ${features.length / 192} lines`)
