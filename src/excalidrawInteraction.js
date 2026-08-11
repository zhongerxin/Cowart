export const EXCALIDRAW_TOOL_SHORTCUTS = Object.freeze({
  '0': 'eraser',
  '1': 'select',
  '2': 'rectangle',
  '3': 'diamond',
  '4': 'ellipse',
  '5': 'arrow',
  '6': 'line',
  '7': 'draw',
  '8': 'text',
  '9': 'asset'
})

const COWART_SHORTCUTS = Object.freeze({
  h: 'cowart-ai-html',
  i: 'cowart-ai-image',
  s: 'cowart-ai-slides'
})

export function getExcalidrawKeyboardAction({
  altKey = false,
  ctrlKey = false,
  key = '',
  metaKey = false,
  shiftKey = false
} = {}) {
  if (altKey || ctrlKey || metaKey) return null

  const normalizedKey = String(key).toLowerCase()
  if (shiftKey) return COWART_SHORTCUTS[normalizedKey] ?? null
  if (normalizedKey === 'q') return 'toggle-tool-lock'
  return EXCALIDRAW_TOOL_SHORTCUTS[normalizedKey] ?? null
}

export function isEditableKeyboardTarget(target) {
  if (!target || typeof target !== 'object') return false
  if (target.isContentEditable) return true
  const tagName = String(target.tagName ?? '').toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}
