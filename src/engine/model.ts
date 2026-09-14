import model from './model.json'
import { FEATURES, HIDDEN, LABELS, COMPACT_FEATURES, compactFeatures } from './features.js'

import type { Candidate, Prediction } from './types.js'
export type { Candidate, Prediction } from './types.js'

export { modelInfo } from './metadata.js'

if (
  model.version !== 1 ||
  model.features !== FEATURES ||
  model.hidden !== HIDDEN ||
  JSON.stringify(model.labels) !== JSON.stringify(LABELS) ||
  model.parameters !== FEATURES * HIDDEN + HIDDEN + HIDDEN * LABELS.length + LABELS.length ||
  model.scales.length !== 4 ||
  !model.scales.every((scale) => Number.isFinite(scale) && scale > 0)
)
  throw new Error('Bundled model dimensions or quantization metadata are invalid.')
const bytes = Uint8Array.from(atob(model.weights), (char) => char.charCodeAt(0))
if (bytes.length !== model.parameters) throw new Error('Bundled model weights are truncated.')
const signed = new Int8Array(bytes.buffer)
export const weights = new Float32Array(signed.length)
export const OFFSETS = [
  0,
  FEATURES * HIDDEN,
  FEATURES * HIDDEN + HIDDEN,
  FEATURES * HIDDEN + HIDDEN + HIDDEN * LABELS.length,
]
const sizes = [FEATURES * HIDDEN, HIDDEN, HIDDEN * LABELS.length, LABELS.length]
for (let part = 0; part < 4; part++) {
  for (let i = OFFSETS[part]; i < OFFSETS[part] + sizes[part]; i++)
    weights[i] = signed[i] * model.scales[part]
}

export function classifyCPU(features: Float32Array): Prediction[] {
  return classifyCompact(compactFeatures(features))
}

export function classifyCompact(features: Float32Array): Prediction[] {
  if (features.length % COMPACT_FEATURES) throw new Error('Invalid compact feature dimensions.')
  const predictions: Prediction[] = []
  const hidden = new Float32Array(HIDDEN)
  const active = new Uint32Array(HIDDEN)
  const logits = new Float32Array(LABELS.length)
  const indices = new Uint32Array(32),
    values = new Float32Array(32)
  for (let row = 0; row < features.length / COMPACT_FEATURES; row++) {
    const base = row * COMPACT_FEATURES
    const p0 = features[base] * HIDDEN,
      p1 = (20 + features[base + 1]) * HIDDEN,
      p2 = (40 + features[base + 2]) * HIDDEN,
      p3 = (60 + features[base + 3]) * HIDDEN,
      p4 = (80 + features[base + 4]) * HIDDEN,
      p5 = (100 + features[base + 5]) * HIDDEN,
      p6 = (120 + features[base + 6]) * HIDDEN,
      p7 = (140 + features[base + 7]) * HIDDEN
    let count = 0
    for (let f = 0; f < 32; f++) {
      const value = features[base + 8 + f]
      if (value !== 0) {
        indices[count] = (160 + f) * HIDDEN
        values[count++] = value
      }
    }
    let activeCount = 0
    for (let h = 0; h < HIDDEN; h++) {
      let value =
        weights[OFFSETS[1] + h] +
        weights[p0 + h] +
        weights[p1 + h] +
        weights[p2 + h] +
        weights[p3 + h] +
        weights[p4 + h] +
        weights[p5 + h] +
        weights[p6 + h] +
        weights[p7 + h]
      for (let f = 0; f < count; f++) value += values[f] * weights[indices[f] + h]
      hidden[h] = Math.max(0, value)
      if (hidden[h] !== 0) active[activeCount++] = h
    }
    for (let c = 0; c < LABELS.length; c++) {
      let value = weights[OFFSETS[3] + c]
      for (let i = 0; i < activeCount; i++) {
        const h = active[i]
        value += hidden[h] * weights[OFFSETS[2] + h * LABELS.length + c]
      }
      logits[c] = value
    }
    let best = 0
    for (let c = 1; c < logits.length; c++) if (logits[c] > logits[best]) best = c
    let sum = 0
    for (const logit of logits) sum += Math.exp(logit - logits[best])
    let second = best === 0 ? 1 : 0
    for (let c = 0; c < logits.length; c++) if (c !== best && logits[c] > logits[second]) second = c
    const candidates: [Candidate, Candidate] = [
      { label: LABELS[best], confidence: 1 / sum },
      { label: LABELS[second], confidence: Math.exp(logits[second] - logits[best]) / sum },
    ]
    predictions.push({ ...candidates[0], candidates })
  }
  return predictions
}
