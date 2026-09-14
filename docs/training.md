# Training and model provenance

Requires [uv](https://docs.astral.sh/uv/) and a CUDA-capable NVIDIA GPU with a compatible driver. The locked PyTorch build uses CUDA 12.8.

```sh
uv sync
npm run train
```

Training defaults to **CUDA and fails if CUDA is unavailable**. It does not silently train on the CPU. An explicit CPU experiment can be run with `uv run python scripts/train.py --device cpu` after generating the dataset.

The included model was trained with PyTorch 2.11.0+cu128 on an **NVIDIA RTX 1000 Ada Generation Laptop GPU**, for 70 epochs in approximately 8 seconds. The exact training device, seed, versions, counts, and scores are stored in `src/engine/model.json`.

Training produces:

- `.training/model.pt`: PyTorch state dictionary and model dimensions.
- `src/engine/model.json`: portable int8 weights, per-tensor scales, and training metadata.
- `.training/parity.json`: CUDA inference results used to verify the browser export.

`scripts/dataset.ts` generates 1,800 synthetic training documents and separately seeded validation and test sets of 300 documents each. markdown-it supplies labels for block candidates; container and paragraph context is resolved during assembly. The test set is not used to select the checkpoint; validation agreement selects the checkpoint. All three sets share the same generation templates, so the test score is **not evidence of real-document generalization**. CommonMark examples are used to develop and test the parser, not as model training rows. Training and evaluation use no downloaded language model.

## Validate training changes without replacing release weights

Python scripts run only through their `main()` entrypoints. Exports validate dataset dimensions and write JSON atomically. Use explicit output paths for experiments:

```sh
uv run python scripts/train.py --device cpu --epochs 1 \
  --model-output /tmp/gpu-md-smoke/model.json \
  --artifacts-dir /tmp/gpu-md-smoke
```

This is a training smoke test, not a replacement for the included CUDA-trained model. Run `npm run train:cpu` only when you intend to regenerate the dataset and replace the bundled model with a full CPU training run. Model changes require rerunning unit, conformance, package, and browser parity checks.
