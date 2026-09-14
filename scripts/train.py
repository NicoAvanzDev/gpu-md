"""Train on CUDA with PyTorch; export int8 weights for our WGSL/JS runtime.

uv run python scripts/train.py --device cuda
CPU training requires explicit --device cpu; unavailable CUDA is an error.
"""

import argparse
import base64
import json
import os
import time
import tempfile
from pathlib import Path

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
import numpy as np
import torch
from torch import nn


def write_json(path: Path, value: object) -> None:
    """Replace exports atomically so an interrupted write cannot corrupt model weights."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--epochs", type=int, default=70)
    parser.add_argument(
        "--model-output",
        type=Path,
        help="Override the exported JSON path (useful for validation runs).",
    )
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        help="Override the checkpoint and parity output directory.",
    )
    args = parser.parse_args()
    if args.epochs < 1:
        parser.error("--epochs must be positive")
    if args.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit(
            "CUDA is required but unavailable. Install a CUDA PyTorch build and check nvidia-smi. CPU training requires explicit --device cpu."
        )

    root = Path(__file__).resolve().parent.parent
    config = json.loads((root / ".training/config.json").read_text())
    F, H, C = config["features"], config.get("hidden", 32), len(config["labels"])
    artifacts = args.artifacts_dir or root / ".training"
    artifacts.mkdir(parents=True, exist_ok=True)
    model_output = args.model_output or root / "src/engine/model.json"
    model_output.parent.mkdir(parents=True, exist_ok=True)
    seed = 20260909
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)
    torch.set_num_threads(2)
    device = torch.device(args.device)
    device_name = torch.cuda.get_device_name() if device.type == "cuda" else "CPU"
    print(f"PyTorch {torch.__version__} | {device} | {device_name}", flush=True)

    def dataset(name):
        x = np.fromfile(root / f".training/{name}.f32", dtype=np.float32).reshape(-1, F)
        y = np.fromfile(root / f".training/{name}.labels", dtype=np.uint8).astype(
            np.int64
        )
        if (
            len(x) == 0
            or len(x) != len(y)
            or not np.isfinite(x).all()
            or np.any(y >= C)
        ):
            raise ValueError(f"Invalid {name} dataset dimensions, features, or labels.")
        return torch.from_numpy(x).to(device), torch.from_numpy(y).to(device)

    x, y = dataset("train")
    vx, vy = dataset("validation")
    tx, ty = dataset("test")
    network = nn.Sequential(nn.Linear(F, H), nn.ReLU(), nn.Linear(H, C)).to(device)
    optimizer = torch.optim.AdamW(network.parameters(), lr=0.003, weight_decay=0.0001)
    class_weights = torch.bincount(y, minlength=C).clamp(min=1).float().rsqrt()
    class_weights /= class_weights.mean()
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    best, best_state = -1.0, None
    started = time.perf_counter()
    for epoch in range(args.epochs):
        network.train()
        order = torch.randperm(len(x), device=device)
        for group in optimizer.param_groups:
            group["lr"] = 0.003 * (0.25 + 0.75 * (1 - epoch / args.epochs))
        for indices in order.split(512):
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(network(x[indices]), y[indices])
            loss.backward()
            optimizer.step()
        network.eval()
        with torch.inference_mode():
            accuracy = (network(vx).argmax(1) == vy).float().mean().item()
        if accuracy > best:
            best = accuracy
            best_state = {
                key: value.detach().clone()
                for key, value in network.state_dict().items()
            }
        if epoch % 10 == 0 or epoch == args.epochs - 1:
            print(
                f"epoch {epoch + 1}: validation line agreement {accuracy:.4%}",
                flush=True,
            )

    network.load_state_dict(best_state)
    if device.type == "cuda":
        torch.cuda.synchronize()
    training_seconds = time.perf_counter() - started
    torch.save(
        {
            "state_dict": {k: v.cpu() for k, v in best_state.items()},
            "features": F,
            "hidden": H,
            "labels": config["labels"],
            "seed": seed,
        },
        artifacts / "model.pt",
    )

    # PyTorch Linear stores [output,input]; the browser uses [input,output].
    tensors = [
        network[0].weight.T,
        network[0].bias,
        network[2].weight.T,
        network[2].bias,
    ]
    packed, scales, dequantized = [], [], []
    for tensor in tensors:
        p = tensor.detach()
        scale = p.abs().max().item() / 127 or 1
        q = (p / scale).round().clamp(-127, 127).to(torch.int8)
        packed.append(q.contiguous().cpu().numpy().tobytes())
        scales.append(scale)
        dequantized.append(q.float() * scale)

    @torch.inference_mode()
    def predict(features):
        return (
            (features @ dequantized[0] + dequantized[1]).relu() @ dequantized[2]
            + dequantized[3]
        ).argmax(1)

    validation = predict(vx)
    test = predict(tx)
    # Small numeric fixture checks the exported browser inference against actual CUDA predictions.
    with torch.inference_mode():
        logits = (tx[:64] @ dequantized[0] + dequantized[1]).relu() @ dequantized[
            2
        ] + dequantized[3]
        probabilities = logits.softmax(dim=1)
        candidate_confidence, candidate_labels = probabilities.topk(2, dim=1)
        parity = {
            "features": tx[:64].cpu().tolist(),
            "labels": candidate_labels[:, 0].cpu().tolist(),
            "confidence": candidate_confidence[:, 0].cpu().tolist(),
            "candidateLabels": candidate_labels.cpu().tolist(),
            "candidateConfidence": candidate_confidence.cpu().tolist(),
        }
        write_json(artifacts / "parity.json", parity)
    model = {
        "version": 1,
        "features": F,
        "hidden": H,
        "labels": config["labels"],
        "parameters": sum(p.numel() for p in network.parameters()),
        "scales": scales,
        "weights": base64.b64encode(b"".join(packed)).decode(),
        "training": {
            "seed": seed,
            "documents": config.get("documents", {}).get("train", 1800),
            "lines": len(y),
            "epochs": args.epochs,
            "framework": "PyTorch",
            "torchVersion": torch.__version__,
            "device": str(device),
            "gpu": device_name,
            "cudaVersion": torch.version.cuda,
            "seconds": training_seconds,
            "teacher": config.get("teacher", "markdown-it 15.0.1"),
            "corpus": "synthetic",
            "validationDocuments": config.get("documents", {}).get("validation", 300),
            "validationLines": len(vy),
            "lineAgreement": (validation == vy).float().mean().item(),
            "testDocuments": config.get("documents", {}).get("test", 300),
            "testLines": len(ty),
            "testLineAgreement": (test == ty).float().mean().item(),
            "perClass": {
                name: {
                    "lines": (ty == i).sum().item(),
                    "agreement": (test[ty == i] == i).float().mean().item(),
                }
                for i, name in enumerate(config["labels"])
            },
        },
    }
    write_json(model_output, model)
    print(
        f"Exported {model['parameters']:,} int8 parameters; held-out synthetic test line agreement {model['training']['testLineAgreement']:.4%}; training {training_seconds:.1f}s on {device_name}",
        flush=True,
    )


if __name__ == "__main__":
    main()
