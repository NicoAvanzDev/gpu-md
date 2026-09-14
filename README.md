# gpu-md

Markdown rendering with a compact neural classifier, WebGPU acceleration, and a CPU fallback. A PyTorch-trained model proposes line roles; a JavaScript parser validates those predictions and assembles HTML. Rendering runs locally, with no inference service.

This remains an experimental parser: the bundled model passes all **652 CommonMark 0.31.2 examples** when source HTML is explicitly enabled, but that finite regression suite does not guarantee correctness for arbitrary documents. Source HTML is **escaped by default**. See [correctness and limits](docs/correctness.md).

## Run the playground

Use Node.js **22.12+ within 22.x, or 24+**. Node 24 is recorded in `.nvmrc`.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The trained model and fonts are included. Python and CUDA are needed only for training and CUDA benchmarks. WebGPU requires a supported browser on HTTPS or localhost; auto mode reports a CPU fallback when it is unavailable.

The playground supports live editing, samples, Markdown file import, preview/HTML/prediction views, backend selection, and HTML export. Its performance graph displays a historical hardware measurement; it does not benchmark your device on page load.

## Use the library

Build a local release candidate and install the resulting tarball in a consuming project:

```sh
npm run build
npm pack
# In the consuming project:
npm install /path/to/gpu-md/gpu-md-0.1.0.tgz
```

```ts
import { createRenderer, type RendererOptions } from 'gpu-md'

const options: RendererOptions = { backend: 'auto' }
const renderer = createRenderer(options)

try {
  const result = await renderer.render('# Hello, GPU')
  console.log(result.html) // <h1>Hello, GPU</h1>\n
  console.log(result.backend, result.fallbackReason, result.timings)
} finally {
  await renderer.destroy()
}
```

The ESM package includes TypeScript declarations and bundled runtime dependencies. Use `backend: 'cpu'` in Node or `backend: 'gpu'` to require WebGPU. The standalone browser module is `lib/gpu-md.js`; the deployable playground is `dist/`.

Reuse a renderer across documents. Requests are serialized; `destroy()` drains accepted work and releases resources. Default limits are **2,000,000 UTF-16 code units** and **50,000 normalized lines**. Input validation happens before feature allocation. [API reference](docs/api.md) documents options, results, errors, and lifecycle behavior.

`allowHtml: true` passes source HTML through **without sanitizing it**. Use it only with trusted documents or sanitize the resulting HTML before insertion. Generated URLs and attributes are checked in both modes. See [security boundaries](SECURITY.md).

## Verify changes

```sh
npm run validate         # types, format, unit tests, conformance, builds, package, Python syntax
npx --no-install agent-browser install
npm run test:browser     # starts/stops an isolated dev server; CPU/WebGPU and full UI checks
npm run test:production  # verifies the built site, including /demo/ subdirectory hosting
```

Browser verification uses software WebGPU on Linux. It checks actual WGSL execution and candidate parity, not hardware performance. Reports and screenshots are written to `artifacts/`. GitHub Actions runs validation on Node 22 and 24 and browser verification on Node 24.

## Documentation

- [API reference](docs/api.md)
- [Architecture and source layout](docs/architecture.md)
- [Correctness and measured limits](docs/correctness.md)
- [Training and model provenance](docs/training.md)
- [Historical benchmarks and reproduction](docs/benchmarks.md)
- [Contributing](CONTRIBUTING.md), [release procedure](docs/releasing.md), and [changelog](CHANGELOG.md)

Inspired by [gpu-lexer](https://gpu-lexer.vercel.app/). The included model has 6,539 int8 parameters; this weight count is not the size of the complete renderer bundle. Training metadata is available through `modelInfo`.

## License status

A project license has not yet been selected. The package is marked `UNLICENSED`; choose and add the intended license before a public release. Bundled dependencies retain their own licenses in [third-party notices](THIRD_PARTY_NOTICES.md).
