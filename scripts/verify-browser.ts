import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

import { browserSession, captureBrowserFailure } from './browser-session'
import { loadCommonMark } from './commonmark'

const url = process.env.GPU_MD_URL ?? 'http://localhost:5173'
const cdp = process.env.GPU_MD_CDP
const expectedVendor = process.env.GPU_MD_EXPECT_VENDOR
const browser = browserSession('check')
const evaluate = async (script: string) => JSON.parse(await browser('eval', script))
await loadCommonMark()
await mkdir('artifacts', { recursive: true })
try {
  // Linux headless verification uses SwiftShader. This is not a hardware benchmark.
  await browser(...(cdp ? [] : ['--webgpu']), 'open', url)
  await browser('wait', '--fn', 'document.querySelector("#status").textContent.includes("WebGPU")')
  assert.equal(await evaluate('!!document.querySelector("#preview h1")'), true)
  const chartHTML = await evaluate('document.querySelector(".benchmark-chart").innerHTML')
  const chart = await evaluate(`(async () => {
    const section = document.querySelector('.benchmark-section');
    const record = await (await fetch(section.querySelector('a').href)).json();
    return {
      names: Array.from(section.querySelectorAll('.benchmark-engine'), e=>e.firstChild.textContent.trim()),
      values: Array.from(section.querySelectorAll('.benchmark-value'), e=>parseFloat(e.textContent)),
      controls: section.querySelectorAll('button, select').length,
      characters: record.workloads[0].characters,
      measured: record.workloads[0].engines.map(e=>Number(e.median.toFixed(1))),
      editorFont: parseFloat(getComputedStyle(document.querySelector('#source')).fontSize),
      previewFont: parseFloat(getComputedStyle(document.querySelector('#preview')).fontSize),
      paragraphFont: parseFloat(getComputedStyle(document.querySelector('.experiment-note p')).fontSize),
    };
  })()`)
  assert.deepEqual(chart.names, ['gpu-md', 'markdown-it'])
  assert.deepEqual(chart.values, chart.measured)
  assert.equal(chart.controls, 0)
  assert.ok(chart.characters >= 5_560_000)
  assert.ok(chart.editorFont >= 16 && chart.previewFont >= 16 && chart.paragraphFont >= 16)
  const parity = await evaluate(`(async () => {
    const {createRenderer} = await import('/src/engine/index.ts');
    const {samples} = await import('/src/samples.ts');
    const cpu = createRenderer({backend:'cpu'}), gpu = createRenderer({backend:'gpu'});
    const sources = [...Object.values(samples), Array.from({length:2100}, (_,i)=>i%2 ? '- item' : '# Heading').join('\\n'), '# Small after growth', Array(50000).fill('# Heading').join('\\n'), '# Small after maximum'];
    const results=[];
    try { for (const source of sources) {
      const a=await cpu.render(source), b=await gpu.render(source);
      results.push({lines:a.predictions.length, htmlMatches:a.html===b.html, labelsMatch:a.predictions.every((p,i)=>p.candidates.every((c,j)=>c.label===b.predictions[i].candidates[j].label && Math.abs(c.confidence-b.predictions[i].candidates[j].confidence)<0.00001)), adapter:b.adapter});
    } } finally { await cpu.destroy(); await gpu.destroy(); }
    return results;
  })()`)
  for (const result of parity) {
    if (expectedVendor) assert.match(result.adapter, new RegExp(expectedVendor, 'i'))
    assert.equal(result.htmlMatches, true)
    assert.equal(result.labelsMatch, true)
  }
  const cudaParity = await evaluate(`(async () => {
    const {classifyCPU} = await import('/src/engine/model.ts');
    const {GPUClassifier} = await import('/src/engine/gpu.ts');
    const {LABELS} = await import('/src/engine/features.ts');
    const response = await fetch('/.training/parity.json');
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return {available:false};
    const fixture = await response.json();
    const features = new Float32Array(fixture.features.flat());
    const gpu = await GPUClassifier.create();
    try {
      const gpuResults = await gpu.predict(features), cpuResults=classifyCPU(features);
      if (!fixture.candidateLabels) throw new Error('Retrain to export the two-candidate CUDA parity fixture.');
      const check = predictions=>predictions.every((p,i)=>p.candidates.every((c,j)=>LABELS.indexOf(c.label)===fixture.candidateLabels[i][j] && Math.abs(c.confidence-fixture.candidateConfidence[i][j])<0.00001));
      return {available:true, rows:fixture.labels.length, candidatesPerRow:2, cpuMatches:check(cpuResults), gpuMatches:check(gpuResults)};
    } finally { gpu.destroy(); }
  })()`)
  if (cudaParity.available) {
    assert.equal(cudaParity.cpuMatches, true)
    assert.equal(cudaParity.gpuMatches, true)
  }
  const conformance = await evaluate(`(async () => {
    const {createRenderer} = await import('/src/engine/index.ts');
    const response = await fetch('/.training/commonmark-0.31.2.json');
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('Run npm run test:conformance first to cache the corpus.');
    const corpus = await response.json();
    const cpu = createRenderer({backend:'cpu',allowHtml:true}), gpu = createRenderer({backend:'gpu',allowHtml:true});
    const safe = createRenderer({backend:'gpu'});
    let cpuMatches=0, gpuMatches=0, safeMatches=0;
    const failures=[];
    try { for (const item of corpus) {
      const a=await cpu.render(item.markdown), b=await gpu.render(item.markdown), c=await safe.render(item.markdown);
      cpuMatches+=Number(a.html===item.html); gpuMatches+=Number(b.html===item.html); safeMatches+=Number(c.html===item.html);
      if (a.html!==item.html || b.html!==item.html) failures.push(item.example);
    } } finally { await cpu.destroy(); await gpu.destroy(); await safe.destroy(); }
    return {examples:corpus.length,cpuMatches,gpuMatches,safeMatches,failures};
  })()`)
  assert.equal(conformance.examples, 652)
  assert.equal(conformance.cpuMatches, 652)
  assert.equal(conformance.gpuMatches, 652, `WebGPU conformance failures: ${conformance.failures}`)
  assert.ok(conformance.safeMatches >= 580)
  const batching = await evaluate(`(async () => {
    const {GPUClassifier} = await import('/src/engine/gpu.ts');
    const {sketch} = await import('/src/engine/features.ts');
    const {classifyCompact} = await import('/src/engine/model.ts');
    const {assemble} = await import('/src/engine/render.ts');
    const gpu = await GPUClassifier.create();
    try {
      // Exercise batching on every run; hardware runs use the actual adapter limit.
      if (!${Boolean(cdp)}) gpu.maxRows = 8;
      const boundary = gpu.maxRows;
      const lines = Array(boundary + 20).fill('');
      lines[0] = '[jump][end]';
      lines[boundary - 1] = '# Across batches';
      lines[boundary + 1] = '[jump][end]';
      lines[lines.length - 1] = '[end]: /end "After batch"';
      const features = sketch(lines);
      const a = classifyCompact(features), b = await gpu.predictCompact(features);
      const labelsMatch = a.length === b.length && a.every((p,i)=>p.candidates.every((c,j)=>c.label===b[i].candidates[j].label && Math.abs(c.confidence-b[i].candidates[j].confidence)<0.00001));
      const html = assemble(lines, b);
      const small = sketch(['## Small after batches']);
      const smallCPU = classifyCompact(small), smallGPU = await gpu.predictCompact(small);
      return { rows:lines.length, boundary, labelsMatch, htmlMatches:html===assemble(lines,a), referenceCount:(html.match(/href="\\/end"/g)||[]).length, smallMatches:smallCPU.every((p,i)=>p.candidates.every((c,j)=>c.label===smallGPU[i].candidates[j].label && Math.abs(c.confidence-smallGPU[i].candidates[j].confidence)<0.00001)) };
    } finally { gpu.destroy(); }
  })()`)
  assert.ok(batching.rows > batching.boundary)
  assert.equal(batching.labelsMatch, true)
  assert.equal(batching.htmlMatches, true)
  assert.equal(batching.referenceCount, 2)
  assert.equal(batching.smallMatches, true)
  if (cdp) {
    await browser('set', 'viewport', '1280', '960')
    await browser('scrollintoview', '#benchmark-title')
    await browser('screenshot', 'artifacts/verified-large-benchmark.png')
    await browser('set', 'viewport', '390', '844')
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
    assert.equal((await browser('errors')).trim(), '')
    const report = {
      passed: true,
      adapter: parity[0].adapter,
      parity,
      cudaParity,
      conformance,
      batching,
      chart,
    }
    await writeFile('artifacts/hardware-verification.json', JSON.stringify(report, null, 2) + '\n')
    await browser('screenshot', 'artifacts/verified-hardware.png')
    console.log(JSON.stringify(report, null, 2))
  } else {
    await browser(
      'fill',
      '#source',
      '# Browser test\n\n**A live update**\n\n<script>window.injected=true</script>',
    )
    await browser(
      'wait',
      '--fn',
      'document.querySelector("#preview h1")?.textContent === "Browser test"',
    )
    assert.equal(
      await evaluate('document.querySelector("#preview strong").textContent'),
      'A live update',
    )
    assert.equal(
      await evaluate('window.injected === undefined && !document.querySelector("#preview script")'),
      true,
    )
    await browser('click', '#tab-html')
    await browser('wait', '--fn', '!document.querySelector("#html").hidden')
    assert.equal(
      await evaluate(
        '!document.querySelector("#html").hidden && document.querySelector("#html").textContent.includes("<h1>Browser test</h1>")',
      ),
      true,
    )
    await browser('click', '#tab-labels')
    await browser('wait', '--fn', '!document.querySelector("#labels").hidden')
    assert.equal(await evaluate('document.querySelectorAll(".prediction-row").length'), 5)
    await browser('select', '#backend', 'cpu')
    await browser(
      'wait',
      '--fn',
      'document.querySelector("#status").textContent.includes("CPU model active")',
    )
    await writeFile('artifacts/upload.md', '# Imported document\n\nA local file.\n')
    await browser('upload', '#file', resolve('artifacts/upload.md'))
    await browser(
      'wait',
      '--fn',
      'document.querySelector("#preview h1")?.textContent === "Imported document"',
    )
    await browser('click', '#copy')
    await browser(
      'wait',
      '--fn',
      'document.querySelector("#notice").textContent === "Generated HTML copied to clipboard."',
    )
    assert.equal(
      await evaluate('document.querySelector("#notice").textContent'),
      'Generated HTML copied to clipboard.',
    )
    await browser('download', '#download', resolve('artifacts/exported.html'))
    assert.match(await readFile('artifacts/exported.html', 'utf8'), /<h1>Imported document<\/h1>/)
    await evaluate(
      'document.querySelector("#source").value = "\\n".repeat(50000); document.querySelector("#source").dispatchEvent(new Event("input", {bubbles:true})); true',
    )
    await browser(
      'wait',
      '--fn',
      'document.querySelector("#status").textContent === "Render failed"',
    )
    assert.equal(
      await evaluate(
        'document.querySelector("#copy").disabled && document.querySelector("#download").disabled',
      ),
      true,
    )
    assert.equal(await evaluate('document.querySelector("#preview h1") === null'), true)
    await browser('click', '[data-sample="Field notes"]')
    await browser('click', '#tab-preview')
    await browser(
      'wait',
      '--fn',
      'document.querySelector("#preview h1")?.textContent.includes("A small model")',
    )
    assert.equal(await evaluate('document.querySelector(".benchmark-chart").innerHTML'), chartHTML)
    await browser('set', 'viewport', '1280', '960')
    await browser('scrollintoview', '#playground')
    await browser('screenshot', 'artifacts/verified-desktop.png')
    await browser('set', 'viewport', '390', '844')
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
    await browser('screenshot', 'artifacts/verified-mobile.png', '--full')
    const errors = (await browser('errors')).trim()
    assert.equal(errors, '', `Browser errors: ${errors}`)
    const report = {
      passed: true,
      shaderBackend: 'SwiftShader on Linux; not a hardware performance claim',
      parity,
      cudaParity,
      conformance,
      batching,
      checks: [
        'live editing',
        'escaped HTML',
        'HTML and labels tabs',
        'CPU selection',
        'file import',
        'copy and HTML download',
        'input-limit error clears stale output',
        'sample switching',
        'fixed graph and recorded measurement link',
        'readable text sizes',
        'mobile overflow',
        'browser errors',
      ],
    }
    await writeFile('artifacts/browser-verification.json', JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  }
} catch (error) {
  await captureBrowserFailure(browser, 'development')
  throw error
} finally {
  await browser('close')
}
