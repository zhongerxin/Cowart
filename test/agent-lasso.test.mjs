import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectLassoTargetShapeIds,
  lassoPathLength,
  pointInPolygon
} from '../src/agentLassoGeometry.js'

const polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 }
]

test('pointInPolygon distinguishes enclosed and outside points', () => {
  assert.equal(pointInPolygon({ x: 50, y: 50 }, polygon), true)
  assert.equal(pointInPolygon({ x: 120, y: 50 }, polygon), false)
})

test('lassoPathLength measures sampled strokes', () => {
  assert.equal(
    lassoPathLength([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 8 }
    ]),
    10
  )
})

test('collectLassoTargetShapeIds includes content and honors excluded annotation marks', () => {
  const shapes = [
    { id: 'shape:inside', type: 'geo', meta: {} },
    { id: 'shape:edge', type: 'geo', meta: {} },
    { id: 'shape:outside', type: 'geo', meta: {} },
    { id: 'shape:annotation', type: 'draw', meta: { cowartAnnotationMark: true } },
    { id: 'shape:lasso', type: 'draw', meta: { cowartAgentLasso: true } }
  ]
  const bounds = {
    'shape:inside': { x: 20, y: 20, w: 20, h: 20 },
    'shape:edge': { x: 90, y: 20, w: 20, h: 20 },
    'shape:outside': { x: 120, y: 20, w: 20, h: 20 },
    'shape:annotation': { x: 20, y: 20, w: 20, h: 20 },
    'shape:lasso': { x: 0, y: 0, w: 100, h: 100 }
  }
  const editor = {
    getCurrentPageShapesSorted: () => shapes,
    getShapePageBounds: (shape) => bounds[shape.id]
  }

  assert.deepEqual(
    collectLassoTargetShapeIds(
      editor,
      polygon,
      'shape:lasso',
      (shape) => shape.meta?.cowartAnnotationMark === true || shape.meta?.cowartAgentLasso === true
    ),
    ['shape:inside', 'shape:edge']
  )
})
