import { useEffect, useRef, useState } from 'react'
import { DefaultVideoToolbar, DefaultVideoToolbarContent, TldrawUiToolbarButton, createShapesForAssets, useEditor, useToasts, useValue } from 'tldraw'
import { captureVideoFrame, insertExtractedVideoFrame, seekVideoFrame } from './videoFrameExtraction.js'

export function CowartVideoToolbar({ videoShapeId, renderAltTextEditor }) {
  const editor = useEditor()
  const [editingAlt, setEditingAlt] = useState(false)
  useEffect(() => setEditingAlt(false), [videoShapeId])
  return <DefaultVideoToolbar>
    {editingAlt ? renderAltTextEditor?.({ shapeId: videoShapeId, onClose: () => setEditingAlt(false) }) : <>
      <DefaultVideoToolbarContent videoShapeId={videoShapeId} onEditAltTextStart={() => setEditingAlt(true)} />
      {!editor.getIsReadonly() && <TldrawUiToolbarButton type="icon" title="提取画面" data-testid="cowart-extract-video-frame" onClick={() => {
        editor.getContainer().ownerDocument.defaultView.dispatchEvent(new CustomEvent('cowart:extract-video-frame', { detail: { shapeId: videoShapeId } }))
      }}><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m5 17 5-5 4 4 3-3 4 4"/><circle cx="16" cy="9" r="1.5"/></svg></TldrawUiToolbarButton>}
    </>}
  </DefaultVideoToolbar>
}

export function CowartVideoFrameExtractionOverlay() {
  const editor = useEditor()
  const { addToast } = useToasts()
  const [request, setRequest] = useState(null)
  useEffect(() => {
    const win = editor.getContainer().ownerDocument.defaultView
    const open = (event) => {
      const shape = editor.getShape(event.detail?.shapeId)
      if (shape?.type !== 'video' || editor.getIsReadonly()) return
      setRequest({ shapeId: shape.id, assetId: shape.props.assetId, pageId: editor.getCurrentPageId(), returnFocus: editor.getContainer().ownerDocument.activeElement })
    }
    win.addEventListener('cowart:extract-video-frame', open)
    return () => win.removeEventListener('cowart:extract-video-frame', open)
  }, [editor])
  return request && <FrameDialog key={request.shapeId} editor={editor} request={request} addToast={addToast} onClose={() => setRequest(null)} />
}

function FrameDialog({ editor, request, addToast, onClose }) {
  const dialogRef = useRef(null)
  const videoRef = useRef(null)
  const controllerRef = useRef(null)
  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const requestedSecondsRef = useRef(0)
  const [src, setSrc] = useState(null)
  const [duration, setDuration] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [seeking, setSeeking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sourceValid = useValue('cowart extraction source', () => {
    const shape = editor.getShape(request.shapeId)
    return editor.getCurrentPageId() === request.pageId && shape?.type === 'video' && shape.props.assetId === request.assetId && !editor.getIsReadonly()
  }, [editor, request])

  useEffect(() => {
    mountedRef.current = true
    const dialog = dialogRef.current
    dialog.showModal()
    const containNativeEvent = event => event.stopPropagation()
    dialog.addEventListener('keydown', containNativeEvent)
    dialog.addEventListener('keyup', containNativeEvent)
    dialog.addEventListener('wheel', containNativeEvent, { passive: true })
    let live = true
    let initialized = false
    const timeout = setTimeout(() => { if (live) { setError('视频加载超时，请关闭后重试。'); setSeeking(false); controllerRef.current?.abort() } }, 8000)
    const asset = editor.getAsset(request.assetId)
    Promise.resolve(asset ? editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true }) : null).then(url => {
      if (!live) return
      if (!url) throw new Error('视频文件不可用。')
      setSrc(url)
    }).catch(err => { if (live) { clearTimeout(timeout); setError(err.message || '无法加载视频。'); setSeeking(false) } })
    const video = videoRef.current
    const ready = async () => {
      if (!live || initialized) return
      initialized = true
      if (!Number.isFinite(video.duration) || video.duration <= 0) { setError('无法读取视频时长。'); setSeeking(false); clearTimeout(timeout); return }
      setDuration(video.duration)
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      try { await seekVideoFrame(video, 0, { signal: controller.signal }); if (live && !controller.signal.aborted) { clearTimeout(timeout); setSeeking(false) } }
      catch (err) { if (live && !controller.signal.aborted) { clearTimeout(timeout); setError(err.message || '无法读取视频画面。'); setSeeking(false) } }
    }
    const failed = () => { if (live) { clearTimeout(timeout); setError('视频无法解码，请换一个视频。'); setSeeking(false) } }
    video.addEventListener('loadeddata', ready)
    video.addEventListener('error', failed)
    return () => {
      live = false; mountedRef.current = false; clearTimeout(timeout); controllerRef.current?.abort()
      video.removeEventListener('loadeddata', ready); video.removeEventListener('error', failed)
      video.pause(); video.removeAttribute('src'); video.load()
      dialog.removeEventListener('keydown', containNativeEvent)
      dialog.removeEventListener('keyup', containNativeEvent)
      dialog.removeEventListener('wheel', containNativeEvent)
      dialog.close()
      if (request.returnFocus?.isConnected) request.returnFocus.focus()
    }
  }, [editor, request])

  useEffect(() => { if (!sourceValid && !busyRef.current) onClose() }, [sourceValid, onClose])

  const choose = async (value) => {
    const target = Math.max(0, Math.min(duration, value))
    requestedSecondsRef.current = target
    setSeconds(target); setSeeking(true); setError('')
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    try { await seekVideoFrame(videoRef.current, target, { signal: controller.signal }); if (mountedRef.current && !controller.signal.aborted) { setSeeking(false) } }
    catch (err) { if (mountedRef.current && !controller.signal.aborted) { setError(err.message || '无法读取所选画面。'); setSeeking(false) } }
  }
  const confirm = async () => {
    if (busyRef.current || seeking || error || !sourceValid || !duration) return
    busyRef.current = true; setBusy(true)
    try {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      const frameSeconds = await seekVideoFrame(videoRef.current, requestedSecondsRef.current, { signal: controller.signal })
      if (!mountedRef.current) return
      const asset = editor.getAsset(request.assetId)
      const name = `${(asset?.props.name || '视频').replace(/\.[^.]+$/, '')}-${frameSeconds.toFixed(2)}.png`
      const file = await captureVideoFrame(videoRef.current, { name })
      if (!mountedRef.current) return
      const source = editor.getShape(request.shapeId)
      if (editor.getCurrentPageId() !== request.pageId || source?.type !== 'video' || source.props.assetId !== request.assetId || editor.getIsReadonly()) throw new Error('视频或页面已变更，请重新选择视频提取。')
      await insertExtractedVideoFrame(editor, request.shapeId, file, createShapesForAssets, frameSeconds)
      if (!mountedRef.current) return
      addToast({ title: '画面已提取', description: '已在视频旁创建图片卡。', severity: 'success' })
      onClose()
    } catch (err) { if (mountedRef.current) { setError(err.message || '提取失败，请重试。'); busyRef.current = false; setBusy(false) } }
  }
  return <dialog ref={dialogRef} className="cowart-video-frame-dialog" aria-labelledby="cowart-video-frame-title" onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose() }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <h2 id="cowart-video-frame-title">提取视频画面</h2>
    <video ref={videoRef} src={src || undefined} crossOrigin="anonymous" muted playsInline preload="auto" className="cowart-video-frame-preview" />
    <label className="cowart-video-frame-timeline">选择画面位置<input type="range" aria-label="画面位置" min="0" max={duration || 0} step="0.01" value={seconds} disabled={!duration || busy || !sourceValid} onChange={event => choose(Number(event.target.value))} /></label>
    <div className="cowart-video-frame-time"><span>{formatTime(seconds)}</span><span>{formatTime(duration)}</span></div>
    <p className="cowart-video-frame-status" role={error ? 'alert' : 'status'}>{error || (busy ? '正在创建图片卡…' : seeking ? '正在读取画面…' : '将以视频原始分辨率创建图片卡。')}</p>
    <div className="cowart-video-frame-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="cowart-video-frame-confirm" disabled={busy || seeking || !!error || !duration || !sourceValid} onClick={confirm}>确认提取</button></div>
  </dialog>
}

function formatTime(seconds) {
  const hundredths = Math.round(Math.max(0, seconds || 0) * 100)
  const whole = Math.floor(hundredths / 100)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`
}
