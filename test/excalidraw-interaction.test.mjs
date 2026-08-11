import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXCALIDRAW_TOOL_SHORTCUTS,
  getExcalidrawKeyboardAction,
  isEditableKeyboardTarget
} from '../src/excalidrawInteraction.js'

test('maps Excalidraw number shortcuts to the primary canvas tools', () => {
  assert.deepEqual(EXCALIDRAW_TOOL_SHORTCUTS, {
    0: 'eraser',
    1: 'select',
    2: 'rectangle',
    3: 'diamond',
    4: 'ellipse',
    5: 'arrow',
    6: 'line',
    7: 'draw',
    8: 'text',
    9: 'asset'
  })
})

test('keeps Cowart creation shortcuts behind shift modifiers', () => {
  assert.equal(getExcalidrawKeyboardAction({ key: 'I', shiftKey: true }), 'cowart-ai-image')
  assert.equal(getExcalidrawKeyboardAction({ key: 'h', shiftKey: true }), 'cowart-ai-html')
  assert.equal(getExcalidrawKeyboardAction({ key: 'S', shiftKey: true }), 'cowart-ai-slides')
  assert.equal(getExcalidrawKeyboardAction({ key: 'q' }), 'toggle-tool-lock')
})

test('does not steal command shortcuts from the host', () => {
  assert.equal(getExcalidrawKeyboardAction({ key: '1', ctrlKey: true }), null)
  assert.equal(getExcalidrawKeyboardAction({ key: 'i', metaKey: true, shiftKey: true }), null)
  assert.equal(getExcalidrawKeyboardAction({ key: 's', altKey: true, shiftKey: true }), null)
})

test('recognizes editable keyboard targets', () => {
  assert.equal(isEditableKeyboardTarget({ tagName: 'INPUT' }), true)
  assert.equal(isEditableKeyboardTarget({ tagName: 'textarea' }), true)
  assert.equal(isEditableKeyboardTarget({ isContentEditable: true, tagName: 'DIV' }), true)
  assert.equal(isEditableKeyboardTarget({ tagName: 'BUTTON' }), false)
})
