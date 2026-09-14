import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
  name: string
  version: string
}
const directory = await mkdtemp(join(tmpdir(), 'gpu-md-package-'))
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this check with npm run test:package.')
try {
  const { stdout } = await exec(process.execPath, [
    npm,
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    directory,
  ])
  const [pack] = JSON.parse(stdout) as {
    filename: string
    files: { path: string }[]
    size: number
  }[]
  const files = pack.files.map((file) => file.path)
  for (const required of [
    'lib/gpu-md.js',
    'lib/types/index.d.ts',
    'THIRD_PARTY_NOTICES.md',
    'README.md',
  ])
    assert.ok(files.includes(required), `Missing packaged file: ${required}`)
  for (const file of files)
    assert.match(
      file,
      /^(?:lib\/|docs\/|(?:README|CHANGELOG|THIRD_PARTY_NOTICES|CONTRIBUTING|SECURITY)\.md$|LICENSE(?:\.md)?$|(?:package|evaluation|performance|demo-performance)\.json$)/,
      `Unexpected packaged file: ${file}`,
    )

  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  )
  await exec(
    process.execPath,
    [
      npm,
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--offline',
      '--package-lock=false',
      join(directory, pack.filename),
    ],
    { cwd: directory },
  )
  const specifier = JSON.stringify(manifest.name)
  await writeFile(
    join(directory, 'smoke.mjs'),
    `
    import assert from 'node:assert/strict';
    import { createRenderer, RendererError, DEFAULT_LIMITS, modelInfo } from ${specifier};
    const renderer = createRenderer({ backend: 'cpu' });
    assert.equal((await renderer.render('# Package consumer')).html, '<h1>Package consumer</h1>\\n');
    assert.equal(DEFAULT_LIMITS.maxLines, 50000);
    assert.equal(modelInfo.parameters, 6539);
    await renderer.destroy();
    await assert.rejects(renderer.render('closed'), error => error instanceof RendererError && error.code === 'DESTROYED');
  `,
  )
  await exec(process.execPath, [join(directory, 'smoke.mjs')], { cwd: directory })
  await writeFile(
    join(directory, 'consumer.ts'),
    `
    import { createRenderer, modelInfo, RendererError, DEFAULT_LIMITS, type RendererOptions, type Prediction, type RenderResult } from ${specifier};
    const options: RendererOptions = { backend: 'cpu', limits: DEFAULT_LIMITS };
    const renderer = createRenderer(options);
    const result: RenderResult = await renderer.render('typed consumer');
    const prediction: Prediction | undefined = result.predictions[0];
    const second: string | undefined = prediction?.candidates[1].label;
    const metadata: number = modelInfo.training.testLineAgreement;
    const code: string = new RendererError('INVALID_INPUT', 'message').code;
    void [second, metadata, code];
    await renderer.destroy();
  `,
  )
  for (const [module, moduleResolution] of [
    ['NodeNext', 'NodeNext'],
    ['ESNext', 'Bundler'],
  ]) {
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          lib: ['ES2022'],
          types: [],
          module,
          moduleResolution,
          skipLibCheck: false,
        },
        files: ['consumer.ts'],
      }),
    )
    await exec(
      process.execPath,
      [resolve('node_modules/typescript/bin/tsc'), '-p', join(directory, 'tsconfig.json')],
      { cwd: directory },
    )
  }
  console.log(
    `Package verified: ${manifest.name}@${manifest.version}; ${files.length} files; ${(pack.size / 1024).toFixed(1)} KiB packed. Isolated runtime and NodeNext/Bundler types passed.`,
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
