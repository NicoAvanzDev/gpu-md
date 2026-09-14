import type { Backend, RenderResult } from '../engine/types'
import { escapeHTML } from '../engine/inline-syntax'
import { samples } from '../samples'
import evaluation from '../../evaluation.json'
import { format, number } from './format'
import { createRenderClient } from './render-client'

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing playground element: ${selector}`)
  return element
}

export function startPlayground() {
  const source = $<HTMLTextAreaElement>('#source')
  let selectedSample = 'Field notes'
  let result: RenderResult | undefined
  let debounce: ReturnType<typeof setTimeout>
  const client = createRenderClient(
    () => new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' }),
    {
      result: (value, input) => showResult(value, input.source),
      error: (message) => showError(message),
    },
  )

  function invalidateResult() {
    result = undefined
    $<HTMLButtonElement>('#copy').disabled = true
    $<HTMLButtonElement>('#download').disabled = true
  }
  function showError(message: string) {
    invalidateResult()
    $('#preview').textContent = 'Unable to render this document. See the message below.'
    $('#html').textContent = ''
    $('#labels').textContent = ''
    $('#status').textContent = 'Render failed'
    $('#notice').textContent = message
    $('#render-time').textContent = '—'
    for (const stage of ['features', 'inference', 'assemble']) $(`#time-${stage}`).textContent = '—'
    $('#inference-backend').textContent = 'WEBGPU / CPU'
    $('#playground').setAttribute('aria-busy', 'false')
  }

  const evaluationNote = document.createElement('p')
  evaluationNote.textContent = `CommonMark 0.31.2: ${evaluation.trustedHtml.exactSpecMatches} / ${evaluation.examples} exact matches with source HTML enabled explicitly. With HTML escaped, as in this playground: ${evaluation.exactSpecMatches} / ${evaluation.examples} (${(evaluation.exactSpecAgreement * 100).toFixed(1)}%), up from 41.3%. Comparisons are byte for byte. The suite is used for development and regression testing; see evaluation.json for the full report.`
  $('.experiment-note > div:nth-child(2)').append(evaluationNote)

  function updateSourceStats() {
    const lines = source.value.split('\n').length
    $('#source-size').textContent = `${number(source.value.length)} chars`
    $('#line-numbers').textContent = Array.from(
      { length: Math.min(lines, 2000) },
      (_, i) => i + 1,
    ).join('\n')
  }
  function requestRender() {
    updateSourceStats()
    clearTimeout(debounce)
    invalidateResult()
    $('#status').innerHTML = '<i></i>Rendering'
    $('#playground').setAttribute('aria-busy', 'true')
    client.request({
      source: source.value,
      backend: $<HTMLSelectElement>('#backend').value as Backend,
    })
  }

  function loadSample(name: string) {
    selectedSample = name
    source.value = samples[name]
    source.scrollTop = 0
    document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((button) => {
      button.classList.toggle('active', button.dataset.sample === name)
      button.setAttribute('aria-pressed', String(button.dataset.sample === name))
    })
    requestRender()
  }
  function showResult(value: RenderResult, submittedSource: string) {
    $('#playground').setAttribute('aria-busy', 'false')
    result = value
    $<HTMLButtonElement>('#copy').disabled = false
    $<HTMLButtonElement>('#download').disabled = false
    $('#preview').innerHTML = value.html
    $('#html').textContent = value.html
    const lines = submittedSource.replace(/\r\n?/g, '\n').split('\n')
    $('#labels').innerHTML =
      `<p class="label-explainer">First-choice model predictions, before syntax and nesting checks. Assembly checks the two highest-scoring candidates; hover a role to see the second. Confidence is an uncalibrated softmax score. Showing up to 500 lines.</p>` +
      value.predictions
        .slice(0, 500)
        .map(
          (prediction, i) =>
            `<div class="prediction-row"><span class="prediction-line">${i + 1}</span><span class="prediction-role role-${prediction.label}" title="Second candidate: ${prediction.candidates[1].label} (${(prediction.candidates[1].confidence * 100).toFixed(2)}%)">${prediction.label}</span><span class="confidence">${(prediction.confidence * 100).toFixed(0)}%</span><code>${escapeHTML(lines[i]?.slice(0, 160) || ' ')}</code></div>`,
        )
        .join('')
    const vendor = /nvidia|intel|amd|apple|qualcomm/i.exec(value.adapter)?.[0]
    $('#status').innerHTML =
      `<i></i>${value.backend === 'gpu' ? (/swiftshader|llvmpipe/i.test(value.adapter) ? 'WebGPU · software' : vendor ? `WebGPU · ${vendor.toUpperCase()}` : 'WebGPU active') : 'CPU model active'}`
    $('#status').title = value.adapter
    $('#render-time').textContent = `${format(value.timings.total)} ms`
    for (const stage of ['features', 'inference', 'assemble'] as const)
      $(`#time-${stage}`).textContent = `${format(value.timings[stage])} ms`
    $('#inference-backend').textContent = value.backend === 'gpu' ? 'WEBGPU COMPUTE' : 'CPU MODEL'
    $('#notice').textContent = value.fallbackReason
      ? `${value.fallbackReason} The same trained model is running on the CPU.`
      : `${value.adapter}. Timings include feature extraction, inference, and HTML assembly; the first render also includes initialization.`
  }
  source.addEventListener('input', () => {
    client.invalidate()
    invalidateResult()
    clearTimeout(debounce)
    updateSourceStats()
    debounce = setTimeout(requestRender, 150)
  })
  source.addEventListener('scroll', () => {
    $('#line-numbers').scrollTop = source.scrollTop
  })
  source.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end')
      requestRender()
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      clearTimeout(debounce)
      requestRender()
    }
  })
  document
    .querySelectorAll<HTMLButtonElement>('[data-sample]')
    .forEach((button) => button.addEventListener('click', () => loadSample(button.dataset.sample!)))
  $('#reset').addEventListener('click', () => loadSample(selectedSample))
  $('#backend').addEventListener('change', requestRender)
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'))
  function activateTab(active: HTMLButtonElement) {
    tabs.forEach((tab) => {
      const selected = active === tab
      tab.classList.toggle('active', selected)
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      $(`#${tab.dataset.view}`).hidden = !selected
    })
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab))
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      activateTab(tabs[next])
      tabs[next].focus()
    })
  })
  $('#open-file').addEventListener('click', () => $<HTMLInputElement>('#file').click())
  $('#file').addEventListener('change', async () => {
    const file = $<HTMLInputElement>('#file').files?.[0]
    if (!file) return
    if (file.size > 2_000_000) {
      $('#notice').textContent = 'Choose a file smaller than 2 MB.'
      $<HTMLInputElement>('#file').value = ''
      return
    }
    try {
      source.value = await file.text()
      source.scrollTop = 0
      requestRender()
    } catch {
      $('#notice').textContent = 'This file could not be read.'
    }
    $<HTMLInputElement>('#file').value = ''
  })
  $('#copy').addEventListener('click', async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.html)
      $('#notice').textContent = 'Generated HTML copied to clipboard.'
    } catch {
      $('#notice').textContent = 'Clipboard unavailable. Open the HTML tab to copy the output.'
    }
  })
  $('#download').addEventListener('click', () => {
    if (!result) return
    const html = `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rendered Markdown</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;font:17px/1.7 system-ui;color:#243e2b}pre{padding:20px;background:#f3f3ee;overflow:auto}code{font-size:.85em}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}blockquote{border-left:3px solid #72994d;padding-left:20px}img{max-width:100%}</style><body>${result.html}</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'gpu-md.html'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  loadSample(selectedSample)

  window.addEventListener('pagehide', () => {
    clearTimeout(debounce)
    client.dispose()
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) requestRender()
  })
  if (import.meta.hot)
    import.meta.hot.dispose(() => {
      clearTimeout(debounce)
      client.dispose()
    })
}
