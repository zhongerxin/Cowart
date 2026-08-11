export function pointInPolygon(point, polygon) {
  let isInside = false

  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current]
    const b = polygon[previous]
    const crossesRay =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x

    if (crossesRay) isInside = !isInside
  }

  return isInside
}

export function lassoPathLength(points) {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return length
}

function boundsSamplePoints(bounds) {
  return [
    { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h }
  ]
}

export function collectLassoTargetShapeIds(
  editor,
  polygon,
  lassoShapeId,
  isExcludedShape = () => false
) {
  if (polygon.length < 3) return []

  return editor
    .getCurrentPageShapesSorted()
    .filter((shape) => {
      if (!shape || shape.id === lassoShapeId || isExcludedShape(shape)) return false

      const bounds = editor.getShapePageBounds(shape)
      if (!bounds) return false

      const [center, ...corners] = boundsSamplePoints(bounds)
      return pointInPolygon(center, polygon) || corners.filter((point) => pointInPolygon(point, polygon)).length >= 2
    })
    .map((shape) => shape.id)
}
