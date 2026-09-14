import { shader } from './shader.js'
import { withGPUErrorScopes } from './gpu-errors.js'
import { COMPACT_FEATURES, LABELS, compactFeatures } from './features.js'
import { weights, type Prediction } from './model.js'

export class GPUClassifier {
  private capacity = 0
  private buffers: GPUBuffer[] = []
  private bindGroup?: GPUBindGroup
  private lost = false
  private constructor(
    private device: GPUDevice,
    private weightBuffer: GPUBuffer,
    private pipeline: GPUComputePipeline,
    readonly adapter: string,
    private maxRows: number,
  ) {}

  static async create(): Promise<GPUClassifier> {
    if (typeof navigator === 'undefined' || !navigator.gpu)
      throw new Error('WebGPU is unavailable in this browser.')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter is available.')
    const device = await adapter.requestDevice()
    try {
      return await withGPUErrorScopes(device, async () => {
        const module = device.createShaderModule({ code: shader, label: 'gpu-md fused classifier' })
        const messages = await module.getCompilationInfo()
        const errors = messages.messages.filter((message) => message.type === 'error')
        if (errors.length) throw new Error(errors.map((error) => error.message).join('\n'))
        const pipeline = await device.createComputePipelineAsync({
          layout: 'auto',
          compute: { module, entryPoint: 'classify' },
        })
        const weightBuffer = device.createBuffer({
          size: weights.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
        device.queue.writeBuffer(weightBuffer, 0, weights as Float32Array<ArrayBuffer>)
        const info = adapter.info
        const result = new GPUClassifier(
          device,
          weightBuffer,
          pipeline,
          [info.vendor, info.architecture].filter(Boolean).join(' · ') || 'WebGPU adapter',
          Math.floor(
            Math.min(
              device.limits.maxStorageBufferBindingSize / (COMPACT_FEATURES * 4),
              device.limits.maxBufferSize / (COMPACT_FEATURES * 4),
              device.limits.maxComputeWorkgroupsPerDimension * 4,
            ) / 4,
          ) * 4,
        )
        if (result.maxRows < 4)
          throw new Error('WebGPU adapter limits cannot fit an inference batch.')
        void device.lost.then(() => {
          result.lost = true
        })
        return result
      })
    } catch (error) {
      device.destroy()
      throw error
    }
  }

  /** Compatibility entrypoint for the dense PyTorch feature fixtures. */
  predict(features: Float32Array): Promise<Prediction[]> {
    return this.predictCompact(compactFeatures(features))
  }

  private reserve(rows: number) {
    if (rows <= this.capacity) return
    if (rows > this.maxRows) throw new Error('GPU batch exceeds adapter limits.')
    const capacity = Math.min(this.maxRows, 2 ** Math.ceil(Math.log2(Math.max(64, rows))))
    const buffers: GPUBuffer[] = []
    const make = (size: number, usage: GPUBufferUsageFlags) => {
      const buffer = this.device.createBuffer({ size, usage })
      buffers.push(buffer)
      return buffer
    }
    try {
      const input = make(
        capacity * COMPACT_FEATURES * 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      )
      const output = make(capacity * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)
      make(capacity * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)
      const size = make(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
      const bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: input } },
          { binding: 1, resource: { buffer: this.weightBuffer } },
          { binding: 2, resource: { buffer: output } },
          { binding: 3, resource: { buffer: size } },
        ],
      })
      this.buffers.forEach((buffer) => buffer.destroy())
      this.buffers = buffers
      this.bindGroup = bindGroup
      this.capacity = capacity
    } catch (error) {
      buffers.forEach((buffer) => buffer.destroy())
      throw error
    }
  }

  async predictCompact(features: Float32Array): Promise<Prediction[]> {
    if (this.lost) throw new Error('The WebGPU device was lost during inference.')
    const rows = features.length / COMPACT_FEATURES
    if (!Number.isInteger(rows)) throw new Error('Invalid compact feature dimensions.')
    if (!rows) return []
    if (rows <= this.maxRows) return this.predictBatch(features, rows)
    // Only inference is batched. Features retain neighboring lines across batches,
    // and HTML assembly still sees the entire document, including references.
    const predictions: Prediction[] = []
    for (let start = 0; start < rows; start += this.maxRows) {
      const end = Math.min(rows, start + this.maxRows)
      const batch = await this.predictBatch(
        features.subarray(start * COMPACT_FEATURES, end * COMPACT_FEATURES),
        end - start,
      )
      for (const prediction of batch) predictions.push(prediction)
    }
    return predictions
  }

  private async predictBatch(features: Float32Array, rows: number): Promise<Prediction[]> {
    if (this.lost) throw new Error('The WebGPU device was lost during inference.')
    return withGPUErrorScopes(this.device, async () => {
      this.reserve(rows)
      const [input, output, readback] = this.buffers
      this.device.queue.writeBuffer(input, 0, features as Float32Array<ArrayBuffer>)
      this.device.queue.writeBuffer(this.buffers[3], 0, new Uint32Array([rows, 0, 0, 0]))
      const encoder = this.device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, this.bindGroup!)
      pass.dispatchWorkgroups(Math.ceil(rows / 4))
      pass.end()
      encoder.copyBufferToBuffer(output, 0, readback, 0, rows * 16)
      this.device.queue.submit([encoder.finish()])
      try {
        await readback.mapAsync(GPUMapMode.READ, 0, rows * 16)
        if (this.lost) throw new Error('The WebGPU device was lost during inference.')
        const values = new Float32Array(readback.getMappedRange(0, rows * 16))
        return Array.from({ length: rows }, (_, row) => {
          const first = { label: LABELS[values[row * 4]], confidence: values[row * 4 + 1] }
          return {
            ...first,
            candidates: [
              first,
              { label: LABELS[values[row * 4 + 2]], confidence: values[row * 4 + 3] },
            ],
          }
        })
      } finally {
        if (readback.mapState === 'mapped') readback.unmap()
      }
    })
  }

  destroy() {
    this.lost = true
    this.buffers.forEach((buffer) => buffer.destroy())
    this.weightBuffer.destroy()
    this.device.destroy()
  }
}
