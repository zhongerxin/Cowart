import assert from 'node:assert/strict'
import test from 'node:test'

import { buildThinkingReviewPrompt } from '../src/thinkingReviewPrompt.js'

test('thinking review prompt preserves the user request and exact lasso scope', () => {
  const prompt = buildThinkingReviewPrompt({
    selectedIds: ['shape:card', 'shape:relation'],
    includedIds: ['shape:card', 'shape:relation', 'shape:lasso'],
    screenshotAsset: { assetPath: 'C:/canvas/review.png' },
    userInstruction: '  把这部分改成三步流程  ',
    width: 799.6,
    height: 400.2
  })

  assert.match(prompt, /把这部分改成三步流程/)
  assert.match(prompt, /Exact target shape IDs: shape:card, shape:relation/)
  assert.match(prompt, /Screenshot includes 3 shape\(s\) and is 800x400 pixels/)
  assert.match(prompt, /Never rewrite, move, or delete unrelated page content/)
  assert.match(prompt, /operation ID for undo/)
})
