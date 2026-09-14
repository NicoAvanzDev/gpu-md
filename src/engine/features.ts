/** A generic character sketch shared by training and inference. */
export const LABELS = [
  'text',
  'blank',
  'heading',
  'fence',
  'quote',
  'bullet',
  'ordered',
  'rule',
  'table',
  'separator',
  'indented',
] as const
export type { Label } from './types.js'
export const FEATURES = 192
export const HIDDEN = 32
// Eight categorical indices replace 160 one-hot floats. Remaining features are unchanged.
export const COMPACT_FEATURES = 40
const SYMBOLS = ' #`~>-*+0.)|:=_[]a/\\'
const ascii = new Uint8Array(128)
for (let code = 0; code < 128; code++) {
  const char = String.fromCharCode(code)
  const symbol = SYMBOLS.indexOf(char)
  ascii[code] = /\s/.test(char) ? 0 : code >= 48 && code <= 57 ? 8 : symbol < 0 ? 17 : symbol
}
function category(code: number): number {
  return Number.isNaN(code)
    ? 0
    : code < 128
      ? ascii[code]
      : /\s/.test(String.fromCharCode(code))
        ? 0
        : 17
}
export function normalize(source: string): string {
  return source.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD')
}

export function sketch(lines: string[]): Float32Array {
  const result = new Float32Array(lines.length * COMPACT_FEATURES)
  const trimmed = lines.map((line) => line.trimStart())
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row],
      text = trimmed[row],
      base = row * COMPACT_FEATURES
    for (let pos = 0; pos < 8; pos++) result[base + pos] = category(text.charCodeAt(pos))
    const length = Math.min(text.length, 256),
      increment = 1 / Math.max(1, length)
    // Preserve float32 accumulation exactly as in the training feature representation.
    for (let pos = 0; pos < length; pos++)
      result[base + 8 + category(text.charCodeAt(pos))] += increment
    let indent = 0
    for (let pos = 0, end = line.length - text.length; pos < end; pos++)
      indent += line.charCodeAt(pos) === 9 ? 4 - (indent % 4) : 1
    result[base + 28] = Math.min(indent, 8) / 8
    result[base + 29] = Math.min(text.length, 128) / 128
    result[base + 30] = Number(text.length === 0)
    result[base + 31] = Number(!trimmed[row - 1])
    result[base + 32] = Number(!trimmed[row + 1])
    result[base + 33] = category(text.charCodeAt(text.length - 1)) / 19
    let run = 0
    while (run < text.length && run < 10 && text.charCodeAt(run) === text.charCodeAt(0)) run++
    result[base + 34] = run / 10
    result[base + 35] = Number(text.includes('\t'))
    result[base + 36] = Math.min(line.length - line.trimEnd().length, 4) / 4
    result[base + 37] = category(trimmed[row - 1]?.charCodeAt(0) ?? NaN) / 19
    result[base + 38] = category(trimmed[row + 1]?.charCodeAt(0) ?? NaN) / 19
    result[base + 39] = 1
  }
  return result
}

/** Dense layout retained for PyTorch training and numeric parity fixtures. */
export function featurize(lines: string[]): Float32Array {
  const compact = sketch(lines),
    dense = new Float32Array(lines.length * FEATURES)
  for (let row = 0; row < lines.length; row++) {
    const base = row * COMPACT_FEATURES,
      target = row * FEATURES
    for (let pos = 0; pos < 8; pos++) dense[target + pos * 20 + compact[base + pos]] = 1
    dense.set(compact.subarray(base + 8, base + COMPACT_FEATURES), target + 160)
  }
  return dense
}
export function compactFeatures(dense: Float32Array): Float32Array {
  if (dense.length % FEATURES) throw new Error('Invalid dense feature dimensions.')
  const compact = new Float32Array((dense.length / FEATURES) * COMPACT_FEATURES)
  for (let row = 0; row < dense.length / FEATURES; row++) {
    const source = row * FEATURES,
      target = row * COMPACT_FEATURES
    for (let pos = 0; pos < 8; pos++) {
      for (let value = 0; value < 20; value++) {
        if (dense[source + pos * 20 + value] === 1) {
          compact[target + pos] = value
          break
        }
      }
    }
    compact.set(dense.subarray(source + 160, source + FEATURES), target + 8)
  }
  return compact
}
