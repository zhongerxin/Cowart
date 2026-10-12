import assert from 'node:assert/strict'
import { normalizeVideoFile, validateMediaFileSize, probeVideoFile, MAX_VIDEO_BYTES, MAX_IMAGE_BYTES } from '../src/videoImport.js'
assert.equal(normalizeVideoFile(new File(['v'], 'test.MP4')).type, 'video/mp4')
assert.throws(() => normalizeVideoFile(new File([], 'empty.mp4')), /为空/)
assert.throws(() => normalizeVideoFile(new File(['v'], 'bad.avi', { type: 'video/avi' })), /请选择/)
assert.throws(() => normalizeVideoFile({ name: 'big.mp4', type: 'video/mp4', size: MAX_VIDEO_BYTES + 1 }), /50 MB/)
assert.throws(() => validateMediaFileSize({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }), /10 MB/)
for (const outcome of ['loaded', 'error', 'timeout']) {
  let revoked = 0
  let paused = 0
  const video = { videoWidth: 640, videoHeight: 360, duration: 2, pause() { paused++ }, removeAttribute() {}, load() {
    if (this.onloadeddata && outcome === 'loaded') queueMicrotask(() => this.onloadeddata?.())
    if (this.onerror && outcome === 'error') queueMicrotask(() => this.onerror?.())
  } }
  const result = probeVideoFile(new File(['v'], 'a.mp4'), {
    document: { createElement: () => video }, urlApi: { createObjectURL: () => 'blob:test', revokeObjectURL() { revoked++ } }, timeoutMs: 5
  })
  if (outcome === 'loaded') await result
  else await assert.rejects(result, outcome === 'error' ? /无法播放/ : /超时/)
  assert.equal(revoked, 1)
  assert.equal(paused, 1)
  assert.equal(video.onloadeddata, null)
}
console.log('Video import validation and cleanup passed')
const { insertMediaAssets } = await import('../src/videoImport.js')
let resolveUpload
let created = 0
const stored = new Map()
const asset = { id: 'asset:video', type: 'video', props: { src: 'data:video/mp4;base64,eA==' } }
const editor = {
  getAssetForExternalContent: () => new Promise((resolve) => { resolveUpload = resolve }),
  markHistoryStoppingPoint() {}, getViewportPageBounds: () => ({ center: { x: 0, y: 0 } }),
  getShape: (id) => stored.get(id), updateShapes(updates) { assert.equal(updates[0].props.autoplay, false) }
}
const create = async (_editor, assets) => {
  created++
  assert.equal(assets[0], asset)
  stored.set('shape:video', { id: 'shape:video', type: 'video', props: { assetId: asset.id } })
  return ['shape:video']
}
const pendingImport = insertMediaAssets(editor, [new File(['v'], 'a.mp4')], create)
await Promise.resolve()
assert.equal(created, 0, 'no shape before uploaded asset resolves')
resolveUpload(asset)
assert.deepEqual(await pendingImport, ['shape:video'])
assert.equal(created, 1)
editor.getAssetForExternalContent = async () => { throw new Error('upload failed') }
await assert.rejects(insertMediaAssets(editor, [{}], create), /upload failed/)
assert.equal(created, 1, 'upload rejection must not create shape')
editor.getAssetForExternalContent = async () => ({ ...asset, props: { src: '' } })
await assert.rejects(insertMediaAssets(editor, [{}], create), /读取失败/)
assert.equal(created, 1, 'incomplete asset must not create shape')
editor.getAssetForExternalContent = async () => asset
await assert.rejects(insertMediaAssets(editor, [{}], async () => ['shape:missing']), /导入失败/)
console.log('Awaited asset insertion regressions passed')
const imageFile = new File(['image'], 'image.png', { type: 'image/png' })
const videoFile = new File(['video'], 'video.mp4', { type: 'video/mp4' })
const mixedAssets = [{ id: 'asset:image', type: 'image', props: { src: 'data:image/png;base64,eA==' } }, asset]
const mixedShapes = new Map()
const updates = []
let completeVideo
let batchCreated = false
const mixedEditor = {
  getAssetForExternalContent: async ({ file }) => file.type.startsWith('image/') ? mixedAssets[0] : await new Promise(resolve => { completeVideo = resolve }),
  markHistoryStoppingPoint() {}, getViewportPageBounds: () => ({ center: { x: 10, y: 20 } }),
  getShape: id => mixedShapes.get(id), updateShapes: value => updates.push(...value),
}
const mixed = insertMediaAssets(mixedEditor, [imageFile, videoFile], async (_editor, assets, point) => {
  batchCreated = true
  assert.deepEqual(assets, mixedAssets)
  assert.deepEqual(point, { x: 10, y: 20 })
  assets.forEach((a, i) => mixedShapes.set(`shape:mixed-${i}`, { id: `shape:mixed-${i}`, type: a.type, props: { assetId: a.id } }))
  return ['shape:mixed-0', 'shape:mixed-1']
})
await new Promise(resolve => setImmediate(resolve))
assert.equal(batchCreated, false, 'mixed selection waits for both asset uploads')
completeVideo(asset)
assert.deepEqual(await mixed, ['shape:mixed-0', 'shape:mixed-1'])
assert.deepEqual(updates.map(s => s.type), ['video'], 'image records are not given video playback properties')
assert.equal(updates[0].props.autoplay, false)
console.log('Mixed image/video native insertion passed')
