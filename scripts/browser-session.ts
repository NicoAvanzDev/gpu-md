import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Isolate browser automation from personal browser sessions and bound subprocess waits. */
export function browserSession(purpose: string) {
  const session = `gpu-md-${purpose}-${process.pid}`
  const cdp = process.env.GPU_MD_CDP
  return async (...args: string[]): Promise<string> => {
    const { stdout } = await exec(
      'npx',
      [
        '--no-install',
        'agent-browser',
        '--session',
        session,
        ...(cdp ? ['--cdp', cdp] : []),
        ...args,
      ],
      { maxBuffer: 4_000_000, timeout: 120_000 },
    )
    return stdout
  }
}
