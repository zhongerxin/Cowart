import { reportCowartStartup } from './widgetStartup.js'

const CANVAS_ENDPOINT = '/api/canvas'
const SELECTION_ENDPOINT = '/api/selection'
const VIEW_STATE_ENDPOINT = '/api/view-state'

const TOOL_GET_CANVAS_STATE = 'get_cowart_canvas_state'
const TOOL_SAVE_CANVAS_STATE = 'save_cowart_canvas_state'
const TOOL_SAVE_SELECTION_STATE = 'save_cowart_selection_state'
const TOOL_SAVE_VIEW_STATE = 'save_cowart_view_state'
const TOOL_SAVE_REFERENCE_IMAGE = 'save_cowart_reference_image'
const TOOL_READ_PAGE_ASSET = 'read_cowart_page_asset'
const TOOL_DOWNLOAD_FILE = 'download_cowart_file'
const TOOL_COPY_IMAGE_TO_CLIPBOARD = 'copy_cowart_image_to_clipboard'
const TOOL_INSERT_HTML_DRAFT = 'insert_cowart_html_draft'
const WIDGET_PAYLOAD_TIMEOUT_MS = 5000
let cachedCanvasState = null
let appliedCanvasState = null
let canvasWriteQueue = Promise.resolve()

function queueCanvasWrite(operation) {
  const writing = canvasWriteQueue.then(operation)
  canvasWriteQueue = writing.catch(() => {})
  return writing
}

function appliedCanvasBaseline(target) {
  const baseline = appliedCanvasState?.target === target ? appliedCanvasState : null
  if (!baseline?.revision) {
    throw new Error('Cowart has no applied canvas revision. Load the canvas before saving.')
  }
  return baseline
}

globalThis.__COWART_WIDGET_FETCH_GUARD__ = true

export const IS_COWART_WIDGET_BUILD =
  typeof __COWART_WIDGET_BUILD__ !== 'undefined' && __COWART_WIDGET_BUILD__

export function hasCowartWidgetBridge() {
  return Boolean(window.cowartMcp && typeof window.cowartMcp.callServerTool === 'function')
}

function currentWidgetPayload() {
  return window.openai?.toolOutput && typeof window.openai.toolOutput === 'object'
    ? window.openai.toolOutput
    : {}
}

function hasWidgetStorageTarget() {
  const payload = currentWidgetPayload()
  return Boolean(payload.projectDir || payload.canvasDir)
}

function serverToolArgs(extra = {}) {
  const payload = currentWidgetPayload()
  return removeUndefined({
    projectDir: payload.projectDir,
    canvasDir: payload.canvasDir,
    ...extra
  })
}

function canvasTargetKey() {
  return JSON.stringify(serverToolArgs())
}

function cacheCanvasState(state, target) {
  cachedCanvasState = { target, revision: state.revision, snapshot: state.snapshot }
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([_key, item]) => item !== undefined))
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

async function waitForWidgetPayload(signal) {
  if (!hasCowartWidgetBridge()) return
  if (hasWidgetStorageTarget()) {
    reportCowartStartup('storage_target_ready')
    return
  }

  await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    reportCowartStartup('storage_waiting')
    const timer = window.setTimeout(() => {
      cleanup()
      reportCowartStartup('storage_target_timeout')
      reject(new Error('Cowart widget storage target was not ready. Refusing to read or write without projectDir/canvasDir.'))
    }, WIDGET_PAYLOAD_TIMEOUT_MS)
    const cleanup = () => {
      window.clearTimeout(timer)
      window.removeEventListener('openai:set_globals', handleGlobals)
      signal?.removeEventListener('abort', handleAbort)
    }
    const finish = () => {
      cleanup()
      reportCowartStartup('storage_target_ready')
      resolve()
    }
    const handleGlobals = () => {
      if (hasWidgetStorageTarget()) finish()
    }
    const handleAbort = () => {
      cleanup()
      reject(abortError())
    }

    // Host context/capabilities can arrive before the tool result. Keep listening
    // until the storage target arrives; cleanup handles success, abort and timeout.
    window.addEventListener('openai:set_globals', handleGlobals)
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

async function callCowartServerTool(name, args = {}, options = {}) {
  await waitForWidgetPayload(options.signal)
  if (options.signal?.aborted) throw abortError()
  const result = await window.cowartMcp.callServerTool({
    name,
    arguments: serverToolArgs(args)
  }, options)
  if (options.signal?.aborted) throw abortError()
  if (result?.isError) {
    const message = result.content?.find((item) => item.type === 'text')?.text
    const error = new Error(message || `Cowart server tool failed: ${name}`)
    error.storage = result.structuredContent?.storage
    throw error
  }
  return result.structuredContent ?? result
}

async function fetchJson(url, options = {}) {
  const response = await window.fetch(url, options)
  if (!response.ok) {
    throw new Error(`Cowart request failed: ${response.status} - ${response.statusText}`)
  }
  return response.json()
}

export async function loadCowartCanvasState(signal) {
  if (hasCowartWidgetBridge()) {
    reportCowartStartup('canvas_load_started')
    try {
      if (signal?.aborted) throw abortError()
      await waitForWidgetPayload(signal)
      if (signal?.aborted) throw abortError()
      const target = canvasTargetKey()
      // Fullscreen hosts can restore an old opener result after restarting.
      // Read the document and its revision together from storage before mounting;
      // a restored/partial snapshot must never become the save or polling baseline.
      const state = await callCowartServerTool(
        TOOL_GET_CANVAS_STATE,
        { hydrateAssets: false },
        { signal }
      )
      if (canvasTargetKey() !== target) throw new Error('Cowart canvas target changed while loading.')
      if (
        !state?.revision || !Object.hasOwn(state, 'snapshot') || state.unchanged ||
        (state.snapshot === null && state.storage !== 'empty') ||
        (state.snapshot !== null && (!state.snapshot?.schema || !state.snapshot?.store))
      ) {
        throw new Error('Cowart could not load the complete saved canvas state.')
      }
      cacheCanvasState(state, target)
      appliedCanvasState = cachedCanvasState
      reportCowartStartup('canvas_state_loaded')
      return {
        snapshot: state.snapshot,
        viewState: state.viewState ?? null,
        storage: state.storage,
        skippedRecords: []
      }
    } catch (error) {
      if (error.name !== 'AbortError') reportCowartStartup('canvas_load_failed')
      throw error
    }
  }

  const [canvasData, viewStateData] = await Promise.all([
    fetchJson(CANVAS_ENDPOINT, { signal }),
    fetchJson(VIEW_STATE_ENDPOINT, { signal })
  ])
  return {
    snapshot: canvasData.snapshot,
    viewState: viewStateData.viewState ?? null,
    storage: canvasData.storage,
    skippedRecords: []
  }
}

export async function refreshCowartCanvasSnapshot(signal) {
  if (hasCowartWidgetBridge()) {
    const target = canvasTargetKey()
    const cached = cachedCanvasState?.target === target ? cachedCanvasState : null
    const state = await callCowartServerTool(
      TOOL_GET_CANVAS_STATE,
      { hydrateAssets: false, ifRevision: cached?.revision },
      { signal }
    )
    // Reuse the last snapshot for reconciliation, including changes received
    // while local edits were pending. Retain only one response, never a history.
    if (state.unchanged && cached && state.revision === cached.revision) return cached.snapshot
    cacheCanvasState(state, target)
    return state.snapshot
  }

  const canvasData = await fetchJson(CANVAS_ENDPOINT, { signal })
  return canvasData.snapshot
}

// Polling may observe a new revision while the editor has unsaved changes.
// Only advance the save baseline once that state has actually been applied.
export function acceptCowartCanvasSnapshot(snapshot) {
  const target = canvasTargetKey()
  if (cachedCanvasState?.target === target && cachedCanvasState.snapshot === snapshot) {
    appliedCanvasState = cachedCanvasState
  }
}

export async function saveCowartCanvasSnapshot(snapshot, options = {}) {
  if (hasCowartWidgetBridge()) {
    const target = canvasTargetKey()
    return queueCanvasWrite(async () => {
      if (canvasTargetKey() !== target) throw new Error('Cowart canvas target changed before saving.')
      const baseline = appliedCanvasBaseline(target)
      // A DOM edit may be ahead of this save in the queue. Read the editor only
      // after that write and its local delta finish, never capture an old draft.
      const savingSnapshot = typeof snapshot === 'function' ? snapshot() : snapshot
      const result = await callCowartServerTool(TOOL_SAVE_CANVAS_STATE, {
        snapshot: savingSnapshot,
        expectedRevision: baseline.revision,
        protectImageRecords: options.protectImageRecords,
        acknowledgedImageShapeDeletes: options.acknowledgedImageShapeDeletes
      })
      if (result?.ok !== false && result?.revision) {
        appliedCanvasState = { target, revision: result.revision, snapshot: savingSnapshot }
        // A write can race a poll. Do not reuse a pre-write poll as unchanged.
        cachedCanvasState = null
      }
      return result
    })
  }

  const savingSnapshot = typeof snapshot === 'function' ? snapshot() : snapshot
  return fetchJson(CANVAS_ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(savingSnapshot)
  })
}

export async function saveCowartSelectionState(selection) {
  if (hasCowartWidgetBridge()) {
    return callCowartServerTool(TOOL_SAVE_SELECTION_STATE, { selection })
  }

  return fetchJson(SELECTION_ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(selection)
  })
}

export async function saveCowartViewState(viewState) {
  if (hasCowartWidgetBridge()) {
    return callCowartServerTool(TOOL_SAVE_VIEW_STATE, { viewState })
  }

  return fetchJson(VIEW_STATE_ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(viewState)
  })
}

export async function saveCowartReferenceImage(reference) {
  if (!hasCowartWidgetBridge()) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 文件保存桥。')
  }

  return callCowartServerTool(TOOL_SAVE_REFERENCE_IMAGE, reference)
}

export async function downloadCowartFile(download) {
  if (!hasCowartWidgetBridge()) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 文件下载桥。')
  }

  return callCowartServerTool(TOOL_DOWNLOAD_FILE, download)
}

export async function copyCowartImageToClipboard(image) {
  if (!hasCowartWidgetBridge()) {
    throw new Error('当前 Cowart 画布没有可用的系统剪贴板桥。')
  }

  return callCowartServerTool(TOOL_COPY_IMAGE_TO_CLIPBOARD, image)
}

export async function updateCowartHtmlDraft({ draftShapeId, htmlContent }, { applyResult } = {}) {
  if (!hasCowartWidgetBridge()) {
    const result = await fetchJson('/api/html-draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftShapeId, htmlContent })
    })
    if (applyResult) await applyResult(result)
    return result
  }

  const target = canvasTargetKey()
  return queueCanvasWrite(async () => {
    if (canvasTargetKey() !== target) throw new Error('Cowart canvas target changed before saving the HTML draft.')
    const baseline = appliedCanvasBaseline(target)
    const result = await callCowartServerTool(TOOL_INSERT_HTML_DRAFT, {
      draftShapeId,
      htmlContent,
      updateExistingDraft: true,
      expectedRevision: baseline.revision
    })
    if (
      canvasTargetKey() !== target || appliedCanvasState?.target !== target ||
      appliedCanvasState.revision !== baseline.revision
    ) {
      // Polling can apply this edit, or an even newer remote edit, before its
      // delayed response arrives. Never replay the older metadata over it.
      cachedCanvasState = null
      return result
    }
    // The server checked the prior revision before writing the file. Apply the
    // exact persisted delta before releasing the queue to the next autosave.
    const applied = applyResult ? await applyResult(result) : false
    if (
      applied !== false && result?.revision && result?.shapeRecord &&
      result.previousRevision === baseline.revision &&
      appliedCanvasState?.target === target && appliedCanvasState.revision === baseline.revision
    ) {
      appliedCanvasState = {
        target,
        revision: result.revision,
        snapshot: { ...baseline.snapshot, store: { ...baseline.snapshot?.store, [result.shapeId]: result.shapeRecord } }
      }
      cachedCanvasState = null
    }
    return result
  })
}

export async function readCowartPageAsset(assetUrl, options = {}) {
  if (!hasCowartWidgetBridge()) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 文件读取桥。')
  }

  return callCowartServerTool(TOOL_READ_PAGE_ASSET, { assetUrl }, options)
}
