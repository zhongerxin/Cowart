export const COWART_FONT_SIZE_MIN = 8
export const COWART_FONT_SIZE_MAX = 240
export const COWART_FONT_SIZE_PRESETS = [10, 12, 16, 24, 32, 48, 72, 96]

const COWART_FONT_SIZE_META_KEY = 'cowartFontSize'
const COWART_FONT_BASE_SIZE_META_KEY = 'cowartFontBaseSize'
const COWART_TYPOGRAPHY_SHAPE_TYPES = new Set(['arrow', 'geo', 'note', 'text'])

const FONT_SIZE_MULTIPLIERS = {
  text: { s: 1.125, m: 1.5, l: 2.25, xl: 2.75 },
  arrow: { s: 1.125, m: 1.25, l: 1.5, xl: 1.75 },
  geo: { s: 1.125, m: 1.375, l: 1.625, xl: 2 },
  note: { s: 1.125, m: 1.375, l: 1.625, xl: 2 }
}

export function clampCowartFontSize(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return null
  return Math.min(COWART_FONT_SIZE_MAX, Math.max(COWART_FONT_SIZE_MIN, Math.round(numericValue)))
}

export function isCowartTypographyShape(shape) {
  return Boolean(shape && COWART_TYPOGRAPHY_SHAPE_TYPES.has(shape.type))
}

export function getCowartNativeFontSize(shape, themeFontSize = 16) {
  if (!isCowartTypographyShape(shape)) return null

  const multiplier = FONT_SIZE_MULTIPLIERS[shape.type]?.[shape.props?.size]
  if (!multiplier) return null

  return themeFontSize * multiplier
}

export function getCowartFontSizeOverride(shape) {
  if (!shape || shape.type === 'text') return null

  const fontSize = Number(shape.meta?.[COWART_FONT_SIZE_META_KEY])
  const baseSize = shape.meta?.[COWART_FONT_BASE_SIZE_META_KEY]
  if (!Number.isFinite(fontSize) || baseSize !== shape.props?.size) return null

  return clampCowartFontSize(fontSize)
}

export function getCowartEffectiveFontSize(shape, themeFontSize = 16) {
  const nativeFontSize = getCowartNativeFontSize(shape, themeFontSize)
  if (!nativeFontSize) return null

  if (shape.type === 'text') {
    const scale = Number(shape.props?.scale)
    return nativeFontSize * (Number.isFinite(scale) && scale > 0 ? scale : 1)
  }

  return getCowartFontSizeOverride(shape) ?? nativeFontSize
}

export function withCowartFontSizeMeta(shape, fontSize) {
  const nextFontSize = clampCowartFontSize(fontSize)
  if (!shape || nextFontSize === null) return shape?.meta ?? {}

  return {
    ...(shape.meta ?? {}),
    [COWART_FONT_SIZE_META_KEY]: nextFontSize,
    [COWART_FONT_BASE_SIZE_META_KEY]: shape.props?.size
  }
}

export function withoutCowartFontSizeMeta(shape) {
  const nextMeta = { ...(shape?.meta ?? {}) }
  delete nextMeta[COWART_FONT_SIZE_META_KEY]
  delete nextMeta[COWART_FONT_BASE_SIZE_META_KEY]
  return nextMeta
}
