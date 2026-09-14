/** Requested execution backend. Auto falls back to the same model on the CPU. */
export type Backend = 'auto' | 'cpu' | 'gpu'

export type Label =
  | 'text'
  | 'blank'
  | 'heading'
  | 'fence'
  | 'quote'
  | 'bullet'
  | 'ordered'
  | 'rule'
  | 'table'
  | 'separator'
  | 'indented'

export interface Candidate {
  label: Label
  /** Uncalibrated softmax score, between zero and one. */
  confidence: number
}
export interface Prediction extends Candidate {
  /** The first and second choices, before syntax validation. */
  candidates: [Candidate, Candidate]
}
export interface RendererLimits {
  /** Maximum UTF-16 code units before normalization. Default: 2,000,000. */
  maxCharacters?: number
  /** Maximum normalized lines, including a trailing empty line. Default: 50,000. */
  maxLines?: number
}
export interface RendererOptions {
  backend?: Backend
  /** Pass source HTML through without sanitizing it. Only enable for trusted input. */
  allowHtml?: boolean
  limits?: RendererLimits
}
export interface RenderTimings {
  features: number
  inference: number
  assemble: number
  /** Milliseconds, including initialization but excluding queue wait and DOM insertion. */
  total: number
}
export interface RenderResult {
  html: string
  predictions: Prediction[]
  backend: 'cpu' | 'gpu'
  adapter: string
  fallbackReason?: string
  timings: RenderTimings
}
export interface Renderer {
  /** Requests run in submission order. A rejected request does not poison the queue. */
  render(source: string): Promise<RenderResult>
  /** Stop accepting requests, drain accepted work, and release resources. Idempotent. */
  destroy(): Promise<void>
}
export interface TrainingInfo {
  seed: number
  documents: number
  lines: number
  epochs: number
  framework: string
  torchVersion: string
  device: string
  gpu: string
  cudaVersion: string | null
  seconds: number
  teacher: string
  corpus: string
  validationDocuments: number
  validationLines: number
  lineAgreement: number
  testDocuments: number
  testLines: number
  testLineAgreement: number
  perClass: Record<Label, { lines: number; agreement: number }>
}
export interface ModelInfo {
  parameters: number
  bytes: number
  architecture: string
  training: TrainingInfo
}
