import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate as flush } from 'node:timers/promises'
import test from 'node:test'
import vm from 'node:vm'

// Run the real mount callback with a controlled editor, bridge and clock. This
// covers background work over long sessions without launching a development UI.
const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const marker = '  const handleMount = useCallback('
const start = source.indexOf(marker) + marker.length
const end = source.indexOf('  }, [viewState])', start)
assert.ok(start >= marker.length && end > start, 'Cannot find the canvas mount callback')
const mount = new vm.Script(`(${source.slice(start, end)}  })`)
const changedStoreStart = source.indexOf('function storeChangedSinceSnapshot(')
const changedStoreEnd = source.indexOf('function applyRemoteCanvasSnapshot(', changedStoreStart)
assert.ok(changedStoreStart >= 0 && changedStoreEnd > changedStoreStart, 'Cannot find the document comparison helper')
const storeChangedSinceSnapshot = new vm.Script(`(${source.slice(changedStoreStart, changedStoreEnd)})`).runInNewContext({
  recordsAreEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  let now = 0, nextId = 0
  const timers = new Map(), ownedTimers = new Set()
  const calls = { selection: [], view: [], refresh: [], dom: [], applied: [], errors: [], accepted: [], canvas: [], downloads: [], loaded: [], historyCleared: [] }
  const state = {
    selection: { selectedShapes: [] },
    view: { version: 1, currentPageId: 'page:one', camera: { x: 0, y: 0, z: 1 } },
    saveSelection: async () => {}, saveView: async () => {}, refresh: async () => ({ store: {} }),
    saveCanvas: async () => ({ ok: true }), download: async () => ({ ok: true }), loadSnapshot: () => {},
    applyRemote: () => ({ changedRecords: 0 }), snapshot: { schema: {}, store: {} }
  }
  const noOp = () => {}
  function timer(callback, delay, interval = 0) {
    const id = ++nextId
    timers.set(id, { callback, at: now + delay, interval })
    return id
  }
  const window = {
    setTimeout: (callback, delay) => timer(callback, delay), clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => timer(callback, delay, delay), clearInterval: (id) => timers.delete(id)
  }
  function element(tag) {
    return { tag, style: {}, children: [], handlers: {}, disabled: false,
      setAttribute: noOp, addEventListener(name, handler) { this.handlers[name] = handler },
      append(...children) { this.children.push(...children) }, appendChild(child) { this.children.push(child) },
      remove() { this.removed = true }
    }
  }
  const doc = { addEventListener: noOp, removeEventListener: noOp, getElementById: () => ({ remove: noOp }),
    createElement: element, body: element('body') }
  let documentListener

  const editor = {
    timers: {
      requestAnimationFrame: noOp,
      setTimeout(callback, delay) { const id = timer(callback, delay); ownedTimers.add(id); return id }
    },
    inputs: { getIsDragging: () => false }, run: (callback) => callback(),
    on: noOp, off: noOp, getContainerDocument: () => doc,
    clearHistory() { calls.historyCleared.push(state.snapshot) },
    sideEffects: { registerBeforeCreateHandler: () => noOp, registerOperationCompleteHandler: () => noOp },
    store: {
      listen(callback, options) { if (options?.source === 'user' && options?.scope === 'document') documentListener = callback; return noOp },
      getStoreSnapshot: () => state.snapshot,
      mergeRemoteChanges(callback) { callback() },
      loadStoreSnapshot(snapshot) { state.loadSnapshot(snapshot); calls.loaded.push(snapshot); state.snapshot = snapshot },
      ensureStoreIsUsable: noOp
    }
  }
  class ClockDate extends Date { constructor() { super(now) } }
  const disposeMount = mount.runInNewContext({
    window, document: doc, Date: ClockDate, AbortController, viewState: null,
    console: { error: (error) => calls.errors.push(error), warn: noOp },
    SELECTION_STATE_ELEMENT_ID: 'selection-state',
    reportCowartStartup: noOp, trackCanvasOpened: noOp, restoreCowartViewState: noOp,
    getCowartSelectionSnapshot: () => structuredClone(state.selection),
    getCowartSelectionRecords: () => JSON.stringify(state.selection),
    cowartSelectionRecordsEqual: (left, right) => left === right,
    getCowartViewState: () => structuredClone(state.view),
    writeCowartSelectionState: (snapshot) => calls.dom.push(snapshot),
    saveCowartSelectionState: (snapshot) => { calls.selection.push(snapshot); return state.saveSelection(snapshot) },
    saveCowartViewState: (snapshot) => { calls.view.push(snapshot); return state.saveView(snapshot) },
    refreshCowartCanvasSnapshot: (signal) => { calls.refresh.push(signal); return state.refresh(signal) },
    acceptCowartCanvasSnapshot: (snapshot) => calls.accepted.push(snapshot),
    attachCowartCanvasSaveSession: (savingEditor) => ({
      reset: noOp, dispose: noOp,
      save() {
        const savingSnapshot = savingEditor.store.getStoreSnapshot()
        calls.canvas.push(savingSnapshot)
        return state.saveCanvas(savingSnapshot)
      }
    }),
    downloadCowartFile: (download) => { calls.downloads.push(download); return state.download(download) },
    sanitizeCanvasSnapshotForTldraw: (snapshot) => ({ snapshot, skippedRecords: [] }),
    applyRemoteCanvasSnapshot: (_editor, snapshot) => { calls.applied.push(snapshot); return state.applyRemote(snapshot) },
    storeChangedSinceSnapshot, hasCowartWidgetBridge: () => true,
    retainCowartEditorAssets: noOp, cowartAssetReferencesChanged: () => false,
    revokeCowartAssetObjectUrls: noOp,
    normalizeAiDraftHolderLabels: noOp, adoptGeneratedAiSlidesItems: noOp, layoutAllAiSlides: noOp
  })(editor)
  return {
    state, calls, doc,
    change(snapshot = state.snapshot) { state.snapshot = snapshot; documentListener({ changes: {} }) },
    async advance(ms) {
      const target = now + ms
      await flush()
      for (;;) {
        const next = [...timers].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [id, task] = next
        now = task.at
        if (task.interval) task.at += task.interval
        else timers.delete(id)
        task.callback()
        await flush()
      }
      now = target
    },
    dispose() { disposeMount(); for (const id of ownedTimers) timers.delete(id) },
    get pendingTimers() { return timers.size }
  }
}

test('30 minutes idle saves each state once and leaves selection DOM untouched', async () => {
  const f = fixture()
  await f.advance(30 * 60 * 1000)
  assert.equal(f.calls.view.length, 1, 'Timestamps must not make an unchanged camera dirty')
  assert.equal(f.calls.selection.length, 1)
  assert.equal(f.calls.dom.length, 1, 'Unchanged selection must not rewrite the DOM every 250ms')
  assert.equal(f.calls.refresh.length, 1125, 'Remote updates must continue to reach an idle canvas')
  assert.equal(f.calls.errors.length, 0)
  f.dispose()
  await f.advance(10000)
  assert.equal(f.pendingTimers, 0)
  assert.equal(f.calls.view.length, 1)
  assert.equal(f.calls.refresh.length, 1125)
})

test('page, camera and selection changes save their new values exactly once', async () => {
  const f = fixture()
  await f.advance(500)
  f.state.view.camera.x = 100
  f.state.selection.selectedShapes = [{ id: 'shape:one' }]
  await f.advance(1000)
  assert.equal(f.calls.view.length, 2)
  assert.equal(f.calls.view.at(-1).camera.x, 100)
  assert.equal(f.calls.selection.length, 2)
  assert.equal(f.calls.dom.length, 2)
  f.state.view.currentPageId = 'page:two'
  await f.advance(1000)
  assert.equal(f.calls.view.length, 3)
  assert.equal(f.calls.view.at(-1).currentPageId, 'page:two')
  assert.ok(f.calls.view.every((call) => typeof call.updatedAt === 'string'))
  f.dispose()
})

test('slow saves coalesce rapid edits and persist the latest state', async () => {
  const f = fixture()
  await f.advance(500)
  const view = deferred(), selection = deferred()
  f.state.saveView = () => view.promise
  f.state.saveSelection = () => selection.promise
  f.state.view.camera.x = 1
  f.state.selection.selectedShapes = [{ id: 'shape:first' }]
  await f.advance(500)
  f.state.view.camera.x = 2
  f.state.selection.selectedShapes = [{ id: 'shape:latest' }]
  await f.advance(1000)
  assert.equal(f.calls.view.length, 2)
  assert.equal(f.calls.selection.length, 2)
  f.state.saveView = f.state.saveSelection = async () => {}
  view.resolve(); selection.resolve()
  await flush()
  assert.equal(f.calls.view.length, 3)
  assert.equal(f.calls.view.at(-1).camera.x, 2)
  assert.equal(f.calls.selection.length, 3)
  assert.equal(f.calls.selection.at(-1).selectedShapes[0].id, 'shape:latest')
  await f.advance(1000)
  assert.equal(f.calls.view.length, 3)
  assert.equal(f.calls.selection.length, 3)
  f.dispose()
})

test('failed saves remain dirty and retry on the next tick', async () => {
  const f = fixture()
  await f.advance(500)
  f.state.view.camera.x = 5
  f.state.selection.selectedShapes = [{ id: 'shape:retry' }]
  f.state.saveView = f.state.saveSelection = async () => { throw new Error('Temporary bridge failure') }
  await f.advance(500)
  assert.equal(f.calls.errors.length, 3)
  f.state.saveView = f.state.saveSelection = async () => {}
  await f.advance(1000)
  assert.equal(f.calls.view.length, 3)
  assert.equal(f.calls.selection.length, 4)
  assert.equal(f.calls.dom.length, 2, 'Retries must not churn selection DOM')
  f.dispose()
})

test('slow canvas refresh stays single flight and resumes after completion', async () => {
  const f = fixture(), refresh = deferred()
  f.state.refresh = () => refresh.promise
  await f.advance(10000)
  assert.equal(f.calls.refresh.length, 1)
  assert.equal(f.calls.refresh[0].aborted, false)
  f.state.refresh = async () => ({ store: {} })
  refresh.resolve({ store: {} })
  await flush()
  await f.advance(1200)
  assert.equal(f.calls.refresh.length, 2)
  assert.equal(f.calls.applied.length, 2)
  f.dispose()
})

test('unchanged remote snapshots reconcile once across idle polling', async () => {
  const f = fixture()
  const remote = { schema: {}, store: {} }
  f.state.refresh = async () => remote
  await f.advance(30 * 60 * 1000)
  assert.equal(f.calls.refresh.length, 1125)
  assert.equal(f.calls.applied.length, 1, 'An unchanged revision must not allocate another validation store')
  assert.equal(f.calls.accepted.length, 1)
  const changed = { schema: {}, store: { external: { id: 'external' } } }
  f.state.refresh = async () => changed
  await f.advance(1600)
  assert.equal(f.calls.applied.length, 2)
  assert.equal(f.calls.applied.at(-1), changed)
  f.dispose()
})

test('partially rejected remote snapshots keep retrying until fully applied', async () => {
  const f = fixture(), remote = { schema: {}, store: {} }
  f.state.refresh = async () => remote
  f.state.applyRemote = () => ({ changedRecords: 1, skippedRecords: [{ id: 'shape:retry' }] })
  await f.advance(3200)
  assert.equal(f.calls.applied.length, 2)
  assert.equal(f.calls.accepted.length, 0, 'A partial apply must not advance the save baseline')
  f.state.applyRemote = () => ({ changedRecords: 1, skippedRecords: [] })
  await f.advance(3200)
  assert.equal(f.calls.applied.length, 3)
  assert.equal(f.calls.accepted.length, 1)
  f.dispose()
})

test('unmount aborts a pending refresh and discards a late response', async () => {
  const f = fixture(), refresh = deferred()
  f.state.refresh = () => refresh.promise
  await f.advance(2000)
  f.dispose()
  assert.equal(f.calls.refresh[0].aborted, true)
  refresh.resolve({ store: {} })
  await flush()
  await f.advance(10000)
  assert.equal(f.calls.applied.length, 0)
  assert.equal(f.calls.refresh.length, 1)
  assert.equal(f.pendingTimers, 0)
})


test('dirty canvas polling never advances its applied save baseline', async () => {
  const f = fixture()
  const saving = deferred()
  f.state.saveCanvas = () => saving.promise
  f.change({ schema: {}, store: { local: { id: 'local' } } })
  await f.advance(2000)
  assert.equal(f.calls.canvas.length, 1)
  assert.equal(f.calls.refresh.length, 1)
  assert.equal(f.calls.accepted.length, 0)
  saving.resolve({ ok: true })
  await flush()
  f.dispose()
})

test('save conflict keeps local edits, stops retrying, and requires a successful current backup before loading latest', async () => {
  const f = fixture()
  const local = { schema: {}, store: { local: { id: 'local' } } }
  const latest = { schema: {}, store: { remote: { id: 'remote' } } }
  f.state.saveCanvas = async () => { throw Object.assign(new Error('Canvas changed'), { storage: 'revision-conflict' }) }
  f.change(local)
  await f.advance(10000)
  assert.equal(f.calls.canvas.length, 1, 'A conflict must not become a retry loop')
  assert.equal(f.state.snapshot, local)
  assert.equal(f.calls.loaded.length, 0)
  const notice = f.doc.body.children[0]
  const [message, backup, reload] = notice.children
  assert.equal(reload.disabled, true)
  f.state.download = async () => { throw new Error('download failed') }
  await backup.handlers.click()
  assert.equal(reload.disabled, true)
  assert.match(message.textContent, /备份失败/)
  assert.equal(f.calls.historyCleared.length, 0, 'A failed backup must preserve local undo history')
  f.state.download = async () => ({ ok: true })
  await backup.handlers.click()
  assert.equal(reload.disabled, false)
  assert.equal(JSON.parse(decodeURIComponent(f.calls.downloads.at(-1).dataUrl.split(',').slice(1).join(','))).store.local.id, 'local')
  f.change({ schema: {}, store: { local: { id: 'local', editedAgain: true } } })
  assert.equal(reload.disabled, true, 'Changes after a backup require a new backup')
  await backup.handlers.click()
  assert.equal(reload.disabled, false)
  f.state.refresh = async () => latest
  await reload.handlers.click()
  assert.equal(f.calls.loaded[0], latest)
  assert.deepEqual(f.calls.historyCleared, [latest], 'Clear old undo history only after loading the latest document')
  assert.equal(f.calls.accepted.at(-1), latest)
  assert.equal(notice.removed, true)
  f.state.saveCanvas = async () => ({ ok: true })
  f.change({ ...latest, store: { remote: { id: 'remote', edited: true } } })
  await f.advance(500)
  assert.equal(f.calls.canvas.length, 2, 'Normal saves resume after safely loading the latest canvas')
  f.dispose()
})

test('failed conflict refresh or snapshot load keeps local history until successful recovery', async () => {
  const f = fixture()
  const local = { schema: {}, store: { local: { id: 'local' } } }
  const latest = { schema: {}, store: { remote: { id: 'remote' } } }
  f.state.saveCanvas = async () => { throw Object.assign(new Error('Canvas changed'), { storage: 'revision-conflict' }) }
  f.change(local)
  await f.advance(500)
  const [message, backup, reload] = f.doc.body.children[0].children
  await backup.handlers.click()
  f.state.refresh = async () => { throw new Error('read failed') }
  await reload.handlers.click()
  assert.match(message.textContent, /加载失败/)
  assert.equal(f.state.snapshot, local)
  assert.equal(f.calls.historyCleared.length, 0, 'A failed refresh must preserve local undo history')
  assert.equal(f.calls.accepted.length, 0)
  f.state.refresh = async () => latest
  f.state.loadSnapshot = () => { throw new Error('load failed') }
  await reload.handlers.click()
  assert.match(message.textContent, /load failed/)
  assert.equal(f.state.snapshot, local)
  assert.equal(f.calls.historyCleared.length, 0, 'A failed document load must preserve local undo history')
  assert.equal(f.calls.accepted.length, 0)
  f.state.loadSnapshot = () => {}
  await reload.handlers.click()
  assert.deepEqual(f.calls.historyCleared, [latest])
  assert.equal(f.calls.accepted.at(-1), latest)
  f.dispose()
})

test('changes during a conflict reload are preserved instead of being replaced', async () => {
  const f = fixture()
  f.state.saveCanvas = async () => { throw Object.assign(new Error('Canvas changed'), { storage: 'revision-conflict' }) }
  f.change()
  await f.advance(500)
  const [, backup, reload] = f.doc.body.children[0].children
  await backup.handlers.click()
  const refreshing = deferred()
  f.state.refresh = () => refreshing.promise
  const loading = reload.handlers.click()
  const newestLocal = { schema: {}, store: { local: { id: 'local', duringReload: true } } }
  f.change(newestLocal)
  refreshing.resolve({ schema: {}, store: { remote: { id: 'remote' } } })
  await loading
  assert.equal(f.calls.loaded.length, 0)
  assert.equal(f.state.snapshot, newestLocal)
  assert.equal(reload.disabled, true)
  f.dispose()
})

test('changes before the document listener flushes invalidate a pending conflict backup', async () => {
  const f = fixture()
  f.state.saveCanvas = async () => { throw Object.assign(new Error('Canvas changed'), { storage: 'revision-conflict' }) }
  f.change({ schema: {}, store: { local: { id: 'local' } } })
  await f.advance(500)
  const [, backup, reload] = f.doc.body.children[0].children
  const downloading = deferred()
  f.state.download = () => downloading.promise
  const savingBackup = backup.handlers.click()
  // A tldraw document change is immediately visible in the store, while the
  // user document listener is deferred until the next frame.
  const newestLocal = { schema: {}, store: { local: { id: 'local', beforeListenerFlush: true } } }
  f.state.snapshot = newestLocal
  downloading.resolve({ ok: true })
  await savingBackup
  assert.equal(reload.disabled, true, 'An older backup must not authorize replacing a newer document')
  await reload.handlers.click()
  assert.equal(f.calls.refresh.length, 0)
  assert.equal(f.calls.loaded.length, 0)
  assert.equal(f.state.snapshot, newestLocal)
  f.dispose()
})

test('changes before the document listener flushes are preserved during conflict reload', async () => {
  const f = fixture()
  f.state.saveCanvas = async () => { throw Object.assign(new Error('Canvas changed'), { storage: 'revision-conflict' }) }
  f.change({ schema: {}, store: { local: { id: 'local' } } })
  await f.advance(500)
  const [, backup, reload] = f.doc.body.children[0].children
  await backup.handlers.click()
  const refreshing = deferred()
  f.state.refresh = () => refreshing.promise
  const loading = reload.handlers.click()
  const newestLocal = { schema: {}, store: { local: { id: 'local', beforeListenerFlush: true } } }
  f.state.snapshot = newestLocal
  refreshing.resolve({ schema: {}, store: { remote: { id: 'remote' } } })
  await loading
  assert.equal(f.calls.loaded.length, 0, 'A delayed listener must not allow a new local edit to be replaced')
  assert.equal(f.state.snapshot, newestLocal)
  assert.equal(reload.disabled, true)
  assert.equal(f.calls.accepted.length, 0)
  f.dispose()
})
