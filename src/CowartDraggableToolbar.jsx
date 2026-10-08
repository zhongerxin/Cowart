import { DefaultToolbar, useEditor } from 'tldraw'
import { GripVertical } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'

const EDGE_MARGIN = 8
const HANDLE_WIDTH = 28

export function CowartDraggableToolbar({
  children,
  minItems = 3,
  maxItems = 8,
  minSizePx = 310,
  // Leave room for the annotation label and the mobile style panel as tools grow.
  maxSizePx = 640,
  ...props
}) {
  const editor = useEditor()
  const rootRef = useRef(null)
  // Deliberately kept out of the canvas snapshot and browser storage.
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef(null)

  function moveToolbar(x, y) {
    const root = rootRef.current
    const toolbar = root?.querySelector('.tlui-main-toolbar__inner')
    if (!toolbar) return
    const bounds = editor.getContainer().getBoundingClientRect()
    const rect = toolbar.getBoundingClientRect()
    const current = offsetRef.current
    const minX = current.x + bounds.left + EDGE_MARGIN - rect.left
    const minY = current.y + bounds.top + EDGE_MARGIN - rect.top
    const maxX = current.x + bounds.right - EDGE_MARGIN - rect.right
    const maxY = current.y + bounds.bottom - EDGE_MARGIN - rect.bottom
    const offset = {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    }
    offsetRef.current = offset
    root.style.setProperty('--cowart-toolbar-x', `${offset.x}px`)
    root.style.setProperty('--cowart-toolbar-y', `${offset.y}px`)
  }

  useLayoutEffect(() => {
    const root = rootRef.current
    const toolbar = root?.querySelector('.tlui-main-toolbar__inner')
    if (!toolbar) return
    const observer = new ResizeObserver(() => {
      const { x, y } = offsetRef.current
      moveToolbar(x, y)
    })
    observer.observe(editor.getContainer())
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [editor])

  function endDrag(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    event.stopPropagation()
    dragRef.current = null
    rootRef.current?.removeAttribute('data-dragging')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="cowart-draggable-toolbar" ref={rootRef}>
      <DefaultToolbar
        {...props}
        minItems={minItems + 1}
        maxItems={maxItems + 1}
        minSizePx={minSizePx + HANDLE_WIDTH}
        maxSizePx={maxSizePx + HANDLE_WIDTH}
      >
        {/* A wrapper keeps the handle out of tldraw's numbered tool shortcuts. */}
        <div className="cowart-toolbar-drag-handle-container">
          <button
            className="cowart-toolbar-drag-handle"
            type="button"
            aria-label="拖动工具栏"
            title="拖动工具栏"
            data-testid="cowart.toolbar-drag-handle"
            onPointerDown={(event) => {
              if (event.button !== 0 || dragRef.current) return
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              dragRef.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
              }
              rootRef.current?.setAttribute('data-dragging', 'true')
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (drag?.pointerId !== event.pointerId) return
              event.preventDefault()
              event.stopPropagation()
              const offset = offsetRef.current
              moveToolbar(offset.x + event.clientX - drag.x, offset.y + event.clientY - drag.y)
              drag.x = event.clientX
              drag.y = event.clientY
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 40 : 10
              const delta = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              }[event.key]
              if (!delta) return
              event.preventDefault()
              event.stopPropagation()
              const offset = offsetRef.current
              moveToolbar(offset.x + delta[0], offset.y + delta[1])
            }}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </DefaultToolbar>
    </div>
  )
}
