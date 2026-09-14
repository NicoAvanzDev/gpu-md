import { createRenderer } from './engine'
import type { WorkerRequest, WorkerResponse } from './playground/protocol'

const renderers = {
  auto: createRenderer(),
  cpu: createRenderer({ backend: 'cpu' }),
  gpu: createRenderer({ backend: 'gpu' }),
}

async function handle(request: WorkerRequest) {
  try {
    postMessage({
      type: 'render',
      id: request.id,
      result: await renderers[request.backend].render(request.source),
    } satisfies WorkerResponse)
  } catch (error) {
    postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse)
  }
}
let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue
    .then(() => handle(event.data))
    .catch(() => {
      // A closed message channel must not poison the worker queue.
    })
}
