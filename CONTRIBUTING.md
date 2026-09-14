# Contributing

Use Node 24 (`nvm use`) and install the lockfile with `npm ci`. Python 3.11–3.13 and `uv` are optional unless changing training or CUDA tooling.

The supported library API lives in `src/engine/index.ts`; keep exported contracts in `types.ts`. Use `.js` relative import specifiers inside the engine so emitted declarations resolve in both NodeNext and bundler projects. Keep browser UI code out of the engine. Parser changes must preserve the CommonMark baseline and HTML escaping guarantees.

Run from the repository root:

```sh
npm run format
npm run validate
npx --no-install agent-browser install
npm run test:browser
npm run test:production
```

`test:browser` manages its own server unless `GPU_MD_URL` points to an existing one. Hardware verification can attach to an isolated browser with `GPU_MD_CDP` and assert the adapter using `GPU_MD_EXPECT_VENDOR`. See [benchmark documentation](docs/benchmarks.md).

Use focused regression tests for behavioral changes, especially input boundaries, lifecycle, GPU failure handling, stale worker responses, and unsafe URLs. `tests/lifecycle.test.ts` injects a classifier through an internal boundary to exercise device failures without hardware. Package verification installs a real tarball in a temporary directory and compiles independent TypeScript consumers.

`npm run test:conformance` uses the pinned CommonMark fixture and writes diagnostics to `.training/evaluation.json`; it does not update the published summary. Use `npm run evaluate` deliberately when refreshing that summary. The corpus downloads on first use, with a timeout and an integrity check.

Model training changes require the explicit training workflow and numeric/browser parity verification. Preserve historical benchmark JSON files unless recording a new measurement with adapter, source hash, build hash, and raw samples. See [training](docs/training.md) for isolated output paths that protect the release model during experiments.

Generated output belongs in ignored `lib/`, `dist/`, `.training/`, or `artifacts/`. Keep local environments, credentials, screenshots, and training binaries out of release tarballs. `package.json#files` and the package smoke test enforce the release contents.
