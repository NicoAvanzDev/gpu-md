# Benchmark methodology and historical recordings

The reports in this repository were recorded before the release refactor. Their build hashes identify those builds; they are not measurements of the current source. Re-run on verified hardware before updating performance claims. The playground intentionally displays the recorded dataset.

The recorded optimized build used sparse model evaluation, pooled GPU buffers, one fused dispatch, direct plain-text emission, and less repeated parsing. Model weights and CommonMark scores are unchanged. The browser identifies the actual GPU vendor in the status and benchmark rows.

Historical measurements on the NVIDIA RTX 1000 Ada laptop GPU in Edge 152 on Windows (seven-run medians; same browser, source, and output):

| Workload                                  | Previous GPU renderer | Optimized GPU renderer | markdown-it |
| ----------------------------------------- | --------------------: | ---------------------: | ----------: |
| Field notes ×100 (128k characters)        |               30.5 ms |                10.0 ms |      7.9 ms |
| 100 distinct variations (131k characters) |               27.4 ms |                 7.8 ms |      7.0 ms |
| Field notes ×1000 (1.28M characters)      |              250.1 ms |                60.3 ms |     74.3 ms |

These measurements show a 3.1–4.1× improvement over the previous GPU renderer for the repeated-document workloads. The large workload beats markdown-it in this run; the smaller ones do not. See [`performance.json`](../performance.json) for all workloads, stage timings, and build hashes. The separate PyTorch CUDA run measured 0.17 ms resident inference and 0.76 ms including transfers for 4,100 lines; those are inference-only figures.

```sh
npm run build
npm run benchmark           # default headless browser uses SwiftShader
npm run benchmark:cuda      # actual NVIDIA PyTorch/CUDA; inference-only timings

# Attach to a hardware browser already listening on its isolated debugging port:
GPU_MD_CDP=9224 GPU_MD_EXPECT_VENDOR=nvidia npm run benchmark

# Refresh the fixed graph from a new verified hardware measurement:
GPU_MD_CDP=9224 GPU_MD_EXPECT_VENDOR=nvidia npm run benchmark -- --large --publish-chart
npm run build
```

The browser benchmark runs production modules on small, 100×, 1000×, distinct-document, and ~5.56M-character inputs. `performance.json` records medians, representative stage timings, adapter, and the build SHA-256. Detailed samples go to `artifacts/performance.json`. An optional `--baseline=path/to/previous-module.js` compares an older build in the same browser and verifies identical HTML; the local pre-optimization module is saved in `.training/performance-baseline/gpu-md.js`. The older build is excluded from the ~5.56M case because it retains the original 2M-character limit.

To reproduce the NVIDIA test on this dual-GPU Windows machine, launch an **isolated** Edge instance from PowerShell:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" --headless=new --remote-debugging-port=9224 --user-data-dir="$env:TEMP\gpu-md-nvidia-browser" --no-first-run --disable-extensions --enable-unsafe-webgpu --ignore-gpu-blocklist --force_high_performance_gpu --use-webgpu-power-preference=force-high-performance http://localhost:5173
```

Omit `--headless=new` from that command to open the visible demo on NVIDIA. The tested adapter reports `nvidia · lovelace` (RTX 1000 Ada). A browser's `high-performance` hint alone can still select the Intel adapter on a hybrid system; verify the reported vendor. Browser execution uses WebGPU on the NVIDIA hardware. The separate CUDA benchmark uses PyTorch CUDA graphs and pinned host buffers, and measures resident inference plus upload/inference/readback. Its numbers exclude feature extraction, HTML assembly, and any server/IPC transport; they are not complete-render times.

The browser benchmark expects the development server to be running (`npm run dev`); it imports the separately built production library. Software WebGPU is useful for correctness checks, not hardware performance claims. `--publish-chart` requires an expected vendor and rejects known software adapters. It updates only local measurement files.
