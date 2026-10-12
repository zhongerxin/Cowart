const pendingSeeks = new WeakMap()
const abortError = () => new DOMException('已取消视频帧读取。', 'AbortError')

/**
 * Wait for a decoded frame; a newer seek cancels the previous pending seek.
 * @param {HTMLVideoElement} video
 * @param {number} seconds
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<number>} The decoded position, clamped before the end.
 */
export function seekVideoFrame(video, seconds, { signal } = {}) {
  pendingSeeks.get(video)?.()
  if (!Number.isFinite(video.duration) || video.duration <= 0 || !Number.isFinite(seconds)) {
    return Promise.reject(new Error('视频尚未读取完成，请稍后重试。'))
  }
  const target = Math.max(0, Math.min(seconds, Math.max(0, video.duration - Math.min(0.001, video.duration / 2))))
  return new Promise((resolve, reject) => {
    let callbackId
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadeddata', onSeeked)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
      if (callbackId !== undefined) video.cancelVideoFrameCallback?.(callbackId)
      if (pendingSeeks.get(video) === onAbort) pendingSeeks.delete(video)
      if (error) reject(error)
      else resolve(target)
    }
    const onAbort = () => finish(abortError())
    const onError = () => finish(new Error('视频画面读取失败，请重试。'))
    const onSeeked = () => {
      if (video.seeking || video.readyState < 2 || Math.abs(video.currentTime - target) > 0.01) return
      finish()
    }
    const timer = setTimeout(() => finish(new Error('视频画面读取超时，请重试。')), 10000)
    pendingSeeks.set(video, onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) return onAbort()
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('loadeddata', onSeeked)
    video.addEventListener('error', onError)
    try {
      // HAVE_CURRENT_DATA after seeked means the requested frame is decoded.
      if (Math.abs(video.currentTime - target) < 0.00001 && !video.seeking && video.readyState >= 2) return finish()
      if (video.requestVideoFrameCallback) callbackId = video.requestVideoFrameCallback(onSeeked)
      video.currentTime = target
    } catch (error) {
      finish(error)
    }
  })
}

/**
 * @param {HTMLVideoElement} video
 * @param {{ name?: string }} [options]
 * @returns {Promise<File>}
 */
export async function captureVideoFrame(video, { name = 'video-frame.png' } = {}) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2 || video.seeking) {
    throw new Error('视频画面尚未准备好，请稍后重试。')
  }
  const canvas = video.ownerDocument.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法提取画面，请重新打开画布后重试。')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('画面提取失败，请重试。')), 'image/png')
    } catch (error) {
      reject(error)
    }
  })
  return new File([blob], name, { type: 'image/png' })
}

/**
 * @param {import('tldraw').Editor} editor
 * @param {import('tldraw').TLShapeId} videoShapeId
 * @param {File} file
 * @param {typeof import('tldraw').createShapesForAssets} createShapesForAssets
 * @param {number} seconds
 * @returns {Promise<import('tldraw').TLShapeId[]>}
 */
export async function insertExtractedVideoFrame(editor, videoShapeId, file, createShapesForAssets, seconds) {
  const source = editor.getShape(videoShapeId)
  const pageId = editor.getCurrentPageId()
  if (source?.type !== 'video') throw new Error('原视频已移除，无法创建图片。')
  const sourceAssetId = source.props.assetId
  const asset = await editor.getAssetForExternalContent({ type: 'file', file })
  if (asset?.type !== 'image' || !asset.props?.src || !(asset.props.w > 0) || !(asset.props.h > 0)) {
    throw new Error('图片保存失败，请重试。')
  }
  if (editor.getIsReadonly?.()) throw new Error('当前画布只能查看，无法创建图片。')
  const currentSource = editor.getShape(videoShapeId)
  if (editor.getCurrentPageId() !== pageId || currentSource?.type !== 'video' || currentSource.props.assetId !== sourceAssetId || (editor.getAncestorPageId && editor.getAncestorPageId(currentSource) !== pageId)) {
    throw new Error('视频或页面已变更，请重新选择视频提取。')
  }
  const bounds = editor.getShapePageBounds(currentSource)
  if (!bounds) throw new Error('无法定位原视频，请重新选择。')
  let rightEdge = bounds.maxX
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== 'image' || shape.meta?.sourceVideoShapeId !== videoShapeId) continue
    const imageBounds = editor.getShapePageBounds(shape)
    if (imageBounds) rightEdge = Math.max(rightEdge, imageBounds.maxX)
  }
  const scale = Math.min(1, bounds.h / asset.props.h)
  const w = asset.props.w * scale
  const h = asset.props.h * scale
  editor.markHistoryStoppingPoint('extract video frame')
  const ids = await createShapesForAssets(editor, [asset], { x: rightEdge + 32 + asset.props.w / 2, y: bounds.y + asset.props.h / 2 })
  const shapes = ids.map((id) => editor.getShape(id))
  if (!shapes.length || shapes.some((shape) => shape?.type !== 'image' || shape.props.assetId !== asset.id) || !editor.getAsset(asset.id)?.props?.src) {
    throw new Error('图片创建失败，请重试。')
  }
  // Native insertion may choose a focused group or frame as the parent.
  editor.reparentShapes(ids, pageId)
  editor.updateShapes(shapes.map((shape) => ({
    id: shape.id, type: 'image', x: rightEdge + 32, y: bounds.y, rotation: 0,
    props: { w, h },
    meta: { ...shape.meta, sourceVideoShapeId: videoShapeId, videoFrameSeconds: seconds },
  })))
  return ids
}
