import { parameters, training } from './model.json'
import { FEATURES, HIDDEN, LABELS } from './features.js'
import type { ModelInfo } from './types.js'

export const modelInfo: ModelInfo = {
  parameters,
  bytes: parameters,
  architecture: `${FEATURES} → ${HIDDEN} → ${LABELS.length}`,
  training,
}
