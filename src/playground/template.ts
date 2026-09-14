import { modelInfo } from '../engine/metadata'
import { samples } from '../samples'
import { format, number } from './format'
import benchmarkReport from '../../demo-performance.json'
import benchmarkReportURL from '../../demo-performance.json?url'

const measuredFile = benchmarkReport.workloads[0]
const gpuMeasurement = measuredFile.engines.find((engine) => engine.name === 'current GPU')!
const referenceMeasurement = measuredFile.engines.find((engine) => engine.name === 'markdown-it')!
const graphMax = Math.ceil(Math.max(gpuMeasurement.median, referenceMeasurement.median) / 100) * 100
const graphDate = new Date(benchmarkReport.date).toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const downloadIcon =
  '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3" stroke="currentColor" stroke-width="1.3"/></svg>'

export function mountPlayground(root: HTMLElement) {
  root.innerHTML = `
  <header class="site-header wrap">
    <a class="brand" href="#" aria-label="gpu-md home"><span class="brand-symbol">▧</span> gpu<span class="slash">/</span>md</a>
    <span class="edition">A SMALL COMPUTING EXPERIMENT <span>— 001</span></span>
    <a class="text-link" href="https://gpu-lexer.vercel.app/" target="_blank" rel="noopener noreferrer">The inspiration <span aria-hidden="true">↗</span></a>
  </header>
  <main class="wrap">
    <section class="hero" aria-labelledby="title">
      <div class="hero-copy">
        <div class="eyebrow"><span class="tiny-square"></span> MARKDOWN MEETS MACHINE LEARNING</div>
        <h1 id="title">Small model.<br><span>Rich text.</span></h1>
        <p>A tiny neural network, a little GPU compute,<br class="desktop-break"> and a different way to render Markdown.</p>
        <a class="hero-link" href="#playground">Try it in your browser <span aria-hidden="true">↓</span></a>
      </div>
      <div class="hero-notebook" role="group" aria-label="The gpu-md API">
        <div class="notebook-top"><span>hello-gpu.ts</span><span>LOCAL INFERENCE</span></div>
        <pre><code><span class="code-muted">import</span> { createRenderer } <span class="code-muted">from</span> <span class="code-green">'./gpu-md.js'</span>

<span class="code-muted">const</span> md = createRenderer()
<span class="code-muted">const</span> { html } = <span class="code-muted">await</span> md.render(
  <span class="code-green">'# Hello, GPU'</span>
)

<span class="code-comment">// &lt;h1&gt;Hello, GPU&lt;/h1&gt;</span></code></pre>
        <div class="notebook-bottom"><span class="spark">✳</span><span>Trained with PyTorch.<br>Runs with WebGPU.</span><span class="notebook-arrow">↗</span></div>
      </div>
    </section>
    <section class="facts" aria-label="Model facts">
      <div><strong>${(modelInfo.bytes / 1024).toFixed(1)} <small>KiB</small></strong><span>INT8 MODEL WEIGHTS</span></div>
      <div><strong>${number(modelInfo.parameters)}</strong><span>LEARNED PARAMETERS</span></div>
      <div><strong>11 <small>roles</small></strong><span>LINE CLASSIFICATION</span></div>
      <div class="fact-note"><span class="local-icon">⌘</span><p>All inference stays<br>in your browser.</p></div>
    </section>
    <section id="playground" class="playground" aria-labelledby="playground-title">
      <div class="section-heading"><div><span class="section-number">01 /</span><h2 id="playground-title">The playground</h2><span class="subtle">Make a mark. See what happens.</span></div><span class="status" id="status" role="status"><i></i>Starting model</span></div>
      <div class="editor-toolbar">
        <div class="sample-tabs" role="group" aria-label="Example document">${Object.keys(samples)
          .map(
            (name, i) =>
              `<button data-sample="${name}" class="sample-tab ${i === 0 ? 'active' : ''}" aria-pressed="${i === 0}">${name}</button>`,
          )
          .join('')}</div>
        <div class="toolbar-actions"><button id="open-file" class="quiet-button">Open .md <span aria-hidden="true">↗</span></button><input id="file" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden><button id="reset" class="icon-button" title="Reset this example" aria-label="Reset this example">↺</button></div>
      </div>
      <div class="workspace">
        <div class="source-pane">
          <div class="pane-heading"><label for="source">MARKDOWN</label><span id="source-size"></span></div>
          <div class="editor-body"><div id="line-numbers" aria-hidden="true"></div><textarea id="source" aria-label="Markdown source" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea></div>
        </div>
        <div class="output-pane">
          <div class="pane-heading output-heading"><div class="view-tabs" role="tablist" aria-label="Output view"><button role="tab" id="tab-preview" aria-controls="preview" aria-selected="true" data-view="preview" class="active">Preview</button><button role="tab" id="tab-html" aria-controls="html" aria-selected="false" tabindex="-1" data-view="html">HTML</button><button role="tab" id="tab-labels" aria-controls="labels" aria-selected="false" tabindex="-1" data-view="labels">Line labels</button></div><button id="copy" class="icon-button" title="Copy generated HTML" aria-label="Copy generated HTML"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1" stroke="currentColor"/><path d="M10 3V2H2v9h1" stroke="currentColor"/></svg></button></div>
          <div id="preview" class="rendered output-content" role="tabpanel" aria-labelledby="tab-preview" tabindex="0"></div>
          <pre id="html" class="html-output output-content" role="tabpanel" aria-labelledby="tab-html" hidden></pre>
          <div id="labels" class="labels-output output-content" role="tabpanel" aria-labelledby="tab-labels" hidden></div>
        </div>
      </div>
      <div class="workspace-footer"><span><i class="live-dot"></i>LIVE RENDERING <span class="footer-divider">/</span> <span id="render-time">—</span></span><label class="backend-label">Compute <select id="backend" aria-label="Compute backend"><option value="auto">WebGPU / auto</option><option value="cpu">CPU model</option><option value="gpu">Require WebGPU</option></select></label></div>
      <p id="notice" class="notice" role="status"></p>
    </section>
    <section class="under-the-hood" aria-labelledby="pipeline-title">
      <div class="section-heading"><div><span class="section-number">02 /</span><h2 id="pipeline-title">A little look inside</h2></div><span class="subtle">LIVE PIPELINE TIMINGS</span></div>
      <div class="pipeline"><div class="pipeline-step"><span class="step-index">01</span><h3>Sketch the source</h3><p>192 character features describe each line and its neighbors.</p><div class="step-footer"><span>JAVASCRIPT</span><strong id="time-features">—</strong></div></div><span class="pipeline-arrow" aria-hidden="true">→</span><div class="pipeline-step model-step"><span class="step-index">02</span><h3>Let the model look</h3><p>Two learned layers propose two roles and confidence scores for each line.</p><div class="step-footer"><span id="inference-backend">WEBGPU / CPU</span><strong id="time-inference">—</strong></div></div><span class="pipeline-arrow" aria-hidden="true">→</span><div class="pipeline-step"><span class="step-index">03</span><h3>Make it readable</h3><p>The parser checks predicted roles, handles nesting, and renders inline markup.</p><div class="step-footer"><span>JAVASCRIPT</span><strong id="time-assemble">—</strong></div></div></div>
    </section>
    <section class="benchmark-section" aria-labelledby="benchmark-title">
      <div class="section-heading"><div><span class="section-number">03 /</span><h2 id="benchmark-title">Markdown at scale</h2></div><span class="subtle">RECORDED ON NVIDIA · LOWER IS FASTER</span></div>
      <figure class="benchmark-figure" aria-labelledby="benchmark-caption">
        <figcaption id="benchmark-caption"><div><h3>5.56M characters. One Markdown file.</h3><p>${number(measuredFile.characters)} characters · ${number(measuredFile.lines)} lines</p></div><div class="benchmark-speedup"><strong>${(referenceMeasurement.median / gpuMeasurement.median).toFixed(1)}×</strong><span>faster in this run</span></div></figcaption>
        <div class="benchmark-chart" role="group" aria-label="Complete Markdown to HTML rendering time in milliseconds">
          <div class="benchmark-axis" aria-hidden="true"><span></span><div class="benchmark-ticks">${Array.from({ length: 5 }, (_, i) => `<span style="left:${i * 25}%">${(graphMax * i) / 4} ms</span>`).join('')}</div><span></span></div>
          ${[
            {
              name: 'gpu-md',
              backend: 'WebGPU · NVIDIA',
              value: gpuMeasurement.median,
              featured: true,
            },
            {
              name: 'markdown-it',
              backend: 'JavaScript',
              value: referenceMeasurement.median,
              featured: false,
            },
          ]
            .map(
              (entry) =>
                `<div class="benchmark-row" aria-label="${entry.name}: ${format(entry.value)} milliseconds"><div class="benchmark-engine">${entry.name}<small>${entry.backend}</small></div><div class="benchmark-meter" aria-hidden="true"><div class="benchmark-bar ${entry.featured ? 'gpu-bar' : 'reference-bar'}" style="width:${(entry.value / graphMax) * 100}%"></div></div><strong class="benchmark-value">${format(entry.value)}<small>ms</small></strong></div>`,
            )
            .join('')}
        </div>
        <p class="benchmark-note">Recorded ${graphDate} on an NVIDIA RTX 1000 Ada laptop GPU, Edge 152, Windows. Median of 7 runs after 3 warm-ups. Both engines render the full file to HTML, including GPU transfers; DOM insertion is excluded. Exact HTML output differs on this input. <a href="${benchmarkReportURL}" target="_blank" rel="noopener noreferrer">Measurement data ↗</a></p>
      </figure>
    </section>
    <section class="experiment-note"><div class="note-mark">*</div><div><h2>An experiment, with edges.</h2><p>The renderer handles reference links, nested emphasis, lazy continuations, and the full CommonMark example suite, plus tables and task items. The playground escapes source HTML. New inputs can still expose model errors; passing a finite suite is not a guarantee for every document.</p><p>The model was trained on synthetic documents labeled by markdown-it. Line agreement on the separately seeded synthetic test set: <strong id="agreement">${(modelInfo.training.testLineAgreement * 100).toFixed(2)}%</strong>. This is a line-classification score, not HTML correctness or evidence of generalization to real documents. Nested containers use the same model on the CPU. WebGPU computes predictions; the browser lays out the HTML.</p></div><button id="download" class="text-link download-link">Download HTML ${downloadIcon}</button></section>
  </main>
  <footer class="site-footer wrap"><a class="brand" href="#">gpu<span class="slash">/</span>md</a><span>SMALL MODELS. INTERESTING POSSIBILITIES.</span><a class="text-link" href="https://gpu-lexer.vercel.app/" target="_blank" rel="noopener noreferrer">Inspired by gpu-lexer ↗</a></footer>
`
}
