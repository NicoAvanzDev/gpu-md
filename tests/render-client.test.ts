import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderClient, type RenderWorker } from '../src/playground/render-client'
import type { WorkerRequest, WorkerResponse } from '../src/playground/protocol'
import type { RenderResult } from '../src/engine/types'

function fixture(timeout?: number) {
  const workers: (RenderWorker & { requests: WorkerRequest[]; terminated: boolean })[] = []
  const results: string[] = [],
    errors: string[] = []
  const client = createRenderClient(
    () => {
      const worker = {
        requests: [] as WorkerRequest[],
        terminated: false,
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        postMessage(request: WorkerRequest) {
          this.requests.push(request)
        },
        terminate() {
          this.terminated = true
        },
      }
      workers.push(worker)
      return worker
    },
    { result: (_, input) => results.push(input.source), error: (message) => errors.push(message) },
    timeout,
  )
  const request = (source: string) => client.request({ source, backend: 'cpu' })
  const respond = (workerIndex: number, requestIndex: number) => {
    const worker = workers[workerIndex]
    const response: WorkerResponse = {
      type: 'render',
      id: worker.requests[requestIndex].id,
      result: {} as RenderResult,
    }
    worker.onmessage?.({ data: response } as MessageEvent<WorkerResponse>)
  }
  return { client, workers, request, respond, results, errors }
}

test('rapid edits keep only the newest pending request and suppress stale output', () => {
  const f = fixture()
  try {
    f.request('first')
    f.request('second')
    f.request('third')
    assert.equal(f.workers[0].requests.length, 1)
    f.respond(0, 0)
    assert.deepEqual(f.results, [])
    assert.deepEqual(
      f.workers[0].requests.map((request) => request.source),
      ['first', 'third'],
    )
    f.respond(0, 1)
    assert.deepEqual(f.results, ['third'])
  } finally {
    f.client.dispose()
  }
})

test('edits during debounce invalidate old results before submitting a new request', () => {
  const f = fixture()
  try {
    f.request('old')
    f.client.invalidate()
    f.respond(0, 0)
    assert.deepEqual(f.results, [])
    f.request('new')
    f.respond(0, 1)
    assert.deepEqual(f.results, ['new'])
  } finally {
    f.client.dispose()
  }
})

test('worker crashes clear the active request and the next edit starts a new worker', () => {
  const f = fixture()
  try {
    f.request('before crash')
    f.workers[0].onerror?.({ preventDefault() {} } as ErrorEvent)
    assert.equal(f.workers[0].terminated, true)
    assert.equal(f.errors.length, 1)
    f.request('recovered')
    f.respond(1, 0)
    assert.deepEqual(f.results, ['recovered'])
  } finally {
    f.client.dispose()
  }
})

test('unresponsive workers time out and are terminated', async () => {
  const f = fixture(10)
  try {
    f.request('stalled')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.match(f.errors[0], /timed out/)
    assert.equal(f.workers[0].terminated, true)
    f.request('retry')
    f.respond(1, 0)
    assert.deepEqual(f.results, ['retry'])
  } finally {
    f.client.dispose()
  }
})

test('dispose releases the worker and allows a restored page to create another', () => {
  const f = fixture()
  f.request('old')
  f.client.dispose()
  f.client.dispose()
  assert.equal(f.workers[0].terminated, true)
  f.request('restored')
  f.respond(1, 0)
  assert.deepEqual(f.results, ['restored'])
  f.client.dispose()
})

test('worker construction failures are reported without leaving a stuck request', () => {
  const errors: string[] = []
  const client = createRenderClient(
    () => {
      throw new Error('Worker unavailable')
    },
    {
      result() {
        assert.fail('Unexpected result')
      },
      error: (message) => errors.push(message),
    },
  )
  client.request({ source: 'first', backend: 'auto' })
  client.request({ source: 'retry', backend: 'auto' })
  assert.deepEqual(errors, ['Worker unavailable', 'Worker unavailable'])
  client.dispose()
})
