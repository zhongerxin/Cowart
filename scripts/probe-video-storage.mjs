import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTLStore } from 'tldraw'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { sanitizeCanvasSnapshotForTldraw } from '../src/canvasSnapshot.js'
import { readCowartCanvasState, readCowartPageAsset, saveCowartCanvasSnapshot, writeCowartPageAsset } from '../mcp/lib/canvas-storage.mjs'

// Exercise the development request parser with the maximum single-video JSON.
const developmentSource = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8')
const parserStart = developmentSource.indexOf('function readRequestBody(')
const parserEnd = developmentSource.indexOf('function isCanvasSnapshot(', parserStart)
const limitMatch = developmentSource.match(/const maxCanvasRequestBytes = (\d+) \* 1024 \* 1024/)
assert.ok(parserStart >= 0 && parserEnd > parserStart && limitMatch)
const maxCanvasRequestBytes = Number(limitMatch[1]) * 1024 * 1024
const readRequestBody = vm.runInNewContext(`(${developmentSource.slice(parserStart, parserEnd).trim()})`, { maxCanvasRequestBytes, Buffer })
function request() {
  const req = new EventEmitter()
  req.setEncoding = () => {}
  req.destroy = () => { req.destroyed = true }
  return req
}
const maxVideoJson = JSON.stringify({ snapshot: { asset: { src: `data:video/mp4;base64,${Buffer.alloc(50 * 1024 * 1024).toString('base64')}` } } })
assert.ok(Buffer.byteLength(maxVideoJson) > 50 * 1024 * 1024)
const supportedRequest = request()
const supportedBody = readRequestBody(supportedRequest)
supportedRequest.emit('data', maxVideoJson)
supportedRequest.emit('end')
assert.equal(await supportedBody, maxVideoJson)
assert.equal(supportedRequest.destroyed, undefined)
const oversizedRequest = request()
const oversizedBody = readRequestBody(oversizedRequest)
const rejectsOversized = assert.rejects(oversizedBody, /too large/)
const chunk = 'a'.repeat(1024 * 1024)
for (let index = 0; index <= maxCanvasRequestBytes / chunk.length; index++) oversizedRequest.emit('data', chunk)
await rejectsOversized
assert.equal(oversizedRequest.destroyed, true)

const fixtureRoot = new URL('../../video-storage-fixtures/', import.meta.url)
await mkdir(fixtureRoot, { recursive: true })
const projectDir = await mkdtemp(join(fixtureRoot.pathname, 'run-'))
const args = { projectDir }
try {
  const store = createTLStore()
  store.ensureStoreIsUsable()
  const snapshot = store.getStoreSnapshot()
  const pageId = Object.values(snapshot.store).find((record) => record.typeName === 'page').id
  const cases = [['mp4', 'video/mp4'], ['webm', 'video/webm'], ['mov', 'video/quicktime']]
  const expected = new Map()
  for (const [index, [extension, mimeType]] of cases.entries()) {
    const assetId = `asset:video-${extension}`
    const bytes = Buffer.from([0, 255, 128, index, 20, 10, 13, 0])
    expected.set(assetId, { bytes, extension, mimeType })
    snapshot.store[assetId] = {
      id: assetId, typeName: 'asset', type: 'video', meta: {},
      props: { name: `example.${extension}`, src: `data:${mimeType};base64,${bytes.toString('base64')}`, w: 320, h: 180, fileSize: bytes.length, mimeType, isAnimated: true },
    }
    const id = `shape:video-${extension}`
    snapshot.store[id] = {
      id, typeName: 'shape', type: 'video', parentId: pageId, index: `a${index + 1}`, x: index * 350, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {},
      props: { w: 320, h: 180, assetId, autoplay: false, url: '', altText: '', time: 0, playing: false },
    }
  }
  const saved = await saveCowartCanvasSnapshot(args, snapshot)
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.skippedRecords, [])
  const reopened = await readCowartCanvasState(args)
  for (const [assetId, { bytes, extension, mimeType }] of expected) {
    const asset = reopened.snapshot.store[assetId]
    assert.ok(asset.props.src.endsWith(`.${extension}`), 'Video must retain a playable extension after localization')
    const read = await readCowartPageAsset(args, { assetUrl: asset.props.src })
    assert.equal(read.mimeType, mimeType)
    assert.deepEqual(Buffer.from(read.dataBase64, 'base64'), bytes)
    assert.deepEqual(await readFile(read.assetPath), bytes)
  }
  const hydrated = await readCowartCanvasState(args, { hydrateAssets: true })
  assert.equal(hydrated.hydratedAssets.length, 3)
  for (const [assetId, { bytes, mimeType }] of expected) {
    assert.equal(hydrated.snapshot.store[assetId].props.src, `data:${mimeType};base64,${bytes.toString('base64')}`)
  }
  const secondSave = await saveCowartCanvasSnapshot({ ...args, expectedRevision: reopened.revision }, hydrated.snapshot)
  assert.equal(secondSave.ok, true)
  const secondReopen = await readCowartCanvasState(args)
  for (const [assetId, { bytes }] of expected) {
    const read = await readCowartPageAsset(args, { assetUrl: secondReopen.snapshot.store[assetId].props.src })
    assert.deepEqual(Buffer.from(read.dataBase64, 'base64'), bytes)
  }
  const missingAssetSnapshot = structuredClone(snapshot)
  delete missingAssetSnapshot.store['asset:video-mp4']
  const pruned = sanitizeCanvasSnapshotForTldraw(missingAssetSnapshot)
  assert.equal(pruned.snapshot.store['shape:video-mp4'], undefined)
  assert.ok(pruned.skippedRecords.some((record) => record.id === 'shape:video-mp4' && /Missing dependent record/.test(record.reason)))

  const validUrl = reopened.snapshot.store['asset:video-mp4'].props.src
  const assetDir = join(projectDir, 'canvas', 'pages', encodeURIComponent(pageId.replace(/^page:/, '')), 'assets')
  await writeFile(join(assetDir, 'unsupported.avi'), Buffer.from('not supported'))
  await assert.rejects(readCowartPageAsset(args, { assetUrl: validUrl.replace(/[^/]+$/, 'unsupported.avi') }), /only expose/)
  await assert.rejects(readCowartPageAsset(args, { assetUrl: '/page-assets/../outside.mp4' }), /Unsafe/)
  await assert.rejects(readCowartPageAsset(args, { assetUrl: 'https://example.com/video.mp4' }), /Unsupported/)
  const outside = join(projectDir, 'outside.mp4')
  await writeFile(outside, Buffer.from('outside'))
  await symlink(outside, join(assetDir, 'linked.mp4'))
  await assert.rejects(readCowartPageAsset(args, { assetUrl: validUrl.replace(/[^/]+$/, 'linked.mp4') }), /Unsafe/)
  await assert.rejects(writeCowartPageAsset(args, { pageId, mimeType: 'video/mp4', dataBase64: Buffer.from('video').toString('base64') }), /only accept image/)
  console.log('PASS: maximum 50 MiB video JSON accepted and 256 MiB aggregate request cap enforced; MP4/WebM/MOV save/read/reopen/hydration byte equality; missing video dependency pruning; unsafe path, symlink, unsupported type rejection; reference API stays image-only.')
} finally {
  await rm(projectDir, { recursive: true, force: true })
}
// The editor package starts browser-oriented timers on import; all fixture I/O
// has completed and been cleaned up before ending this standalone Node probe.
process.exit(0)
