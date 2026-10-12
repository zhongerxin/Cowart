import assert from 'node:assert/strict'
import { seekVideoFrame, captureVideoFrame, insertExtractedVideoFrame } from '../src/videoFrameExtraction.js'

class Video extends EventTarget {
  duration = 5
  readyState = 2
  seeking = false
  videoWidth = 1920
  videoHeight = 1080
  time = 0
  callbacks = new Map()
  listeners = new Set()
  get currentTime() { return this.time }
  set currentTime(value) { this.time = value; this.seeking = true }
  requestVideoFrameCallback(fn) { const id = this.callbacks.size + 1; this.callbacks.set(id, fn); return id }
  cancelVideoFrameCallback(id) { this.callbacks.delete(id) }
  addEventListener(type, fn, options) { this.listeners.add(fn); super.addEventListener(type, fn, options) }
  removeEventListener(type, fn) { this.listeners.delete(fn); super.removeEventListener(type, fn) }
  decode() { this.seeking = false; this.dispatchEvent(new Event('seeked')) }
}
const video = new Video()
const seek = seekVideoFrame(video, 5)
assert.equal(video.currentTime, 4.999)
video.decode()
assert.equal(await seek, 4.999)
assert.equal(video.listeners.size, 0)
assert.equal(video.callbacks.size, 0)
const stale = seekVideoFrame(video, 1)
const staleCheck = assert.rejects(stale, { name: 'AbortError' })
const latest = seekVideoFrame(video, 2)
video.decode()
await staleCheck
assert.equal(await latest, 2)
assert.equal(video.listeners.size, 0)
assert.equal(video.callbacks.size, 0)
const controller = new AbortController()
const cancelled = seekVideoFrame(video, 3, { signal: controller.signal })
controller.abort()
await assert.rejects(cancelled, { name: 'AbortError' })
assert.equal(video.listeners.size, 0)
assert.equal(video.callbacks.size, 0)
video.duration = Infinity
await assert.rejects(seekVideoFrame(video, 1), /尚未读取/)
video.duration = 5
const failed = seekVideoFrame(video, 4)
video.dispatchEvent(new Event('error'))
await assert.rejects(failed, /读取失败/)
assert.equal(video.listeners.size, 0)
video.seeking = false
let drawn
const canvas = { getContext: () => ({ drawImage: (...args) => { drawn = args } }), toBlob: (cb, type) => { assert.equal(type, 'image/png'); cb(new Blob(['png'], { type })) } }
video.ownerDocument = { createElement: (tag) => { assert.equal(tag, 'canvas'); return canvas } }
const file = await captureVideoFrame(video)
assert.equal(file.type, 'image/png')
assert.equal(file.name, 'video-frame.png')
assert.equal(canvas.width, 1920)
assert.equal(canvas.height, 1080)
assert.equal(drawn[0], video)
canvas.toBlob = (cb) => cb(null)
await assert.rejects(captureVideoFrame(video), /提取失败/)
canvas.toBlob = () => { throw new DOMException('tainted', 'SecurityError') }
await assert.rejects(captureVideoFrame(video), { name: 'SecurityError' })
video.videoWidth = 0
await assert.rejects(captureVideoFrame(video), /尚未准备好/)

const source = { id: 'shape:video', type: 'video', props: { assetId: 'asset:video' } }
const imageAsset = { id: 'asset:image', type: 'image', props: { src: 'data:image/png;base64,a', w: 1920, h: 1080 } }
function setup() {
  const shapes = new Map([[source.id, structuredClone(source)]])
  const assets = new Map()
  let page = 'page:1'
  const calls = []
  const placementEvents = []
  const editor = {
    getShape: (id) => shapes.get(id),
    getCurrentPageId: () => page,
    getAncestorPageId: () => page,
    getCurrentPageShapes: () => [...shapes.values()],
    getShapePageBounds: (shape) => shape.type === 'video' ? ({ maxX: 420, y: 50, h: 180 }) : ({ maxX: shape.x + shape.props.w, y: shape.y, h: shape.props.h }),
    getAssetForExternalContent: async () => imageAsset,
    getAsset: (id) => assets.get(id),
    markHistoryStoppingPoint: () => {},
    reparentShapes: (ids, parentId) => {
      placementEvents.push('reparent')
      ids.forEach((id) => shapes.set(id, { ...shapes.get(id), parentId }))
    },
    updateShapes: (updates) => {
      placementEvents.push('position')
      updates.forEach((update) => {
        assert.equal(shapes.get(update.id).parentId, page, 'page coordinates require page parent')
        shapes.set(update.id, { ...shapes.get(update.id), ...update, props: { ...shapes.get(update.id).props, ...update.props } })
      })
    },
  }
  const create = async (actualEditor, values, point) => {
    assert.equal(actualEditor, editor)
    calls.push(point)
    assets.set(imageAsset.id, values[0])
    const id = calls.length === 1 ? 'shape:image' : `shape:image:${calls.length}`
    shapes.set(id, { id, type: 'image', parentId: 'shape:rotated-frame', rotation: Math.PI / 4, props: { assetId: values[0].id }, meta: {} })
    return [id]
  }
  return { editor, create, shapes, calls, placementEvents, setPage: (value) => { page = value } }
}
const normal = setup()
assert.deepEqual(await insertExtractedVideoFrame(normal.editor, source.id, file, normal.create, 2), ['shape:image'])
assert.deepEqual(normal.shapes.get(source.id), source)
assert.equal(normal.shapes.get('shape:image').x, 452)
assert.equal(normal.shapes.get('shape:image').y, 50)
assert.equal(normal.shapes.get('shape:image').parentId, 'page:1')
assert.equal(normal.shapes.get('shape:image').rotation, 0)
assert.deepEqual(normal.placementEvents, ['reparent', 'position'])
assert.equal(normal.shapes.get('shape:image').props.h, 180)
assert.equal(normal.shapes.get('shape:image').meta.videoFrameSeconds, 2)
assert.equal(normal.shapes.get('shape:image').meta.sourceVideoShapeId, source.id)
const firstFrame = structuredClone(normal.shapes.get('shape:image'))
assert.deepEqual(await insertExtractedVideoFrame(normal.editor, source.id, file, normal.create, 3), ['shape:image:2'])
assert.deepEqual(normal.shapes.get('shape:image'), firstFrame, 'repeated extraction preserves first image')
assert.equal(normal.shapes.get('shape:image:2').x, firstFrame.x + firstFrame.props.w + 32)
assert.equal(normal.shapes.get('shape:image:2').meta.videoFrameSeconds, 3)
assert.deepEqual(normal.shapes.get(source.id), source)
for (const change of ['delete', 'page', 'asset']) {
  const state = setup()
  let release
  state.editor.getAssetForExternalContent = () => new Promise((resolve) => { release = resolve })
  const pending = insertExtractedVideoFrame(state.editor, source.id, file, state.create, 1)
  assert.equal(state.calls.length, 0, 'waits for the asset before creating')
  if (change === 'delete') state.shapes.delete(source.id)
  if (change === 'page') state.setPage('page:2')
  if (change === 'asset') state.shapes.get(source.id).props.assetId = 'asset:other'
  release(imageAsset)
  await assert.rejects(pending, /已变更/)
  assert.equal(state.calls.length, 0)
}
const readonly = setup()
let uploadReadonlyAsset
let isReadonly = false
readonly.editor.getIsReadonly = () => isReadonly
readonly.editor.getAssetForExternalContent = () => new Promise((resolve) => { uploadReadonlyAsset = resolve })
const readonlyPending = insertExtractedVideoFrame(readonly.editor, source.id, file, readonly.create, 1)
isReadonly = true
uploadReadonlyAsset(imageAsset)
await assert.rejects(readonlyPending, /只能查看/)
assert.equal(readonly.calls.length, 0, 'readonly changes during upload prevent insertion')
assert.equal(readonly.shapes.size, 1)

const rejected = setup()
rejected.editor.getAssetForExternalContent = async () => { throw new Error('upload failed') }
await assert.rejects(insertExtractedVideoFrame(rejected.editor, source.id, file, rejected.create, 1), /upload failed/)
assert.equal(rejected.calls.length, 0)
const empty = setup()
empty.editor.getAssetForExternalContent = async () => ({ ...imageAsset, props: { ...imageAsset.props, src: null } })
await assert.rejects(insertExtractedVideoFrame(empty.editor, source.id, file, empty.create, 1), /保存失败/)
assert.equal(empty.calls.length, 0)
console.log('视频帧读取、取消、完整尺寸、存储失败、来源校验与图片位置验证通过。')
