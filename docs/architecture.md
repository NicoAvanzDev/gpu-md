# Architecture

```text
Training:  synthetic Markdown → markdown-it labels → PyTorch / CUDA → int8 weights
Browser:   source → line features → WebGPU MLP → two candidate roles → parser → DOM
```

- **192 logical inputs:** eight categorical positions, character histograms, length, indentation, and neighboring-line features. Inference stores the same information as 40 values (160 bytes per line instead of 768). Weight lookups replace multiplication by one-hot vectors; the trained weights and feature values are unchanged.
- **32 hidden units:** a linear layer and ReLU, followed by an 11-class linear layer and softmax.
- **6,539 parameters:** 6.4 KiB of raw int8 weights, plus scales and metadata. This is the weight size, not the entire renderer bundle size.
- **11 line roles:** text, blank, heading, fence, quote, bullet, ordered, rule, table, separator, and indented code.
- **One fused WGSL pass per batch:** four lines per workgroup, shared hidden activations, and both candidate labels and scores. Batch capacity follows the adapter's buffer and dispatch limits (262,140 lines on the tested NVIDIA adapter). Larger inputs split only the inference work; features keep their neighboring-line context and HTML assembly sees the entire file. Input/output buffers and bind groups are reused and grow only when needed.
- **Constrained decoding:** the parser checks the two predicted block markers and falls back to paragraph text if neither is valid. Context resolves fence boundaries, list tightness, indentation, and lazy continuation. Nested containers use the same sparse classifier on the CPU when a valid block marker is possible. Plain lines bypass that redundant inference because every non-text candidate would be rejected. Setext headings, reference definitions, HTML blocks, and inline syntax have deterministic handling.
- **Inline parsing:** bracket and delimiter stacks handle emphasis, code spans, links, images, and autolinks. Plain text is emitted directly; complex inlines resolve after all reference definitions are collected. Backtick lookup and lazy-continuation fence tracking avoid repeated suffix/prefix scans. Runtime dependencies `entities` and `mdurl` supply entity decoding and URL encoding; the renderer does not call markdown-it. markdown-it is used for training, evaluation, and the command-line benchmark; the playground does not load it.

The playground runs the pipeline in a worker. WebGPU computes line predictions; HTML creation and browser layout still run on the CPU. Weights are stored as int8 and dequantized once; shader arithmetic is float32. There is no inference server. The playground bundles its fonts locally; it makes no inference or font-service requests. Markdown images can still fetch their destination URLs.

## Source layout

- `src/engine/index.ts`: supported public API and exported types.
- `types.ts`, `errors.ts`, `input.ts`: API contracts, error codes, limits, and input validation.
- `renderer.ts`: serialized lifecycle and backend fallback.
- `features.ts`, `model.ts`, `metadata.ts`: compact sketches, validated weights, CPU inference, and training metadata.
- `gpu.ts`, `gpu-errors.ts`, `shader.ts`: device lifecycle, pooled buffers, asynchronous errors, and compute shader.
- `render.ts`, `block-syntax.ts`: contextual block assembly and syntax recognition.
- `inline.ts`, `inline-syntax.ts`, `html.ts`: delimiters, references, URL restrictions, and source HTML handling.
- `src/playground/`: page template, UI controller, worker protocol, and request coalescing.
- `src/styles/`: ordered stylesheets; `src/style.css` preserves their cascade.
- `scripts/`: evaluation, browser/package verification, dataset generation, training, and benchmarks.

The public declarations do not expose WebGPU or browser DOM types. CPU rendering works in Node. The browser UI imports metadata independently, so it does not initialize a second classifier on the main thread.
