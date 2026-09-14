import { spawn } from 'node:child_process'
import { createServer } from 'vite'

// Use an isolated ephemeral port unless the caller explicitly supplies an existing server.
const server = process.env.GPU_MD_URL
  ? undefined
  : await createServer({
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
try {
  await server?.listen()
  const url = process.env.GPU_MD_URL ?? server?.resolvedUrls?.local[0]
  if (!url) throw new Error('Could not determine the browser test server URL.')
  console.log(`Browser verification: ${url}`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/verify-browser.ts'], {
      stdio: 'inherit',
      env: { ...process.env, GPU_MD_URL: url },
    })
    child.once('error', reject)
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`Browser verification failed (${signal ?? code}).`)),
    )
  })
} finally {
  await server?.close()
}
