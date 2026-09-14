import { sketch } from './features.js'
import { classifyCompact } from './model.js'
import { assemble } from './render.js'
import { RendererError } from './errors.js'
import { resolveOptions, sourceLines, validateSource } from './input.js'
import type { Prediction, Renderer, RendererOptions, RenderResult } from './types.js'

/** Internal boundary for testing device failures without exposing GPU objects in the API. */
export interface Classifier {
  readonly adapter: string
  predictCompact(features: Float32Array): Promise<Prediction[]>
  destroy(): void
}

export function createRendererWithClassifier(
  options: RendererOptions,
  createClassifier: () => Promise<Classifier>,
): Renderer {
  const settings = resolveOptions(options)
  let gpu: Classifier | undefined
  let initialized = false
  let fallbackReason: string | undefined
  let closed = false
  let queue: Promise<void> = Promise.resolve()
  let disposal: Promise<void> | undefined

  function releaseGPU() {
    const current = gpu
    gpu = undefined
    current?.destroy()
  }
  function gpuFailure(error: unknown) {
    releaseGPU()
    fallbackReason = error instanceof Error ? error.message : String(error)
    if (settings.backend === 'gpu') {
      initialized = false // A later request can recover from a transient device failure.
      throw new RendererError('GPU_UNAVAILABLE', fallbackReason, { cause: error })
    }
  }
  async function render(source: string): Promise<RenderResult> {
    const start = performance.now()
    const lines = sourceLines(source)
    if (!initialized) {
      initialized = true
      if (settings.backend !== 'cpu') {
        try {
          gpu = await createClassifier()
          fallbackReason = undefined
        } catch (error) {
          gpuFailure(error)
        }
      }
    }
    const featureStart = performance.now()
    const features = sketch(lines)
    const inferenceStart = performance.now()
    let predictions: Prediction[]
    if (gpu) {
      try {
        predictions = await gpu.predictCompact(features)
      } catch (error) {
        gpuFailure(error)
        predictions = classifyCompact(features)
      }
    } else predictions = classifyCompact(features)
    const assembleStart = performance.now()
    const html = assemble(lines, predictions, { allowHtml: settings.allowHtml })
    const end = performance.now()
    return {
      html,
      predictions,
      backend: gpu ? 'gpu' : 'cpu',
      adapter: gpu?.adapter ?? 'JavaScript · same quantized model',
      fallbackReason,
      timings: {
        features: inferenceStart - featureStart,
        inference: assembleStart - inferenceStart,
        assemble: end - assembleStart,
        total: end - start,
      },
    }
  }
  return {
    render(source) {
      if (closed)
        return Promise.reject(new RendererError('DESTROYED', 'This renderer has been destroyed.'))
      try {
        validateSource(source, settings)
      } catch (error) {
        return Promise.reject(error)
      }
      const result = queue.then(() => render(source))
      queue = result.then(
        () => {},
        () => {},
      )
      return result
    },
    destroy() {
      closed = true
      return (disposal ??= queue.then(releaseGPU))
    },
  }
}
