import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setImmediate as flush } from 'node:timers/promises'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const client = new Client({ name: 'cowart-startup-probe', version: '1.0.0' })
let html
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['./scripts/start-mcp.mjs'],
    cwd: root,
    env: { ...process.env, COWART_PLUGIN_ROOT: root }
  }))
  const resource = await client.readResource({ uri: 'ui://widget/cowart/canvas.html' })
  html = resource.contents[0].text
} finally {
  await client.close()
}

// Exercise the bootstrap/bridge served by the release bundle, not a copied script.
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
for (const [, , source] of scripts) new vm.Script(source)
assert.match(scripts[0][1], /cowartStartupDiagnostics/)
const script = (id) => {
  const match = scripts.find(([, attrs]) => attrs.includes(`id="${id}"`))
  assert.ok(match, `Missing widget script: ${id}`)
  return new vm.Script(match[2])
}
const bootstrap = script('cowartStartupDiagnostics')
const displayModeScript = script('cowartInitialDisplayMode')
const bridge = script('cowartMcpHostBridge')
const sdkSource = scripts.find(([, attrs]) => attrs.includes('id="cowartMcpAppsBundle"'))?.[2]
assert.ok(sdkSource, 'The release resource must include the standalone MCP Apps SDK')
assert.doesNotMatch(sdkSource, /console\.debug\s*\(/, 'SDK debug logs must not retain full JSON-RPC asset payloads')
assert.ok(!sdkSource.includes('Parsed message'), 'Parsed asset responses must not be retained as console arguments')
const clientBundle = await build({
  absWorkingDir: root,
  entryPoints: ['src/cowartClient.js'],
  bundle: true,
  format: 'iife',
  globalName: 'cowartClient',
  write: false,
  logLevel: 'silent'
})
const clientScript = new vm.Script(clientBundle.outputFiles[0].text)

const savedSnapshot = {
  schema: { schemaVersion: 2, sequences: {} },
  store: {
    'page:existing': { id: 'page:existing', typeName: 'page', name: 'Saved page', index: 'a1', meta: {} },
    'shape:existing': { id: 'shape:existing', typeName: 'shape', type: 'frame', parentId: 'page:existing',
      index: 'a1', x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {},
      props: { w: 320, h: 180, name: 'Saved frame' } },
  },
}
const savedCanvasState = { snapshot: savedSnapshot, revision: 'one',
  viewState: { currentPageId: 'page:existing' }, storage: 'per-page' }

function harness({ missingSdk = false, constructorError = false, toolError = false,
  canvasState = savedCanvasState, hostContext = { theme: 'light', displayMode: 'inline' }, grantedMode = 'fullscreen' } = {}) {
  const window = new EventTarget()
  const calls = []
  const logs = []
  const displayRequests = []
  const contexts = []
  const messages = []
  const timers = new Map()
  let now = 0
  let nextTimer = 0
  const setTimeout = (callback, ms) => {
    const id = ++nextTimer
    timers.set(id, { callback, at: now + ms })
    return id
  }
  const clearTimeout = (id) => timers.delete(id)
  Object.assign(window, { setTimeout, clearTimeout, openai: {}, innerWidth: 800 })
  let resolveConnect, rejectConnect
  const connection = new Promise((resolve, reject) => {
    resolveConnect = resolve
    rejectConnect = reject
  })
  class FakeApp {
    handlers = new Map()
    constructor() {
      if (constructorError) throw new Error('private constructor details')
    }
    addEventListener(event, handler) { this.handlers.set(event, handler) }
    connect() { return connection }
    getHostCapabilities() { return { serverTools: {} } }
    getHostVersion() { return { name: 'test-host', version: '1' } }
    getHostContext() { return hostContext }
    async requestDisplayMode(request) { displayRequests.push(request); return { mode: grantedMode } }
    sendSizeChanged() {}
    async updateModelContext(request) { contexts.push(request); return {} }
    async sendMessage(request) { messages.push(request); return {} }
    async callServerTool(request) {
      calls.push(request)
      if (toolError) return { isError: true, content: [{ type: 'text', text: 'private tool failure' }] }
      return { structuredContent: request.name === 'get_cowart_canvas_state'
        ? canvasState : { ok: true, revision: 'saved' } }
    }
  }
  const context = vm.createContext({
    window, setTimeout, clearTimeout, CustomEvent, DOMException,
    document: { documentElement: { scrollHeight: 600, offsetHeight: 600 }, body: null },
    console: {
      warn: (line) => logs.push({ level: 'warn', line }),
      error: (line) => logs.push({ level: 'error', line })
    }
  })
  bootstrap.runInContext(context)
  displayModeScript.runInContext(context)
  if (!missingSdk) context.__COWART_MCP_APPS__ = { App: FakeApp }
  bridge.runInContext(context)
  clientScript.runInContext(context)

  return {
    window, calls, logs, timers, context, displayRequests, contexts, messages,
    stages: () => Array.from(context.__COWART_STARTUP__.events, ({ stage }) => stage),
    load: (signal) => context.cowartClient.loadCowartCanvasState(signal),
    async ready() {
      resolveConnect()
      await context.__COWART_MCP_APP__.ready
    },
    async failConnection() {
      rejectConnect(new Error('private connection details'))
      await context.__COWART_MCP_APP__.ready
    },
    result(payload) {
      context.__COWART_MCP_APP__.handlers.get('toolresult')({ structuredContent: payload })
    },
    rawResult(result) {
      context.__COWART_MCP_APP__.handlers.get('toolresult')(result)
    },
    input(args) {
      context.__COWART_MCP_APP__.handlers.get('toolinput')({ arguments: args })
    },
    globals() {
      context.__COWART_MCP_APP__.handlers.get('hostcontextchanged')({ theme: 'dark' })
    },
    async advance(ms) {
      await flush()
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.callback()
        }
      }
      await flush()
    },
    assertClean() {
      assert.equal(getEventListeners(window, 'openai:set_globals').length, 0)
      assert.equal(timers.size, 0)
    }
  }
}

test('host readiness and unrelated globals before the project still load the canvas', async () => {
  const h = harness()
  const loaded = h.load()
  const result = loaded.then((value) => ({ value }), (error) => ({ error }))
  await h.ready()
  h.globals()
  h.result({ title: 'Still waiting for the storage target' })
  assert.equal(h.calls.length, 0)
  const projectDir = 'C:\\Cowart startup probe\\project'
  h.result({ projectDir })
  await h.advance(5000)
  const outcome = await result
  assert.equal(outcome.error, undefined)
  assert.equal(outcome.value.storage, 'per-page')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].name, 'get_cowart_canvas_state')
  assert.equal(h.calls[0].arguments.projectDir, projectDir)
  assert.equal(h.calls[0].arguments.hydrateAssets, false)
  assert.ok(h.stages().includes('canvas_state_loaded'))
  assert.ok(!h.stages().includes('storage_target_timeout'))
  h.assertClean()
})

test('a project already supplied before loading does not wait for another notification', async () => {
  const h = harness()
  h.result({ projectDir: '/startup-probe/project' })
  await h.ready()
  await h.load()
  assert.equal(h.calls.length, 1)
  assert.ok(!h.stages().includes('storage_waiting'))
  h.assertClean()
})

test('a late canvasDir alone is a valid storage target', async () => {
  const h = harness()
  await h.ready()
  const loaded = h.load()
  h.globals()
  h.result({ canvasDir: '/startup-probe/custom-canvas' })
  await loaded
  assert.equal(h.calls[0].arguments.canvasDir, '/startup-probe/custom-canvas')
  assert.equal(h.calls[0].arguments.projectDir, undefined)
  h.assertClean()
})

test('missing targets time out without making tool calls and remove listeners', async () => {
  const h = harness()
  await h.ready()
  const rejected = assert.rejects(h.load(), /storage target was not ready/)
  h.globals()
  await h.advance(5000)
  await rejected
  h.result({ projectDir: '/too-late' })
  assert.equal(h.calls.length, 0)
  assert.ok(h.stages().includes('storage_target_timeout'))
  assert.ok(h.stages().includes('canvas_load_failed'))
  h.assertClean()
})

test('aborting one pending mount does not break the next mount', async () => {
  const h = harness()
  await h.ready()
  const controller = new AbortController()
  const rejected = assert.rejects(h.load(controller.signal), { name: 'AbortError' })
  const loaded = h.load()
  controller.abort()
  h.globals()
  h.result({ projectDir: '/startup-probe/project' })
  await Promise.all([rejected, loaded])
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  assert.equal(h.calls.length, 1)
  assert.ok(!h.stages().includes('canvas_load_failed'))
  h.assertClean()
})

test('an already aborted load never calls the server', async () => {
  const h = harness()
  await h.ready()
  await assert.rejects(h.load(AbortSignal.abort()), { name: 'AbortError' })
  h.result({ projectDir: '/startup-probe/project' })
  await assert.rejects(h.load(AbortSignal.abort()), { name: 'AbortError' })
  assert.equal(h.calls.length, 0)
  h.assertClean()
})

test('a stalled bridge logs a timeout and can still connect later', async () => {
  const h = harness()
  await h.advance(5000)
  assert.ok(h.stages().includes('bridge_timeout'))
  await h.ready()
  h.result({ projectDir: '/startup-probe/project' })
  await h.load()
  assert.ok(h.stages().includes('bridge_ready'))
  h.assertClean()
})

test('bridge rejection and synchronous initialization failure are logged', async () => {
  const h = harness()
  await h.failConnection()
  h.result({ projectDir: '/startup-probe/project' })
  await assert.rejects(h.load(), /private connection details/)
  assert.ok(h.stages().includes('bridge_failed'))
  assert.equal(h.calls.length, 0)
  assert.ok(h.logs.every(({ line }) => !line.includes('private')))
  h.assertClean()
  const sync = harness({ constructorError: true })
  assert.ok(sync.stages().includes('bridge_failed'))
  sync.assertClean()
})

test('SDK absence, script errors and rejected promises are observable without private details', () => {
  const h = harness({ missingSdk: true })
  assert.deepEqual(h.stages(), ['html_loaded', 'sdk_missing'])
  for (const type of ['error', 'unhandledrejection']) {
    h.window.dispatchEvent(Object.assign(new Event(type), { message: 'private path', reason: 'private token' }))
  }
  assert.ok(h.stages().includes('script_error'))
  assert.ok(h.stages().includes('unhandled_rejection'))
  assert.ok(h.logs.every(({ line }) => !line.includes('private')))
  h.assertClean()
})

test('tool failures log a stage without copying the error payload', async () => {
  const h = harness({ toolError: true })
  await h.ready()
  h.result({ projectDir: '/startup-probe/project' })
  await assert.rejects(h.load(), /private tool failure/)
  assert.ok(h.stages().includes('canvas_load_failed'))
  assert.ok(h.logs.every(({ line }) => !line.includes('private')))
  h.assertClean()
})

test('diagnostics have the release version, deduplicate stages and stop after mounting', async () => {
  const h = harness()
  await h.ready()
  h.result({ projectDir: '/private/project', prompt: 'private prompt' })
  await h.load()
  h.result({ projectDir: '/private/project' })
  h.context.__COWART_REPORT_STARTUP__('private path is not a valid stage')
  assert.equal(h.stages().filter((stage) => stage === 'tool_result_received').length, 1)
  assert.ok(h.logs.every(({ line }) => line.includes(`version=${version} `) && !line.includes('private')))
  h.context.__COWART_REPORT_STARTUP__('canvas_mounted')
  const count = h.logs.length
  h.result({ projectDir: '/private/project' })
  h.window.dispatchEvent(new Event('error'))
  assert.equal(h.logs.length, count)
  assert.equal(getEventListeners(h.window, 'error').length, 0)
  assert.equal(getEventListeners(h.window, 'unhandledrejection').length, 0)
  h.assertClean()
})

test('global canvas context and follow-ups use Documents even when the chat has another cwd', async () => {
  const h = harness()
  await h.ready()
  const target = { globalWorkspace: true, projectDir: '/Documents/Cowart', canvasDir: '/Documents/Cowart/canvas' }
  h.result({ view: 'canvas', ...target })
  await flush()
  assert.ok(!h.stages().includes('tool_result_missing_target'))
  assert.equal(h.contexts.length, 1)
  assert.match(h.contexts[0].content[0].text, /\/Documents\/Cowart\/canvas/)
  const content = [{ type: 'text', text: 'Generate an image in this holder.' }]
  await h.window.cowartMcp.sendFollowUpMessage({ prompt: content[0].text, content })
  assert.equal(content.length, 1, 'Do not mutate the caller message when attaching the workspace')
  assert.equal(h.messages[0].content.length, 2)
  assert.match(h.messages[0].content[1].text, /\/Documents\/Cowart\/canvas/)
  assert.equal(h.calls.length, 0)
  h.assertClean()
})

test('project conversations keep their original follow-up content without global context', async () => {
  const h = harness()
  await h.ready()
  h.result({ projectDir: '/projects/existing', canvasDir: '/projects/existing/canvas' })
  const message = { prompt: 'Continue editing this project.', content: [{ type: 'text', text: 'Continue editing this project.' }] }
  await h.window.cowartMcp.sendFollowUpMessage(message)
  assert.equal(h.contexts.length, 0)
  assert.equal(JSON.stringify(h.messages[0].content), JSON.stringify(message.content))
  h.assertClean()
})

test('first canvas load reads authoritative state even when the opener supplies a document', async () => {
  const h = harness()
  await h.ready()
  h.result({ projectDir: '/startup-probe/project', canvasState: { snapshot: null, viewState: null, storage: 'empty' } })
  const result = await h.load()
  assert.equal(result.storage, 'per-page')
  assert.equal(result.snapshot, savedSnapshot)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].arguments.ifRevision, undefined)
  h.assertClean()
})

test('restored opener revisions ahead of storage cannot become the save baseline', async () => {
  const h = harness()
  await h.ready()
  h.result({ projectDir: '/startup-probe/project', canvasState: {
    snapshot: { schema: savedSnapshot.schema, store: {} }, revision: 'future-opener-revision', storage: 'per-page'
  } })
  const loaded = await h.load()
  assert.equal(loaded.snapshot, savedSnapshot)
  await h.context.cowartClient.saveCowartCanvasSnapshot(loaded.snapshot)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].arguments.ifRevision, undefined)
  assert.equal(h.calls[1].arguments.expectedRevision, savedCanvasState.revision)
  h.assertClean()
})

test('an incomplete authoritative startup response never falls back to a valid opener', async () => {
  for (const canvasState of [
    { snapshot: savedSnapshot, storage: 'per-page' },
    { revision: 'one', storage: 'per-page' },
    { revision: 'one', snapshot: undefined, storage: 'per-page' },
    { revision: 'one', snapshot: null, storage: 'per-page' },
    { revision: 'one', snapshot: null, storage: 'empty', unchanged: true },
    { revision: 'one', snapshot: { store: {} }, storage: 'per-page' },
    { revision: 'one', snapshot: { schema: {} }, storage: 'per-page' },
  ]) {
    const h = harness({ canvasState })
    await h.ready()
    h.result({ projectDir: '/startup-probe/project', canvasState: savedCanvasState })
    await assert.rejects(h.load(), /complete saved canvas state/)
    await assert.rejects(h.context.cowartClient.saveCowartCanvasSnapshot(savedSnapshot), /no applied canvas revision/)
    assert.equal(h.calls.length, 1)
    assert.ok(h.stages().includes('canvas_load_failed'))
    h.assertClean()
  }
  const h = harness({ canvasState: { snapshot: null, revision: 'empty-revision', storage: 'empty', viewState: null } })
  await h.ready()
  h.result({ projectDir: '/startup-probe/new-project', canvasState: savedCanvasState })
  assert.equal((await h.load()).snapshot, null, 'An authoritative empty project remains a valid startup result')
  h.assertClean()
})

test('a storage target changed during the startup read cannot publish a previous project baseline', async () => {
  const h = harness()
  await h.ready()
  h.result({ projectDir: '/startup-probe/project' })
  const app = h.context.__COWART_MCP_APP__
  const originalCall = app.callServerTool.bind(app)
  let complete
  app.callServerTool = () => new Promise((resolve) => { complete = resolve })
  const rejected = assert.rejects(h.load(), /target changed while loading/)
  await flush()
  h.result({ projectDir: '/startup-probe/other-project' })
  complete({ structuredContent: savedCanvasState })
  await rejected
  await assert.rejects(h.context.cowartClient.saveCowartCanvasSnapshot(savedSnapshot), /no applied canvas revision/)
  app.callServerTool = originalCall
  await h.load()
  assert.equal(h.calls.at(-1).arguments.projectDir, '/startup-probe/other-project')
  h.assertClean()
})

test('an aborted startup read rejects a late response and allows the next mount to read afresh', async () => {
  const h = harness()
  await h.ready()
  h.result({ projectDir: '/startup-probe/project' })
  const app = h.context.__COWART_MCP_APP__
  const originalCall = app.callServerTool.bind(app)
  const controller = new AbortController()
  let complete
  app.callServerTool = () => new Promise((resolve) => { complete = resolve })
  const rejected = assert.rejects(h.load(controller.signal), { name: 'AbortError' })
  await flush()
  controller.abort()
  complete({ structuredContent: savedCanvasState })
  await rejected
  await assert.rejects(h.context.cowartClient.saveCowartCanvasSnapshot(savedSnapshot), /no applied canvas revision/)
  app.callServerTool = originalCall
  assert.equal((await h.load()).snapshot, savedSnapshot)
  assert.equal(h.calls.length, 1)
  assert.ok(!h.stages().includes('canvas_load_failed'))
  h.assertClean()
})

test('canvas refresh forwards cancellation through the release bridge', async () => {
  const h = harness()
  await h.ready()
  h.result({ projectDir: '/startup-probe/project' })
  const controller = new AbortController()
  let signal
  h.context.__COWART_MCP_APP__.callServerTool = async (_request, options) => {
    signal = options.signal
    return { structuredContent: { snapshot: null } }
  }
  await h.context.cowartClient.refreshCowartCanvasSnapshot(controller.signal)
  assert.equal(signal, controller.signal)
  h.assertClean()
})

test('server tool deadlines belong to the SDK rather than abandoned promise races', async () => {
  const h = harness()
  await h.ready()
  const deadlines = []
  h.context.__COWART_MCP_APP__.callServerTool = async (_request, options) => {
    deadlines.push(options.timeout)
    assert.equal(h.timers.size, 0, 'No separate deadline may abandon the SDK request')
    return { structuredContent: { ok: true } }
  }
  await h.window.cowartMcp.callServerTool({ name: 'get_cowart_canvas_state' })
  await h.window.cowartMcp.callServerTool({ name: 'get_cowart_canvas_state' }, { timeoutMs: 7000 })
  await h.window.cowartMcp.callServerTool({ name: 'get_cowart_canvas_state' }, { timeout: 9000 })
  assert.deepEqual(deadlines, [30000, 7000, 9000])
  h.assertClean()
})

test('conditional refresh reuses one snapshot and advances its revision after a remote edit', async () => {
  const original = { schema: savedSnapshot.schema, store: { 'shape:one': { text: 'original' } } }
  const edited = { schema: savedSnapshot.schema, store: { 'shape:one': { text: 'edited' } } }
  const h = harness({ canvasState: { ...savedCanvasState, snapshot: original } })
  await h.ready()
  h.result({ projectDir: '/startup-probe/project', canvasState: { snapshot: original, revision: 'one' } })
  await h.load()
  const requests = []
  let next = { snapshot: null, unchanged: true, revision: 'one' }
  h.context.__COWART_MCP_APP__.callServerTool = async (request) => {
    requests.push(request)
    return { structuredContent: next }
  }
  assert.equal(await h.context.cowartClient.refreshCowartCanvasSnapshot(), original)
  assert.equal(requests.at(-1).arguments.ifRevision, 'one')
  next = { snapshot: edited, revision: 'two' }
  assert.equal(await h.context.cowartClient.refreshCowartCanvasSnapshot(), edited)
  next = { snapshot: null, unchanged: true, revision: 'two' }
  assert.equal(await h.context.cowartClient.refreshCowartCanvasSnapshot(), edited)
  assert.equal(requests.at(-1).arguments.ifRevision, 'two')
  h.result({ projectDir: '/startup-probe/other-project' })
  next = { snapshot: null, revision: 'other' }
  await h.context.cowartClient.refreshCowartCanvasSnapshot()
  assert.equal(requests.at(-1).arguments.ifRevision, undefined, 'A different project cannot reuse the old canvas revision')
  h.assertClean()
})

test('a canceled canvas refresh rejects even if the host delivers a late result', async () => {
  const h = harness()
  await h.ready()
  h.result({ projectDir: '/startup-probe/project' })
  const controller = new AbortController()
  let complete
  h.context.__COWART_MCP_APP__.callServerTool = () => new Promise((resolve) => { complete = resolve })
  const refresh = h.context.cowartClient.refreshCowartCanvasSnapshot(controller.signal)
  await flush()
  controller.abort()
  complete({ structuredContent: { snapshot: null } })
  await assert.rejects(refresh, { name: 'AbortError' })
  h.assertClean()
})

test('project conversation JSON content wrappers preserve the target and initial state', async () => {
  for (const layers of [1, 2]) {
    const h = harness()
    await h.ready()
    const loaded = h.load()
    const payload = { projectDir: '/projects/项目 with spaces', canvasDir: '/projects/项目 with spaces/canvas',
      canvasState: { snapshot: null, viewState: { currentPageId: 'page:existing' }, storage: 'per-page' } }
    let result = { content: [{ type: 'text', text: 'Rendered Cowart canvas widget.' }],
      structuredContent: payload, _meta: { widgetData: payload } }
    for (let i = 0; i < layers; i++) result = { content: [{ type: 'text', text: JSON.stringify(result) }] }
    h.rawResult(result)
    const state = await loaded
    assert.equal(state.storage, 'per-page')
    assert.equal(state.viewState.currentPageId, 'page:existing')
    assert.equal(h.window.openai.toolOutput.projectDir, payload.projectDir)
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].arguments.projectDir, payload.projectDir)
    assert.equal(h.calls[0].arguments.canvasDir, payload.canvasDir)
    assert.equal(state.snapshot, savedSnapshot)
    assert.ok(!h.stages().includes('tool_result_missing_target'))
    h.assertClean()
  }
})

test('an explicit project input survives a malformed old result and reads through the app bridge', async () => {
  const h = harness()
  await h.ready()
  const loaded = h.load()
  const projectDir = '/projects/existing'
  h.input({ projectDir })
  // This is the extra closing brace present in the failing conversation result.
  h.rawResult({ content: [{ type: 'text', text: JSON.stringify({ structuredContent: { projectDir } }) + '}' }] })
  await loaded
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].arguments.projectDir, projectDir)
  assert.equal(h.calls[0].arguments.hydrateAssets, false)
  assert.ok(!h.stages().includes('storage_target_timeout'))
  h.assertClean()
})

test('empty sidebar inputs cannot replace the resolved global workspace', async () => {
  const h = harness()
  await h.ready()
  h.input({})
  assert.equal(h.window.openai.toolOutput, undefined)
  h.result({ globalWorkspace: true, projectDir: '/Documents/Cowart', canvasDir: '/Documents/Cowart/canvas' })
  h.input({})
  h.rawResult({ content: [{ type: 'text', text: 'Not a storage target' }] })
  await h.load()
  assert.equal(h.calls[0].arguments.projectDir, '/Documents/Cowart')
  h.assertClean()
})

test('standard tool-result postMessages use params directly', async () => {
  const h = harness()
  await h.ready()
  const loaded = h.load()
  h.window.dispatchEvent(Object.assign(new Event('message'), { data: {
    method: 'ui/notifications/tool-result', params: { structuredContent: { projectDir: '/projects/existing' } }
  } }))
  await loaded
  assert.equal(h.calls[0].arguments.projectDir, '/projects/existing')
  h.assertClean()
})

test('fullscreen is requested once only for an inline host advertising fullscreen', async () => {
  const h = harness({ hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } })
  await h.ready()
  h.globals()
  h.result({ projectDir: '/startup-probe/project' })
  assert.equal(h.displayRequests.length, 1)
  assert.equal(h.displayRequests[0].mode, 'fullscreen')
  h.assertClean()
})

test('host placement is respected when already fullscreen or fullscreen is unavailable', async () => {
  for (const hostContext of [
    { displayMode: 'fullscreen', availableDisplayModes: ['fullscreen'] },
    { displayMode: 'inline', availableDisplayModes: ['inline'] },
    { displayMode: 'inline' }
  ]) {
    const h = harness({ hostContext })
    await h.ready()
    assert.equal(h.displayRequests.length, 0)
    h.assertClean()
  }
  const h = harness({ hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] }, grantedMode: 'inline' })
  await h.ready()
  assert.equal(h.window.openai.displayMode, 'inline')
  assert.equal(h.displayRequests.length, 1)
  h.assertClean()
})


test('widget saves use the applied revision, not a dirty polling response, and expose CAS conflicts', async () => {
  const baseline = { schema: {}, store: {} }
  const h = harness({ canvasState: { ...savedCanvasState, snapshot: baseline } })
  await h.ready()
  const remote = { schema: {}, store: { remote: { id: 'remote' } } }
  h.result({ projectDir: '/startup-probe/project', canvasState: { snapshot: baseline, revision: 'one' } })
  await h.load()
  const requests = []
  let saveAllowed = false
  h.context.__COWART_MCP_APP__.callServerTool = async (request) => {
    requests.push(request)
    if (request.name === 'get_cowart_canvas_state') return { structuredContent: { snapshot: remote, revision: 'two' } }
    if (!saveAllowed) return { isError: true, content: [{ type: 'text', text: 'Canvas changed' }],
      structuredContent: { ok: false, storage: 'revision-conflict', revision: 'two' } }
    return { structuredContent: { ok: true, revision: 'three' } }
  }
  const polled = await h.context.cowartClient.refreshCowartCanvasSnapshot()
  await assert.rejects(h.context.cowartClient.saveCowartCanvasSnapshot(baseline), (error) => error.storage === 'revision-conflict')
  assert.equal(requests.at(-1).arguments.expectedRevision, 'one', 'An unapplied poll must not authorize an old full snapshot')
  h.context.cowartClient.acceptCowartCanvasSnapshot(polled)
  saveAllowed = true
  await h.context.cowartClient.saveCowartCanvasSnapshot(remote)
  assert.equal(requests.at(-1).arguments.expectedRevision, 'two')
  await h.context.cowartClient.saveCowartCanvasSnapshot(remote)
  assert.equal(requests.at(-1).arguments.expectedRevision, 'three')
  h.assertClean()
})

test('HTML delta acceptance never rolls back a revision applied while the tool was pending', async () => {
  const baseline = { schema: {}, store: { draft: { id: 'draft', meta: {} } } }
  const h = harness({ canvasState: { ...savedCanvasState, snapshot: baseline } })
  await h.ready()
  const remote = { schema: {}, store: { draft: { id: 'draft', meta: { changed: true } }, inserted: { id: 'inserted' } } }
  h.result({ projectDir: '/startup-probe/project', canvasState: { snapshot: baseline, revision: 'one' } })
  await h.load()
  let resolveHtml
  const html = new Promise((resolve) => { resolveHtml = resolve })
  const requests = []
  h.context.__COWART_MCP_APP__.callServerTool = async (request) => {
    requests.push(request)
    if (request.name === 'insert_cowart_html_draft') return html
    if (request.name === 'get_cowart_canvas_state') return { structuredContent: { snapshot: remote, revision: 'three' } }
    return { structuredContent: { ok: true, revision: 'four' } }
  }
  let appliedDeltas = 0
  const editing = h.context.cowartClient.updateCowartHtmlDraft({ draftShapeId: 'draft', htmlContent: '<html>edit</html>' }, {
    applyResult() { appliedDeltas++; return true },
  })
  await flush()
  assert.equal(requests[0].arguments.expectedRevision, 'one')
  const polled = await h.context.cowartClient.refreshCowartCanvasSnapshot()
  h.context.cowartClient.acceptCowartCanvasSnapshot(polled)
  resolveHtml({ structuredContent: { shapeId: 'draft', shapeRecord: { id: 'draft', meta: { changed: true } }, previousRevision: 'one', revision: 'two' } })
  await editing
  assert.equal(appliedDeltas, 0, 'A delayed HTML delta must not overwrite metadata from a newer applied revision')
  await h.context.cowartClient.saveCowartCanvasSnapshot(remote)
  assert.equal(requests.at(-1).arguments.expectedRevision, 'three', 'An older known delta must not replace an already applied newer baseline')
  h.assertClean()
})

test('local development HTML edits still apply their saved result', async () => {
  const h = harness()
  await h.ready()
  delete h.window.cowartMcp
  const saved = { assetUrl: '/page-assets/page/draft.html', contentHash: 'edited' }
  h.window.fetch = async () => ({ ok: true, json: async () => saved })
  let applied
  const result = await h.context.cowartClient.updateCowartHtmlDraft({ draftShapeId: 'draft', htmlContent: '<html>edit</html>' }, {
    applyResult(value) { applied = value; return true },
  })
  assert.equal(result, saved)
  assert.equal(applied, saved)
  h.assertClean()
})
