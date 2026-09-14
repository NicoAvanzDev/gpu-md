import { GPUClassifier } from './gpu.js'
import { createRendererWithClassifier } from './renderer.js'
import type { Renderer, RendererOptions } from './types.js'

export { modelInfo } from './metadata.js'
export { DEFAULT_LIMITS } from './input.js'
export { RendererError, type RendererErrorCode } from './errors.js'
export type {
  Backend,
  Candidate,
  Label,
  ModelInfo,
  Prediction,
  Renderer,
  RendererLimits,
  RendererOptions,
  RenderResult,
  RenderTimings,
  TrainingInfo,
} from './types.js'

/** Reuse a renderer to retain its device, compiled pipeline, and GPU buffers. */
export function createRenderer(options: RendererOptions = {}): Renderer {
  return createRendererWithClassifier(options, () => GPUClassifier.create())
}
