import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export const COMMONMARK_URL = 'https://spec.commonmark.org/0.31.2/spec.json'
const path = '.training/commonmark-0.31.2.json'
// Hash the parsed corpus so upstream whitespace does not affect the pinned fixture.
const digest = 'b5d5e749fc507dc2b81e980d5e7b8b04eed444bbe5c44a4edd8868b1e924cd72'
export interface CommonMarkExample {
  example: number
  markdown: string
  html: string
  section: string
}

function validate(value: unknown): CommonMarkExample[] {
  if (
    !Array.isArray(value) ||
    value.length !== 652 ||
    createHash('sha256').update(JSON.stringify(value)).digest('hex') !== digest
  )
    throw new Error(
      'CommonMark corpus integrity check failed. Remove .training/commonmark-0.31.2.json and retry.',
    )
  return value as CommonMarkExample[]
}

export async function loadCommonMark(): Promise<CommonMarkExample[]> {
  try {
    return validate(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
  const response = await fetch(COMMONMARK_URL, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`CommonMark corpus fetch failed: ${response.status}`)
  const corpus = validate(await response.json())
  await mkdir('.training', { recursive: true })
  await writeFile(path, JSON.stringify(corpus))
  return corpus
}
