export type RendererErrorCode = 'INVALID_INPUT' | 'INPUT_LIMIT' | 'DESTROYED' | 'GPU_UNAVAILABLE'

/** Stable codes let callers handle failures without matching human-readable messages. */
export class RendererError extends Error {
  override readonly name = 'RendererError'
  constructor(
    readonly code: RendererErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
