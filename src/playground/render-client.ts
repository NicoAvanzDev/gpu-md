import type { RenderResult } from '../engine/types'
import type { RenderInput, WorkerRequest, WorkerResponse } from './protocol'

export interface RenderWorker {
  postMessage(request: WorkerRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}

/** Keep at most one active request and the newest edit; never display an obsolete result. */
export function createRenderClient(
  createWorker: () => RenderWorker,
  callbacks: {
    result(value: RenderResult, input: RenderInput): void
    error(message: string): void
  },
  timeout = 30_000,
) {
  let worker: RenderWorker | undefined
  let revision = 0
  let active: WorkerRequest | undefined
  let pending: WorkerRequest | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function resetWorker() {
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
      worker = undefined
    }
  }
  function fail(message: string) {
    clearTimeout(timer)
    const current = active
    active = undefined
    resetWorker()
    if (current?.id === revision) callbacks.error(message)
    pump()
  }
  function pump() {
    if (active || !pending) return
    active = pending
    pending = undefined
    try {
      if (!worker) {
        worker = createWorker()
        worker.onmessage = (event) => {
          const message = event.data
          if (!active || message.id !== active.id) return
          clearTimeout(timer)
          const current = active
          active = undefined
          if (message.id === revision) {
            if (message.type === 'render') callbacks.result(message.result, current)
            else callbacks.error(message.message)
          }
          pump()
        }
        worker.onerror = (event) => {
          event.preventDefault()
          fail('The rendering worker failed. Edit the document or select a sample to retry.')
        }
        worker.onmessageerror = () => fail('The rendering worker returned an unreadable response.')
      }
      timer = setTimeout(
        () => fail('Rendering timed out. Try a smaller document or the CPU backend.'),
        timeout,
      )
      worker.postMessage(active)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  }
  return {
    request(input: RenderInput) {
      pending = { type: 'render', id: ++revision, ...input }
      pump()
    },
    invalidate() {
      revision++
      pending = undefined
    },
    dispose() {
      revision++
      pending = active = undefined
      clearTimeout(timer)
      resetWorker()
    },
  }
}
