# Changelog

## 0.1.0 — Unreleased

- Prepare the ESM library for packaging with explicit exports, TypeScript declarations, bundled dependencies, and third-party notices.
- Separate renderer lifecycle, public contracts, validation, GPU error handling, block syntax, inline syntax, and model metadata.
- Validate runtime options and input; snapshot options to protect the HTML trust boundary.
- Drain accepted work on disposal, make cleanup idempotent, and recover required-GPU renderers after device failures.
- Capture asynchronous WebGPU validation, allocation, and internal errors; release partially allocated buffers.
- Separate playground presentation, controller, worker protocol, request coalescing, and styles. Add stale-result suppression, worker timeouts, and retry behavior.
- Self-host playground fonts and support static hosting under a subdirectory.
- Add isolated package-consumer verification, lifecycle/worker regression tests, CI, and development/production browser checks.
- Pin CommonMark corpus integrity and keep verification separate from report publication.
- Give Python tooling explicit entrypoints and isolated training outputs; write JSON exports atomically.
- License the project under MIT and add public repository metadata and private vulnerability reporting instructions.

The bundled model weights and historical performance recordings are unchanged.
