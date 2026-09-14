"""Measure the exported model on NVIDIA CUDA, separate from browser/HTML timings.

Generate .training/benchmark.f32 with the dense 192-feature layout before running.
"""

import base64
import json
import statistics
import time
from pathlib import Path

import numpy as np
import torch


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is required; this benchmark never falls back to CPU.")
    model = json.loads((root / "src/engine/model.json").read_text())
    f, h, c = model["features"], model["hidden"], len(model["labels"])
    x_cpu = torch.from_numpy(
        np.fromfile(root / ".training/benchmark.f32", dtype=np.float32).reshape(-1, f)
    ).pin_memory()
    packed = (
        torch.tensor(
            list(base64.b64decode(model["weights"])), dtype=torch.uint8, device="cuda"
        )
        .view(torch.int8)
        .float()
    )
    parts, offset = [], 0
    for size, scale in zip([f * h, h, h * c, c], model["scales"]):
        parts.append(packed[offset : offset + size] * scale)
        offset += size
    w1, b1, w2, b2 = parts[0].reshape(f, h), parts[1], parts[2].reshape(h, c), parts[3]
    x_gpu = x_cpu.to("cuda")

    @torch.inference_mode()
    def infer(x):
        return ((x @ w1 + b1).relu() @ w2 + b2).softmax(1).topk(2, dim=1)

    with torch.inference_mode():
        for _ in range(10):
            infer(x_gpu)
        torch.cuda.synchronize()
        graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(graph):
            scores, labels = infer(x_gpu)
        scores_cpu = torch.empty(scores.shape, dtype=scores.dtype, pin_memory=True)
        labels_cpu = torch.empty(labels.shape, dtype=labels.dtype, pin_memory=True)
        device_ms, roundtrip_ms = [], []
        for _ in range(50):
            start, end = (
                torch.cuda.Event(enable_timing=True),
                torch.cuda.Event(enable_timing=True),
            )
            start.record()
            graph.replay()
            end.record()
            end.synchronize()
            device_ms.append(start.elapsed_time(end))
            started = time.perf_counter()
            x_gpu.copy_(x_cpu, non_blocking=True)
            graph.replay()
            scores_cpu.copy_(scores, non_blocking=True)
            labels_cpu.copy_(labels, non_blocking=True)
            torch.cuda.synchronize()
            roundtrip_ms.append((time.perf_counter() - started) * 1000)
    report = {
        "gpu": torch.cuda.get_device_name(),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "lines": len(x_cpu),
        "runs": 50,
        "residentInferenceMs": statistics.median(device_ms),
        "uploadInferenceReadbackMs": statistics.median(roundtrip_ms),
        "method": "PyTorch CUDA graph, float32 exported model, pinned host buffers",
        "scope": "Model inference only; excludes Markdown feature extraction, HTML assembly, and any server/IPC transport.",
    }
    (root / "artifacts").mkdir(exist_ok=True)
    (root / "artifacts/cuda-performance.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
