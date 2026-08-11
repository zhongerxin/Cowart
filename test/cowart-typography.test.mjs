import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampCowartFontSize,
  getCowartEffectiveFontSize,
  getCowartFontSizeOverride,
  getCowartNativeFontSize,
  isCowartTypographyShape,
  withCowartFontSizeMeta,
  withoutCowartFontSizeMeta
} from '../src/cowartTypography.js'

function makeShape(type, props = {}, meta = {}) {
  return {
    id: `shape:${type}`,
    type,
    props: { size: 'm', scale: 1, ...props },
    meta
  }
}

test('clamps the extended font range to whole pixels', () => {
  assert.equal(clampCowartFontSize(4), 8)
  assert.equal(clampCowartFontSize(27.6), 28)
  assert.equal(clampCowartFontSize(999), 240)
  assert.equal(clampCowartFontSize('nope'), null)
})

test('derives native and scaled text sizes from tldraw defaults', () => {
  const textShape = makeShape('text', { size: 'l', scale: 1.5 })
  assert.equal(getCowartNativeFontSize(textShape), 36)
  assert.equal(getCowartEffectiveFontSize(textShape), 54)
})

test('keeps a custom label size active only for its source tldraw size', () => {
  const geoShape = makeShape('geo')
  const meta = withCowartFontSizeMeta(geoShape, 47)
  const customizedShape = { ...geoShape, meta }

  assert.equal(getCowartFontSizeOverride(customizedShape), 47)
  assert.equal(getCowartEffectiveFontSize(customizedShape), 47)
  assert.equal(
    getCowartFontSizeOverride({ ...customizedShape, props: { ...customizedShape.props, size: 'l' } }),
    null
  )
})

test('removes only Cowart typography metadata', () => {
  const shape = makeShape('arrow', {}, { sourceId: 'material:1' })
  const withFontSize = { ...shape, meta: withCowartFontSizeMeta(shape, 32) }

  assert.deepEqual(withoutCowartFontSizeMeta(withFontSize), { sourceId: 'material:1' })
  assert.equal(isCowartTypographyShape(shape), true)
  assert.equal(isCowartTypographyShape(makeShape('image')), false)
})
