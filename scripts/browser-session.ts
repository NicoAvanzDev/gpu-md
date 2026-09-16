import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
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

/** Preserve the page's actual failure state before the session is closed. */
export async function captureBrowserFailure(
  browser: ReturnType<typeof browserSession>,
  purpose: string,
) {
  await mkdir('artifacts', { recursive: true })
  for (const [name, args] of [
    [
      'state',
      [
        'eval',
        `({url: location.href, status: document.querySelector('#status')?.textContent,
          notice: document.querySelector('#notice')?.textContent,
          backend: document.querySelector('#backend')?.value,
          busy: document.querySelector('#playground')?.getAttribute('aria-busy'),
          preview: document.querySelector('#preview')?.innerHTML,
          resources: performance.getEntriesByType('resource').map(r => ({name:r.name, duration:r.duration}))})`,
      ],
    ],
    ['errors', ['errors']],
    ['console', ['console']],
    ['snapshot', ['snapshot', '-i']],
  ] as const) {
    try {
      const output = await browser(...args)
      console.error(`Browser failure ${purpose} ${name}: ${output}`)
      await writeFile(`artifacts/${purpose}-failure-${name}.txt`, output)
    } catch (error) {
      console.error(`Could not capture ${purpose} ${name}:`, error)
    }
  }
  try {
    await browser('screenshot', `artifacts/${purpose}-failure.png`, '--full')
  } catch (error) {
    console.error(`Could not capture ${purpose} screenshot:`, error)
  }
}
