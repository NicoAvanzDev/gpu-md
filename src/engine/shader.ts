import { COMPACT_FEATURES, HIDDEN, LABELS } from './features.js'
import { OFFSETS } from './model.js'

export const shader = /* wgsl */ `
@group(0) @binding(0) var<storage, read> features: array<f32>;
@group(0) @binding(1) var<storage, read> weights: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
@group(0) @binding(3) var<uniform> size: vec4<u32>;
var<workgroup> hidden: array<f32, ${HIDDEN * 4}>;
var<workgroup> logits: array<f32, ${LABELS.length * 4}>;

// Each workgroup processes four lines: sparse first layer, shared activations,
// second layer, and top-two decoding. No intermediate device-memory round trip.
@compute @workgroup_size(${HIDDEN * 4})
fn classify(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) index: u32) {
  let localRow = index / ${HIDDEN}u;
  let lane = index % ${HIDDEN}u;
  let row = group.x * 4u + localRow;
  let base = row * ${COMPACT_FEATURES}u;
  var value = weights[${OFFSETS[1]}u + lane];
  for (var p = 0u; p < 8u; p++) {
    let index = p * 20u + u32(features[base + p]);
    value += weights[index * ${HIDDEN}u + lane];
  }
  for (var f = 0u; f < 32u; f++) {
    value += features[base + 8u + f] * weights[(160u + f) * ${HIDDEN}u + lane];
  }
  hidden[index] = max(0.0, value);
  workgroupBarrier();
  if (lane < ${LABELS.length}u) {
    var score = weights[${OFFSETS[3]}u + lane];
    for (var h = 0u; h < ${HIDDEN}u; h++) {
      score += hidden[localRow * ${HIDDEN}u + h] * weights[${OFFSETS[2]}u + h * ${LABELS.length}u + lane];
    }
    logits[localRow * ${LABELS.length}u + lane] = score;
  }
  workgroupBarrier();
  if (lane == 0u && row < size.x) {
    var best = 0u;
    for (var c = 1u; c < ${LABELS.length}u; c++) { if (logits[localRow * ${LABELS.length}u + c] > logits[localRow * ${LABELS.length}u + best]) { best = c; } }
    var second = select(0u, 1u, best == 0u);
    var sum = 0.0;
    for (var c = 0u; c < ${LABELS.length}u; c++) {
      sum += exp(logits[localRow * ${LABELS.length}u + c] - logits[localRow * ${LABELS.length}u + best]);
      if (c != best && logits[localRow * ${LABELS.length}u + c] > logits[localRow * ${LABELS.length}u + second]) { second = c; }
    }
    output[row * 4u] = f32(best);
    output[row * 4u + 1u] = 1.0 / sum;
    output[row * 4u + 2u] = f32(second);
    output[row * 4u + 3u] = exp(logits[localRow * ${LABELS.length}u + second] - logits[localRow * ${LABELS.length}u + best]) / sum;
  }
}
`
