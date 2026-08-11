import { StateNode, b64Vecs, createShapeId } from 'tldraw'

import { isAnnotationMarkShape } from './annotationContext.js'
import {
  collectLassoTargetShapeIds,
  lassoPathLength
} from './agentLassoGeometry.js'

export { lassoPathLength, pointInPolygon } from './agentLassoGeometry.js'

export const COWART_AGENT_LASSO_TOOL_ID = 'cowart-agent-lasso'
export const COWART_AGENT_LASSO_TOOL_LABEL = 'AI 圈选'
export const COWART_AGENT_LASSO_COMPLETE_EVENT = 'cowart:agent-lasso-complete'
export const COWART_AGENT_LASSO_EMPTY_EVENT = 'cowart:agent-lasso-empty'

const MIN_POINT_COUNT = 8
const MIN_PATH_LENGTH = 48
const MIN_SAMPLE_DISTANCE = 2

export function collectAgentLassoTargetShapeIds(editor, polygon, lassoShapeId) {
  return collectLassoTargetShapeIds(
    editor,
    polygon,
    lassoShapeId,
    (shape) => shape.meta?.cowartAgentLasso === true || isAnnotationMarkShape(shape)
  )
}

function dispatchLassoEvent(editor, eventName, detail) {
  const containerDocument = editor.getContainerDocument()
  const CustomEventClass = containerDocument.defaultView?.CustomEvent
  if (!CustomEventClass) return

  containerDocument.dispatchEvent(new CustomEventClass(eventName, { detail }))
}

export class CowartAgentLassoTool extends StateNode {
  static id = COWART_AGENT_LASSO_TOOL_ID
  static initial = 'idle'

  static children() {
    return [CowartAgentLassoIdle, CowartAgentLassoPointing]
  }

  onEnter() {
    if (this.editor.getInstanceState().isToolLocked) {
      this.editor.updateInstanceState({ isToolLocked: false })
    }
  }
}

class CowartAgentLassoIdle extends StateNode {
  static id = 'idle'

  onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  onPointerDown(info) {
    this.parent.transition('pointing', info)
  }

  onCancel() {
    this.editor.setCurrentTool('select')
  }
}

class CowartAgentLassoPointing extends StateNode {
  static id = 'pointing'

  lassoShapeId = null
  markId = ''
  origin = null
  pagePoints = []
  localPoints = []

  onEnter() {
    const origin = this.editor.inputs.getOriginPagePoint()
    const lassoShapeId = createShapeId()
    const firstPoint = { x: 0, y: 0, z: 0.5 }

    this.lassoShapeId = lassoShapeId
    this.origin = { x: origin.x, y: origin.y }
    this.pagePoints = [{ x: origin.x, y: origin.y }]
    this.localPoints = [firstPoint]
    this.markId = this.editor.markHistoryStoppingPoint(`creating_agent_lasso:${lassoShapeId}`)

    this.editor.createShape({
      id: lassoShapeId,
      type: 'draw',
      x: origin.x,
      y: origin.y,
      meta: {
        cowartAgentLasso: true,
        cowartAnnotationMark: true
      },
      props: {
        color: 'black',
        dash: 'draw',
        fill: 'none',
        size: 's',
        isClosed: false,
        isComplete: false,
        isPen: false,
        scale: this.editor.getResizeScaleFactor(),
        segments: [{ type: 'free', path: b64Vecs.encodePoints([firstPoint]) }]
      }
    })
  }

  onPointerMove() {
    this.addCurrentPoint()
  }

  onPointerUp() {
    this.complete()
  }

  onCancel() {
    this.cancel()
  }

  onInterrupt() {
    this.cancel()
  }

  addCurrentPoint(force = false) {
    if (!this.lassoShapeId || !this.origin) return

    const point = this.editor.inputs.getCurrentPagePoint()
    const previous = this.pagePoints[this.pagePoints.length - 1]
    const minimumDistance = MIN_SAMPLE_DISTANCE / this.editor.getZoomLevel()
    if (!force && Math.hypot(point.x - previous.x, point.y - previous.y) < minimumDistance) return

    const pagePoint = { x: point.x, y: point.y }
    const localPoint = {
      x: point.x - this.origin.x,
      y: point.y - this.origin.y,
      z: 0.5
    }
    this.pagePoints.push(pagePoint)
    this.localPoints.push(localPoint)
    this.editor.updateShape({
      id: this.lassoShapeId,
      type: 'draw',
      props: {
        segments: [{ type: 'free', path: b64Vecs.encodePoints(this.localPoints) }]
      }
    })
  }

  complete() {
    if (!this.lassoShapeId) return this.cancel()
    this.addCurrentPoint(true)

    const minimumLength = MIN_PATH_LENGTH / this.editor.getZoomLevel()
    if (this.pagePoints.length < MIN_POINT_COUNT || lassoPathLength(this.pagePoints) < minimumLength) {
      this.editor.bailToMark(this.markId)
      this.parent.transition('idle')
      return
    }

    const selectedIds = collectAgentLassoTargetShapeIds(
      this.editor,
      this.pagePoints,
      this.lassoShapeId
    )
    if (!selectedIds.length) {
      this.editor.bailToMark(this.markId)
      dispatchLassoEvent(this.editor, COWART_AGENT_LASSO_EMPTY_EVENT, {})
      this.parent.transition('idle')
      return
    }

    this.editor.updateShape({
      id: this.lassoShapeId,
      type: 'draw',
      meta: {
        cowartAgentLasso: true,
        cowartAnnotationMark: true,
        cowartAgentLassoTargetIds: selectedIds
      },
      props: {
        isClosed: true,
        isComplete: true
      }
    })
    this.editor.setCurrentTool('select')
    this.editor.select(...selectedIds)
    this.editor.timers.requestAnimationFrame(() => {
      dispatchLassoEvent(this.editor, COWART_AGENT_LASSO_COMPLETE_EVENT, {
        lassoShapeId: this.lassoShapeId,
        selectedIds
      })
    })
  }

  cancel() {
    if (this.lassoShapeId) this.editor.bailToMark(this.markId)
    this.parent.transition('idle')
  }
}
