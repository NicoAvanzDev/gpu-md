import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, RendererError, type RendererOptions } from '../src/engine/index'
import { createRendererWithClassifier, type Classifier } from '../src/engine/renderer'
import { classifyCompact } from '../src/engine/model'
import { withGPUErrorScopes } from '../src/engine/gpu-errors'

function fakeClassifier(): Classifier & { disposed: number } {
  return {
    adapter: 'test adapter',
    disposed: 0,
    async predictCompact(features) {
      return classifyCompact(features)
    },
    destroy() {
      this.disposed++
    },
  }
}

test('JavaScript callers receive useful errors for invalid options and inputs', async () => {
  for (const options of [null, [], { backend: 'typo' }, { allowHtml: 'false' }, { limits: [] }])
    assert.throws(() => createRenderer(options as unknown as RendererOptions), TypeError)
  const renderer = createRenderer({ backend: 'cpu' })
  try {
    for (const source of [null, undefined, 42, {}, ['# heading']])
      await assert.rejects(renderer.render(source as unknown as string), { code: 'INVALID_INPUT' })
    assert.equal((await renderer.render('# Still usable')).html, '<h1>Still usable</h1>\n')
  } finally {
    await renderer.destroy()
  }
})

test('options are captured at creation, including the HTML trust boundary', async () => {
  const options: RendererOptions = { backend: 'cpu', allowHtml: false, limits: { maxLines: 2 } }
  const renderer = createRenderer(options)
  options.allowHtml = true
  options.limits!.maxLines = 100
  try {
    assert.equal((await renderer.render('<b>hello</b>')).html, '<p>&lt;b&gt;hello&lt;/b&gt;</p>\n')
    await assert.rejects(renderer.render('a\nb\nc'), { code: 'INPUT_LIMIT' })
  } finally {
    await renderer.destroy()
  }
})

test('line limits count LF, CRLF, lone CR and trailing empty lines consistently', async () => {
  const renderer = createRenderer({ backend: 'cpu', limits: { maxLines: 2 } })
  try {
    for (const ending of ['\n', '\r\n', '\r']) {
      assert.equal((await renderer.render(`one${ending}two`)).predictions.length, 2)
      await assert.rejects(renderer.render(`one${ending}two${ending}`), { code: 'INPUT_LIMIT' })
    }
  } finally {
    await renderer.destroy()
  }
})

test('destroy drains accepted work during initialization and rejects new submissions', async () => {
  const gpu = fakeClassifier()
  let initialize!: (value: Classifier) => void
  const renderer = createRendererWithClassifier(
    {},
    () =>
      new Promise((resolve) => {
        initialize = resolve
      }),
  )
  const first = renderer.render('# First')
  const second = renderer.render('# Second')
  await Promise.resolve()
  const disposed = renderer.destroy()
  assert.equal(renderer.destroy(), disposed)
  await assert.rejects(renderer.render('# Too late'), { code: 'DESTROYED' })
  initialize(gpu)
  assert.match((await first).html, /First/)
  assert.match((await second).html, /Second/)
  await disposed
  assert.equal(gpu.disposed, 1)
})

test('auto falls back once after device failure and frees the device', async () => {
  const gpu = fakeClassifier()
  gpu.predictCompact = async () => {
    throw new Error('Device lost')
  }
  let initializations = 0
  const renderer = createRendererWithClassifier({}, async () => {
    initializations++
    return gpu
  })
  try {
    for (let i = 0; i < 2; i++) {
      const result = await renderer.render('# Fallback')
      assert.equal(result.backend, 'cpu')
      assert.equal(result.fallbackReason, 'Device lost')
      assert.equal(result.html, '<h1>Fallback</h1>\n')
    }
    assert.equal(initializations, 1)
    assert.equal(gpu.disposed, 1)
  } finally {
    await renderer.destroy()
  }
})

test('required GPU can recover after initialization and inference failures', async () => {
  for (const stage of ['initialization', 'inference']) {
    const gpu = fakeClassifier()
    let attempts = 0
    const renderer = createRendererWithClassifier({ backend: 'gpu' }, async () => {
      if (++attempts === 1) {
        if (stage === 'initialization') throw new Error('Temporary failure')
        return {
          ...gpu,
          predictCompact: async () => {
            throw new Error('Temporary failure')
          },
        }
      }
      return gpu
    })
    try {
      await assert.rejects(
        renderer.render('# First'),
        (error) =>
          error instanceof RendererError &&
          error.code === 'GPU_UNAVAILABLE' &&
          error.cause instanceof Error,
      )
      const result = await renderer.render('# Retry')
      assert.equal(result.backend, 'gpu')
      assert.equal(result.fallbackReason, undefined)
      assert.equal(attempts, 2)
    } finally {
      await renderer.destroy()
    }
  }
})

test('invalid input is rejected before GPU initialization', async () => {
  let called = false
  const renderer = createRendererWithClassifier({ limits: { maxCharacters: 3 } }, async () => {
    called = true
    return fakeClassifier()
  })
  await assert.rejects(renderer.render('long'), { code: 'INPUT_LIMIT' })
  assert.equal(called, false)
  await renderer.destroy()
})

test('WebGPU asynchronous errors fail the operation and every scope is popped', async () => {
  const scopes: GPUErrorFilter[] = []
  const device = {
    pushErrorScope(scope: GPUErrorFilter) {
      scopes.push(scope)
    },
    async popErrorScope() {
      return scopes.pop() === 'out-of-memory' ? { message: 'Out of memory' } : null
    },
  } as unknown as GPUDevice
  await assert.rejects(
    withGPUErrorScopes(device, async () => 'unusable result'),
    /Out of memory/,
  )
  assert.equal(scopes.length, 0)
  const original = new Error('Map failed')
  await assert.rejects(
    withGPUErrorScopes(device, async () => {
      throw original
    }),
    (error) => error === original,
  )
  assert.equal(scopes.length, 0)
})
