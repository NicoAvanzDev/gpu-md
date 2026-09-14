/** WebGPU reports allocation/validation failures asynchronously, not only by throwing. */
export async function withGPUErrorScopes<T>(
  device: GPUDevice,
  operation: () => Promise<T>,
): Promise<T> {
  device.pushErrorScope('validation')
  device.pushErrorScope('out-of-memory')
  device.pushErrorScope('internal')
  let value: T | undefined
  let failure: { error: unknown } | undefined
  try {
    value = await operation()
  } catch (error) {
    failure = { error }
  }
  // Pop every scope even when the operation fails, so later requests stay balanced.
  const errors = await Promise.all([
    device.popErrorScope(),
    device.popErrorScope(),
    device.popErrorScope(),
  ])
  if (failure) throw failure.error
  const gpuError = errors.find((error) => error !== null)
  if (gpuError) throw new Error(`WebGPU operation failed: ${gpuError.message}`, { cause: gpuError })
  return value as T
}
