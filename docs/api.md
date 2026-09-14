# API reference

The supported entrypoint is `gpu-md` (ESM). Internal source modules are not package exports. No WebGPU or DOM type packages are needed to consume the declarations.

## `createRenderer(options?): Renderer`

| Option                 | Default     | Behavior                                                                                                               |
| ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `backend`              | `'auto'`    | `'auto'`, `'cpu'`, or `'gpu'`. Auto falls back to the same quantized CPU model after initialization or device failure. |
| `allowHtml`            | `false`     | Enables unsanitized source HTML only when explicitly `true`.                                                           |
| `limits.maxCharacters` | `2_000_000` | Positive safe integer; counts UTF-16 code units before normalization.                                                  |
| `limits.maxLines`      | `50_000`    | Positive safe integer; CRLF and CR normalize to LF, and a trailing newline adds an empty line.                         |

Invalid options throw `TypeError` or `RangeError` synchronously. Options are copied at creation; mutating the original object cannot change the HTML trust boundary or limits. `DEFAULT_LIMITS` exposes frozen defaults.

## `renderer.render(source): Promise<RenderResult>`

`source` must be a string. Empty input is valid. The result includes:

| Field            | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `html`           | Rendered fragment, without a document wrapper or CSS.                   |
| `predictions`    | One prediction per normalized line, including any trailing empty line.  |
| `backend`        | Actual backend: `'cpu'` or `'gpu'`.                                     |
| `adapter`        | Descriptive adapter or CPU identifier, not a stable machine identifier. |
| `fallbackReason` | Reason auto mode switched to CPU, when applicable.                      |
| `timings`        | `features`, `inference`, `assemble`, and `total` in milliseconds.       |

Each prediction exposes `label`, `confidence`, and a two-element `candidates` tuple in score order. These are model proposals, before the parser checks syntax and context. Confidence is an uncalibrated softmax score.

`total` starts when the queued request begins and includes normalization and first-use initialization. It excludes input validation, time waiting in the request queue, and DOM insertion. `inference` includes GPU upload and readback. Stage totals may be smaller than `total`.

Concurrent calls run in submission order. A rejected call does not prevent later calls from completing. Auto mode retains CPU fallback after a device failure; create a new renderer to retry WebGPU. Required-GPU mode rejects on failure and retries device initialization on the next call.

## `renderer.destroy(): Promise<void>`

Stops accepting work immediately, waits for all previously accepted requests, and releases the GPU device and buffers. Repeated calls return the same disposal promise. It does not interrupt accepted requests. For untrusted workloads requiring cancellation or a hard time budget, run the renderer in a worker you can terminate; the playground uses this approach.

## Errors

Rendering rejects with `RendererError` for supported boundary failures. Inspect `.code` instead of matching the message:

| Code              | Meaning                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `INVALID_INPUT`   | Source is not a string.                                                                      |
| `INPUT_LIMIT`     | Character or line limit exceeded.                                                            |
| `DESTROYED`       | A request was submitted after disposal began.                                                |
| `GPU_UNAVAILABLE` | Required WebGPU initialization or inference failed; `.cause` preserves the underlying error. |

Unexpected internal exceptions can still reject a request. Constructor option errors are native `TypeError`/`RangeError`, not `RendererError`.

```ts
import { createRenderer, RendererError } from 'gpu-md'

const renderer = createRenderer({ backend: 'gpu' })
try {
  await renderer.render('# Required WebGPU')
} catch (error) {
  if (error instanceof RendererError && error.code === 'GPU_UNAVAILABLE') {
    console.error('WebGPU failed:', error.message)
  } else {
    throw error
  }
} finally {
  await renderer.destroy()
}
```

## Metadata and exported types

`modelInfo` contains parameter count, raw quantized weight bytes, architecture, and training provenance. It is descriptive metadata, not a current benchmark result.

Exported types: `Backend`, `Candidate`, `Label`, `ModelInfo`, `Prediction`, `Renderer`, `RendererLimits`, `RendererOptions`, `RenderResult`, `RenderTimings`, `TrainingInfo`, and `RendererErrorCode`.
