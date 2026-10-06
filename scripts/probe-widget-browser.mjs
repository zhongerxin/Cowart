// Optional real-browser regression for the generated standalone Widget.
// Run: node scripts/probe-widget-browser.mjs [--project-dir=/absolute/project] [--restored-startup]
// Open the printed URL with an approved browser tool, then run the page cycle.
// This is a test MCP Apps host, not Cowart's normal plugin launch flow.
// All tool writes go to a disposable copy; source canvas data stays read-only.
import { createServer } from 'node:http'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  readCowartCanvasState,
  readCowartPageAsset,
  saveCowartCanvasSnapshot,
  writeCowartSelectionState,
  writeCowartViewState,
} from '../mcp/lib/canvas-storage.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const sourceProjectDir = resolve(process.argv.find((arg) => arg.startsWith('--project-dir='))?.slice(14) || root)
const temporaryDir = await mkdtemp(join(tmpdir(), 'cowart-widget-browser-'))
const projectDir = join(temporaryDir, 'project')
const canvasDir = join(projectDir, 'canvas')
const target = { projectDir, canvasDir }
const restoredStartup = process.argv.includes('--restored-startup')
// The HTML artifact receives its MCP Apps bridge when read as a resource.
// Exercise that exact release resource, including the packaged SDK/bridge.
const client = new Client({ name: 'cowart-browser-probe', version: '1.0.0' })
let widgetHtml
try {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ['./scripts/start-mcp.mjs'], cwd: root, env: { ...process.env, COWART_PLUGIN_ROOT: root } }))
  const resource = await client.readResource({ uri: 'ui://widget/cowart/canvas.html' })
  widgetHtml = resource.contents[0].text
} finally { await client.close() }
await cp(join(sourceProjectDir, 'canvas'), canvasDir, {
  recursive: true,
  // Live source locks are process coordination, not part of the fixture.
  filter: (source) => !source.split('/').some((part) => part === '.cowart-canvas-lock'),
})
const canvasState = await readCowartCanvasState(target, { hydrateAssets: false })
const payload = { ...target, view: 'canvas', preferredDisplayMode: 'fullscreen', canvasState }
// Reproduce a fullscreen host restoring paths/revision with an incomplete
// opener snapshot. The persisted fixture is still complete and authoritative.
if (restoredStartup) {
  const restoredPayload = { ...payload, canvasState: { ...canvasState, snapshot: null } }
  widgetHtml = widgetHtml.replace('<head>', `<head><script>window.openai={toolOutput:${JSON.stringify(restoredPayload).replaceAll('<', '\\u003c')}};</script>`)
}
const metrics = {
  startedAt: new Date().toISOString(),
  sourceCanvasReadOnly: true,
  restoredStartup,
  initialSnapshotBytes: Buffer.byteLength(JSON.stringify(canvasState.snapshot)),
  initialRecordCount: Object.keys(canvasState.snapshot?.store || {}).length,
  toolCounts: {},
  unchangedCanvasReplies: 0,
  maxCanvasReplyBytes: 0,
  maxAssetReplyBytes: 0,
  assetReads: {},
  toolErrors: [],
  browser: null,
}
const csp = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'self' 'unsafe-inline' data: blob:; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' data: blob:; frame-src 'self' data: blob:; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'"

async function toolResult(request) {
  const { name, arguments: input = {} } = request
  metrics.toolCounts[name] = (metrics.toolCounts[name] || 0) + 1
  // Always replace paths received from the iframe with the disposable target.
  const args = { ...input, ...target }
  let result
  switch (name) {
    case 'get_cowart_canvas_state': {
      const state = await readCowartCanvasState(target, { hydrateAssets: input.hydrateAssets === true })
      const unchanged = input.hydrateAssets !== true && input.ifRevision === state.revision
      result = unchanged ? { ...state, snapshot: null, unchanged: true } : state
      if (unchanged) metrics.unchangedCanvasReplies += 1
      metrics.maxCanvasReplyBytes = Math.max(metrics.maxCanvasReplyBytes, Buffer.byteLength(JSON.stringify(result)))
      break
    }
    case 'read_cowart_page_asset':
      result = await readCowartPageAsset(target, { assetUrl: input.assetUrl })
      metrics.assetReads[input.assetUrl] = (metrics.assetReads[input.assetUrl] || 0) + 1
      metrics.maxAssetReplyBytes = Math.max(metrics.maxAssetReplyBytes, Buffer.byteLength(JSON.stringify(result)))
      break
    case 'save_cowart_canvas_state':
      result = await saveCowartCanvasSnapshot(args, input.snapshot)
      break
    case 'save_cowart_selection_state':
      result = await writeCowartSelectionState(target, input.selection)
      break
    case 'save_cowart_view_state':
      result = await writeCowartViewState(target, input.viewState)
      break
    case 'track_cowart_analytics_event':
      // Pretend delivery succeeded to keep the frontend from contacting providers.
      // No analytics module or provider request is invoked by this harness.
      result = { delivered: true, providers: { ga4: { delivered: true }, posthog: { delivered: true } }, probeOnly: true }
      break
    default:
      throw new Error(`Browser probe does not implement tool ${name}`)
  }
  if (result.ok === false && metrics.toolErrors.length < 30) metrics.toolErrors.push(result.message || 'Probe tool failed')
  return {
    ...(result.ok === false ? { isError: true } : {}),
    content: [{ type: 'text', text: result.ok === false ? (result.message || 'Probe tool failed') : 'Browser probe tool completed.' }],
    structuredContent: result,
  }
}

async function readRequestJson(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 80_000_000) throw new Error('Browser probe request exceeded 80 MB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Cowart standalone Widget regression</title>
<style>html,body{margin:0;height:100%;font:14px system-ui;background:#f3f4f6;color:#111827}body{display:grid;grid-template-rows:auto 1fr}header{display:flex;align-items:center;gap:14px;padding:9px 14px;border-bottom:1px solid #d1d5db}button{padding:6px 10px;cursor:pointer}#status{flex:1}iframe{width:100%;height:100%;border:0;background:white}details{position:fixed;right:10px;bottom:8px;z-index:10;max-width:600px;max-height:50vh;overflow:auto;background:#fffffff0;border:1px solid #d1d5db;padding:8px;border-radius:5px}pre{font:11px ui-monospace;white-space:pre-wrap}</style>
<header><strong>Cowart real Widget regression</strong><button id="run">Run page switching regression</button><button id="save">Save test holder</button><span id="status">Connecting to the generated Widget…</span></header>
<iframe id="widget" title="Generated Cowart Widget" src="/widget"></iframe>
<details><summary>Regression metrics</summary><pre id="metrics"></pre></details>
<script>
const frame = document.getElementById('widget');
const status = document.getElementById('status');
const button = document.getElementById('run');
const report = {
  mounted: false, running: false, completed: false, passed: false,
  cycles: 0, visits: [], errors: [], samples: [], startup: [],
  noExternalNetwork: true, sourceCanvasReadOnly: true,
};
window.__cowartProbe = report;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (message) => frame.contentWindow.postMessage({jsonrpc:'2.0', ...message}, '*');
async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error('Probe request failed: ' + response.status);
  return response.json();
}
function recordError(message) { if (report.errors.length < 40) report.errors.push(String(message).slice(0, 800)); }
let initialized = false;
async function deliverInitialResult() {
  if (${restoredStartup}) return;
  if (initialized) return;
  initialized = true;
  const payload = await json('/initial');
  send({method:'ui/notifications/tool-input',params:{arguments:{projectDir:payload.projectDir,canvasDir:payload.canvasDir}}});
  send({method:'ui/notifications/tool-result',params:{content:[{type:'text',text:'Opened disposable Cowart regression canvas.'}],structuredContent:payload}});
}
window.addEventListener('message', async (event) => {
  if (event.source !== frame.contentWindow) return;
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'ui/notifications/initialized') { await deliverInitialResult(); return; }
  if (message.id === undefined || !message.method) return;
  try {
    let result;
    switch(message.method) {
      case 'ui/initialize':
        result = {
          protocolVersion: message.params.protocolVersion,
          hostInfo:{name:'cowart-browser-regression',version:'1.0.0'},
          hostCapabilities:{serverTools:{},logging:{},updateModelContext:{text:{}}},
          hostContext:{theme:'light',displayMode:'fullscreen',availableDisplayModes:['fullscreen'],platform:'desktop',locale:'zh-CN',timeZone:'Asia/Shanghai',containerDimensions:{width:frame.clientWidth,height:frame.clientHeight}},
        };
        break;
      case 'tools/call':
        result = await json('/tool', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(message.params)});
        break;
      case 'ui/request-display-mode': result = {mode:'fullscreen'}; break;
      case 'ui/update-model-context': result = {}; break;
      case 'ping': result = {}; break;
      default: throw new Error('Browser probe does not implement RPC ' + message.method);
    }
    send({id:message.id,result});
  } catch(error) {
    recordError(error.message);
    send({id:message.id,error:{code:-32603,message:error.message}});
  }
});
frame.addEventListener('load', () => {
  const child = frame.contentWindow;
  child.addEventListener('error', (event) => { if (event.message) recordError(event.message); });
  child.addEventListener('unhandledrejection', (event) => recordError(event.reason?.message || event.reason));
});
let mountedAt = null;
async function sample() {
  try {
    const child = frame.contentWindow;
    const editor = child.__cowartEditor;
    report.startup = child.__COWART_STARTUP__?.events || [];
    if (editor && !report.mounted) {
      report.mounted = true; mountedAt = Date.now();
      report.pages = editor.getPages().map((page) => ({id:page.id,name:page.name}));
      const expectedIds = ${JSON.stringify(Object.values(canvasState.snapshot?.store || {}).filter((record) => record.typeName === 'page' || (record.typeName === 'shape' && record.type === 'image')).map((record) => record.id))};
      report.startupPreserved = expectedIds.every((id) => Boolean(editor.store.get(id)));
      status.textContent = 'Widget mounted. Original canvas is read-only; all changes use a temporary copy.';
      if (new URLSearchParams(location.search).get('autostart') === '1') run();
    }
    if (editor) {
      const sample = {elapsedMs:Date.now()-mountedAt,currentPageId:editor.getCurrentPageId(),currentPageShapes:editor.getCurrentPageShapes().length,records:editor.store.allRecords().length,frames:child.document.querySelectorAll('iframe').length,heapBytes:child.performance.memory?.usedJSHeapSize || null};
      report.latest = sample;
      report.samples.push(sample);
      if (report.samples.length > 180) report.samples.shift();
    }
    const result = await json('/results', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)});
    document.getElementById('metrics').textContent = JSON.stringify(result,null,2);
  } catch(error) { recordError(error.message); }
}
setInterval(sample, 2000);
async function run() {
  if (!report.mounted || report.running) return;
  report.running = true; report.completed = false; report.passed = false; button.disabled = true;
  const editor = frame.contentWindow.__cowartEditor;
  const originalPage = editor.getCurrentPageId();
  const originalCamera = {...editor.getCamera()};
  try {
    const pages = editor.getPages();
    for (let cycle=0; cycle<3; cycle++) {
      for (const page of pages) {
        editor.setCurrentPage(page.id);
        editor.selectNone();
        editor.zoomToFit({animation:{duration:0}});
        const shape = editor.getCurrentPageShapes().find((shape) => shape.type === 'image');
        if (shape) editor.select(shape.id);
        status.textContent = 'Cycle ' + (cycle+1) + '/3 · page ' + page.name + ' · observing rendering and asset hydration';
        await pause(4500);
        if (!frame.contentWindow.__cowartEditor) throw new Error('Widget editor disappeared during page switching');
        report.visits.push({cycle:cycle+1,pageId:page.id,shapes:editor.getCurrentPageShapes().length,frames:frame.contentDocument.querySelectorAll('iframe').length});
      }
      report.cycles = cycle+1;
    }
    editor.selectNone(); editor.setCurrentPage(originalPage); editor.setCamera(originalCamera,{immediate:true,force:true});
    status.textContent = 'Page switching complete. Observing 32 seconds of idle polling…';
    await pause(32000);
    report.completed = true;
    const persisted = await json('/results');
    report.passed = report.errors.length === 0 && persisted.toolErrors.length === 0 &&
      report.startupPreserved === true && Boolean(frame.contentWindow.__cowartEditor);
    status.textContent = report.passed ? 'PASS: Widget remained mounted through 3 page cycles and idle polling.' : 'FAIL: See regression metrics.';
  } catch(error) { recordError(error.message); report.completed=true; status.textContent='FAIL: '+error.message; }
  finally { report.running=false; button.disabled=false; await sample(); }
}
button.addEventListener('click',run);
document.getElementById('save').addEventListener('click', async () => {
  const editor = frame.contentWindow.__cowartEditor;
  if (!editor) return;
  editor.createShapes([{id:'shape:cowart-browser-startup-save',type:'frame',x:0,y:0,props:{w:320,h:180,name:'Startup save probe'}}]);
  status.textContent = 'Saving a test holder into the disposable fixture…';
  await pause(1600);
  const saved = await json('/saved');
  report.startupSavePassed = saved.preserved && saved.holderSaved;
  status.textContent = report.startupSavePassed
    ? 'PASS: Restored startup retained saved pages/images, and the test holder saved successfully.'
    : 'FAIL: Startup lost saved content or the test holder could not save.';
  await sample();
});
</script></html>`

const server = createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-security-policy', csp)
  try {
    const url = new URL(request.url, 'http://127.0.0.1')
    let body
    if (request.method === 'GET' && url.pathname === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(html)
      return
    }
    if (request.method === 'GET' && url.pathname === '/widget') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(widgetHtml)
      return
    }
    if (request.method === 'GET' && url.pathname === '/initial') body = payload
    else if (request.method === 'GET' && url.pathname === '/saved') {
      const saved = await readCowartCanvasState(target, { hydrateAssets: false })
      const expectedIds = Object.values(canvasState.snapshot?.store || {}).filter((record) =>
        record.typeName === 'page' || (record.typeName === 'shape' && record.type === 'image')).map((record) => record.id)
      body = {
        preserved: expectedIds.every((id) => Boolean(saved.snapshot?.store[id])),
        holderSaved: Boolean(saved.snapshot?.store['shape:cowart-browser-startup-save']),
      }
    }
    else if (request.method === 'POST' && url.pathname === '/tool') {
      try { body = await toolResult(await readRequestJson(request)) }
      catch (error) {
        if (metrics.toolErrors.length < 30) metrics.toolErrors.push(error.message)
        body = { isError: true, content: [{ type: 'text', text: error.message }] }
      }
    } else if ((request.method === 'POST' || request.method === 'GET') && url.pathname === '/results') {
      if (request.method === 'POST') metrics.browser = await readRequestJson(request)
      body = metrics
    } else {
      response.writeHead(404).end()
      return
    }
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(body))
  } catch (error) {
    response.writeHead(500).end(error.message)
  }
})
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  server.closeAllConnections()
  await new Promise((resolveClose) => server.close(resolveClose))
  await rm(temporaryDir, { recursive: true, force: true })
}
process.once('SIGINT', () => { stop().then(() => process.exit(0)) })
process.once('SIGTERM', () => { stop().then(() => process.exit(0)) })
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`
  console.log(`Generated Cowart Widget browser regression: ${url}`)
  console.log(`Automatic regression: ${url}?autostart=1`)
  console.log('Original canvas is read-only. All storage calls target a disposable copy; external network is blocked.')
})
