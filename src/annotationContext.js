import { Box } from 'tldraw'

const NEAR_MARGIN_MIN = 160
const NEAR_MARGIN_MAX = 720
const RELATED_TEXT_MARGIN = 120
const ANNOTATION_COLORS = new Set(['red', 'yellow', 'orange'])

export function expandBox(bounds, padding) {
  return new Box(
    bounds.x - padding,
    bounds.y - padding,
    bounds.w + padding * 2,
    bounds.h + padding * 2
  )
}

function annotationNearMargin(targetBounds) {
  return Math.min(
    NEAR_MARGIN_MAX,
    Math.max(NEAR_MARGIN_MIN, Math.max(targetBounds.w, targetBounds.h))
  )
}

function hasAnnotationColor(shape) {
  return (
    ANNOTATION_COLORS.has(shape?.props?.color) ||
    ANNOTATION_COLORS.has(shape?.props?.labelColor)
  )
}

export function isAnnotationMarkShape(shape) {
  if (!shape) return false
  if (
    shape.meta?.cowartAnnotationArrow === true ||
    shape.meta?.cowartAnnotationText === true ||
    shape.meta?.cowartAnnotationMark === true ||
    shape.meta?.cowartAgentLasso === true
  ) {
    return true
  }
  return ['arrow', 'draw', 'highlight', 'text'].includes(shape.type) && hasAnnotationColor(shape)
}

function uniqueShapeIds(shapeIds) {
  return Array.from(new Set(shapeIds.filter(Boolean)))
}

export function collectAnnotationTargetShapeIds(
  editor,
  targetShapeId,
  isTargetShape,
  invalidTargetMessage
) {
  const targetShape = editor.getShape(targetShapeId)
  if (!isTargetShape(targetShape)) throw new Error(invalidTargetMessage)

  const targetBounds = editor.getShapePageBounds(targetShapeId)
  if (!targetBounds) throw new Error('Unable to read the selected content bounds.')

  const nearBounds = expandBox(targetBounds, annotationNearMargin(targetBounds))
  const relatedMarkIds = []
  const relatedMarkBounds = []
  const deferredText = []

  for (const shape of editor.getCurrentPageShapesSorted()) {
    if (!shape || shape.id === targetShapeId || !isAnnotationMarkShape(shape)) continue
    const bounds = editor.getShapePageBounds(shape)
    if (!bounds) continue

    if (nearBounds.collides(bounds)) {
      relatedMarkIds.push(shape.id)
      relatedMarkBounds.push(bounds)
    } else if (shape.type === 'text') {
      deferredText.push({ id: shape.id, bounds })
    }
  }

  for (const text of deferredText) {
    if (
      relatedMarkBounds.some((bounds) =>
        expandBox(bounds, RELATED_TEXT_MARGIN).collides(text.bounds)
      )
    ) {
      relatedMarkIds.push(text.id)
    }
  }

  return uniqueShapeIds([targetShapeId, ...relatedMarkIds])
}

export function collectSelectionAnnotationShapeIds(editor, selectedIds = editor.getSelectedShapeIds()) {
  const targetIds = uniqueShapeIds(selectedIds).filter((id) => editor.getShape(id))
  if (!targetIds.length) throw new Error('Select one or more canvas objects first.')

  const rawBounds = editor.getShapesPageBounds(targetIds)
  if (!rawBounds) throw new Error('Unable to read the selected canvas region.')
  const nearBounds = expandBox(rawBounds, annotationNearMargin(rawBounds))
  const nearbyMarks = editor
    .getCurrentPageShapesSorted()
    .filter((shape) => {
      if (!shape || targetIds.includes(shape.id) || !isAnnotationMarkShape(shape)) return false
      const bounds = editor.getShapePageBounds(shape)
      return Boolean(bounds && nearBounds.collides(bounds))
    })
    .map((shape) => shape.id)

  return uniqueShapeIds([...targetIds, ...nearbyMarks])
}

export function getAnnotationExportPixelRatio(bounds) {
  const maxDimension = Math.max(bounds.w, bounds.h)
  if (maxDimension > 1600) return 1
  if (maxDimension > 1000) return 1.5
  return 2
}
