import { saveCowartCanvasSnapshot } from './cowartClient.js'

const saveSessions = new WeakMap()

function isImageShape(record) {
  return record?.typeName === 'shape' && record.type === 'image'
}

export function attachCowartCanvasSaveSession(editor) {
  const existing = saveSessions.get(editor)
  if (existing) return existing

  const pendingImageDeletes = new Map()
  // Store listeners run on the next animation frame. Record the user's intent
  // synchronously so a Send click can save before that frame or the autosave.
  const removeDeleteHandler = editor.sideEffects.registerAfterDeleteHandler('shape', (shape, source) => {
    if (source === 'user' && isImageShape(shape)) {
      pendingImageDeletes.set(shape.id, {})
    } else {
      pendingImageDeletes.delete(shape.id)
    }
  })
  const removeCreateHandler = editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
    // Undo or remote restoration revokes the earlier deletion confirmation.
    pendingImageDeletes.delete(shape.id)
  })
  const session = {
    pendingImageDeletes,
    save() { return saveEditorSnapshot(editor, session) },
    reset() { pendingImageDeletes.clear() },
    dispose() {
      removeDeleteHandler()
      removeCreateHandler()
      // A final save may already be queued during unmount. Its captured session
      // keeps these confirmations until that save completes, then is collected.
      if (saveSessions.get(editor) === session) saveSessions.delete(editor)
    }
  }
  saveSessions.set(editor, session)
  return session
}

export function saveCowartEditorSnapshot(editor) {
  return saveEditorSnapshot(editor, saveSessions.get(editor))
}

async function saveEditorSnapshot(editor, session) {
  const options = { protectImageRecords: true }
  let includedDeletes = new Map()
  const result = await saveCowartCanvasSnapshot(() => {
    // Capture the snapshot and its confirmations together when the write queue
    // reaches this save, after any earlier HTML edit has updated the editor.
    const snapshot = editor.store.getStoreSnapshot()
    includedDeletes = new Map(Array.from(session?.pendingImageDeletes ?? []).filter(
      ([id]) => !isImageShape(snapshot.store[id])
    ))
    options.acknowledgedImageShapeDeletes = Array.from(includedDeletes.keys())
    return snapshot
  }, options)

  if (result?.ok !== false) {
    for (const [id, confirmation] of includedDeletes) {
      // A second delete after undo can occur while this write is in flight.
      // Consume only the confirmation actually included in the successful save.
      if (session?.pendingImageDeletes.get(id) === confirmation) session.pendingImageDeletes.delete(id)
    }
  }
  return result
}
