import type { Backend, RenderResult } from '../engine/types'

export type WorkerRequest = { type: 'render'; id: number; source: string; backend: Backend }
export type WorkerResponse =
  | { type: 'render'; id: number; result: RenderResult }
  | { type: 'error'; id: number; message: string }
export type RenderInput = Pick<WorkerRequest, 'source' | 'backend'>
