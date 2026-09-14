import { normalize } from './features.js'
import { RendererError } from './errors.js'
import type { RendererOptions } from './types.js'

export const DEFAULT_LIMITS = Object.freeze({ maxCharacters: 2_000_000, maxLines: 50_000 })

export function resolveOptions(options: RendererOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Renderer options must be an object.')
  const backend = options.backend ?? 'auto'
  if (!['auto', 'cpu', 'gpu'].includes(backend))
    throw new TypeError('Renderer backend must be auto, cpu, or gpu.')
  if (options.allowHtml !== undefined && typeof options.allowHtml !== 'boolean')
    throw new TypeError('allowHtml must be a boolean.')
  if (
    options.limits !== undefined &&
    (!options.limits || typeof options.limits !== 'object' || Array.isArray(options.limits))
  )
    throw new TypeError('Renderer limits must be an object.')
  const maxCharacters = options.limits?.maxCharacters ?? DEFAULT_LIMITS.maxCharacters
  const maxLines = options.limits?.maxLines ?? DEFAULT_LIMITS.maxLines
  if (![maxCharacters, maxLines].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new RangeError('Renderer limits must be positive safe integers.')
  // Snapshot options: callers cannot change HTML trust or resource limits after creation.
  return { backend, allowHtml: options.allowHtml ?? false, maxCharacters, maxLines }
}

export function validateSource(
  source: string,
  limits: { maxCharacters: number; maxLines: number },
) {
  if (typeof source !== 'string')
    throw new RendererError('INVALID_INPUT', 'Markdown source must be a string.')
  if (source.length > limits.maxCharacters)
    throw new RendererError(
      'INPUT_LIMIT',
      `This renderer supports up to ${limits.maxCharacters.toLocaleString('en-US')} source characters.`,
    )
  // Count CRLF as one newline and reject before allocating the line/feature arrays.
  let lines = 1
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code !== 10 && code !== 13) continue
    if (++lines > limits.maxLines)
      throw new RendererError(
        'INPUT_LIMIT',
        `This renderer supports up to ${limits.maxLines.toLocaleString('en-US')} lines.`,
      )
    if (code === 13 && source.charCodeAt(i + 1) === 10) i++
  }
}

export function sourceLines(source: string): string[] {
  return normalize(source).split('\n')
}
