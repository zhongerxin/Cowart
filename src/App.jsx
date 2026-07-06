import {
  ArrowDownToolbarItem,
  ArrowLeftToolbarItem,
  ArrowRightToolbarItem,
  ArrowToolbarItem,
  ArrowUpToolbarItem,
  AssetToolbarItem,
  Box,
  CheckBoxToolbarItem,
  CloudToolbarItem,
  DefaultImageToolbar,
  DefaultImageToolbarContent,
  DefaultToolbar,
  DefaultColorStyle,
  DefaultStylePanel,
  DefaultStylePanelContent,
  DiamondToolbarItem,
  DrawToolbarItem,
  EllipseToolbarItem,
  EraserToolbarItem,
  FrameToolbarItem,
  FrameShapeUtil,
  HandToolbarItem,
  HeartToolbarItem,
  HexagonToolbarItem,
  HighlightToolbarItem,
  LaserToolbarItem,
  LineToolbarItem,
  NoteToolbarItem,
  OvalToolbarItem,
  RectangleToolbarItem,
  RhombusToolbarItem,
  SelectToolbarItem,
  StateNode,
  StarToolbarItem,
  TextToolbarItem,
  Tldraw,
  TldrawUiButton,
  TldrawUiButtonIcon,
  TldrawUiInput,
  TldrawUiMenuToolItem,
  TldrawUiToolbarButton,
  TriangleToolbarItem,
  XBoxToolbarItem,
  createShapeId,
  onDragFromToolbarToCreateShape,
  startEditingShapeWithRichText,
  toRichText,
  useEditor,
  useTranslation,
  useUiEvents,
  useValue
} from 'tldraw'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { AllSelection } from '@tiptap/pm/state'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import aiFrameToolIconRaw from './assets/ai-frame.svg?raw'
import annotationToolIconRaw from './assets/tool-comment.svg?raw'
import {
  IS_COWART_WIDGET_BUILD,
  hasCowartWidgetBridge,
  loadCowartCanvasState,
  readCowartPageAsset,
  refreshCowartCanvasSnapshot,
  saveCowartCanvasSnapshot,
  saveCowartReferenceImage,
  saveCowartSelectionState,
  saveCowartViewState
} from './cowartClient.js'
import {
  describeSkippedRecord,
  isCanvasSnapshot,
  sanitizeCanvasSnapshotForTldraw
} from './canvasSnapshot.js'

const SELECTION_STATE_ELEMENT_ID = 'cowart-selection-state'
const PAGE_ASSETS_ROUTE = '/page-assets/'
const GLOBAL_ASSETS_ROUTE = '/assets/'
const AI_IMAGE_TOOL_ID = 'ai-image'
const AI_IMAGE_HOLDER_LABEL = 'AI 图片'
const AI_IMAGE_HOLDER_DEFAULT_W = 512
const AI_IMAGE_HOLDER_DEFAULT_H = 683
const AI_IMAGE_SIZE_MIN = 16
const AI_IMAGE_SIZE_MAX = 8192
const AI_IMAGE_GENERATION_PANEL_OFFSET = 14
const AI_IMAGE_GENERATION_PANEL_MIN_W = 520
const AI_IMAGE_GENERATION_PANEL_MAX_W = 640
const AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN = 16
const AI_IMAGE_GENERATION_PANEL_ESTIMATED_H = 226
const AI_IMAGE_GENERATION_STATUS_RESET_MS = 2200
const AI_IMAGE_REFERENCE_MAX_FILES = 10
const SKIPPED_RECORDS_NOTICE_AUTO_HIDE_MS = 5000
const AI_IMAGE_ASPECT_PRESETS = [
  { id: '1-1', label: '1:1', w: 512, h: 512 },
  { id: '3-2', label: '3:2', w: 768, h: 512 },
  { id: '2-3', label: '2:3', w: 512, h: 768 },
  { id: '4-3', label: '4:3', w: 683, h: 512 },
  { id: '3-4', label: '3:4', w: 512, h: 683 },
  { id: '16-9', label: '16:9', w: 1024, h: 576 },
  { id: '9-16', label: '9:16', w: 512, h: 910 }
]
const ANNOTATION_TOOL_ID = 'cowart-annotation'
const ANNOTATION_TOOL_LABEL = '标注'
const ANNOTATION_DEFAULT_COLOR = 'red'
const ANNOTATION_MIN_LENGTH = 8
const ANNOTATION_BEND_RATIO = 0.12
const ANNOTATION_MIN_BEND = 16
const ANNOTATION_MAX_BEND = 48
const ANNOTATION_LABEL_POSITION = 0
const ANNOTATION_SELECT_TEXT_MAX_ATTEMPTS = 8
const ANNOTATION_SELECT_TEXT_SETTLE_ATTEMPTS = 4
const ANNOTATION_EDIT_TOOL_LABEL = '按标注修改'
const ANNOTATION_EDIT_PROMPT = [
  '[@cowart](plugin://cowart@personal) 按标注修改',
  '',
  '请根据这张 Cowart 截图里的标注修改当前选中的图片：',
  '- 截图包含当前图片，以及连到图片里或图片附近的标注箭头和标注文字。',
  '- 请把标注文字当作修改要求，生成一张新的干净图片。',
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏带进最终图片。',
  '- 保留原图和原标注不动，把新图放到原图旁边。'
].join('\n')
const ANNOTATION_EDIT_EXPORT_PADDING = 32
const ANNOTATION_EDIT_NEAR_MARGIN_MIN = 160
const ANNOTATION_EDIT_NEAR_MARGIN_MAX = 720
const ANNOTATION_EDIT_RELATED_TEXT_MARGIN = 120
const ANNOTATION_EDIT_STATUS_RESET_MS = 2200
const ANNOTATION_EDIT_COLORS = new Set(['red', 'yellow', 'orange'])
const AI_IMAGE_GENERATION_PROMPT_PREFIX = [
  '[@cowart](plugin://cowart@personal) 生成图片',
  '',
  '请根据下面的 prompt 生成一张图片，并替换当前选中的 Cowart AI 图片框；最终画布里应留下普通图片形状，不保留 AI 图片框容器。',
  '如果附带一张或多张参考图，请把参考图作为视觉参考；不要把参考图文件名或任何界面元素画进最终图片。',
  '不需要选择生图模型，使用 Codex 当前可用的图片生成能力。'
].join('\n')
const aiFrameToolIconSvg = aiFrameToolIconRaw.replaceAll('black', 'currentColor')
const aiFrameToolIcon = (
  <div
    aria-hidden="true"
    className="cowart-ai-frame-tool-icon"
    dangerouslySetInnerHTML={{ __html: aiFrameToolIconSvg }}
  />
)
const annotationToolIconSvg = annotationToolIconRaw.replaceAll('black', 'currentColor')
const annotationToolIcon = (
  <div
    className="cowart-annotation-tool-icon"
    dangerouslySetInnerHTML={{ __html: annotationToolIconSvg }}
  />
)
const iconSvgSources = import.meta.glob(
  '../node_modules/@tldraw/assets/icons/icon/*.svg',
  { eager: true, query: '?raw', import: 'default' }
)
const cowartAssetUrls = buildCowartAssetUrls()
const cowartAssetObjectUrlCache = new Map()
const cowartAssetSourceKeys = new Map()

const cowartTldrawAssetStore = {
  upload: async (_asset, file) => ({ src: await readFileAsDataUrl(file) }),
  resolve: resolveCowartTldrawAssetUrl
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', revokeCowartAssetObjectUrls, { once: true })
}

function buildCowartAssetUrls() {
  const icons = {}
  for (const [path, source] of Object.entries(iconSvgSources)) {
    const name = path.split('/').pop().replace(/\.svg$/, '')
    icons[name] = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`
  }
  let base = {}
  try {
    base = getAssetUrlsByImport()
  } catch (error) {
    console.warn('Cowart could not load bundled tldraw asset URLs.', error)
  }
  return { ...base, icons: { ...base.icons, ...icons } }
}

function isCowartLocalAssetUrl(src) {
  return typeof src === 'string' && (src.startsWith(PAGE_ASSETS_ROUTE) || src.startsWith(GLOBAL_ASSETS_ROUTE))
}

function cowartAssetCacheKey(asset) {
  const src = asset?.props?.src ?? ''
  const fileSize = asset?.props?.fileSize ?? ''
  const mimeType = asset?.props?.mimeType ?? ''
  const name = asset?.props?.name ?? ''
  return [src, fileSize, mimeType, name].join('\u001f')
}

function revokeCowartCachedAsset(cacheKey) {
  const cached = cowartAssetObjectUrlCache.get(cacheKey)
  if (!cached) return
  URL.revokeObjectURL(cached.objectUrl)
  cowartAssetObjectUrlCache.delete(cacheKey)
  if (cowartAssetSourceKeys.get(cached.src) === cacheKey) {
    cowartAssetSourceKeys.delete(cached.src)
  }
}

function revokeCowartAssetObjectUrls() {
  for (const cacheKey of Array.from(cowartAssetObjectUrlCache.keys())) {
    revokeCowartCachedAsset(cacheKey)
  }
}

function blobFromBase64(dataBase64, mimeType) {
  const binary = window.atob(String(dataBase64 || ''))
  const chunks = []
  const chunkSize = 8192
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize)
    const bytes = new Uint8Array(slice.length)
    for (let index = 0; index < slice.length; index += 1) {
      bytes[index] = slice.charCodeAt(index)
    }
    chunks.push(bytes)
  }
  return new Blob(chunks, { type: mimeType || 'application/octet-stream' })
}

async function resolveCowartTldrawAssetUrl(asset) {
  const src = asset?.props?.src
  if (!src) return null
  if (!hasCowartWidgetBridge() || !isCowartLocalAssetUrl(src)) return src

  const cacheKey = cowartAssetCacheKey(asset)
  const cached = cowartAssetObjectUrlCache.get(cacheKey)
  if (cached) return cached.objectUrl

  const previousKey = cowartAssetSourceKeys.get(src)
  if (previousKey && previousKey !== cacheKey) {
    revokeCowartCachedAsset(previousKey)
  }

  try {
    const pageAsset = await readCowartPageAsset(src)
    const objectUrl = URL.createObjectURL(blobFromBase64(pageAsset.dataBase64, pageAsset.mimeType))
    cowartAssetObjectUrlCache.set(cacheKey, { objectUrl, src })
    cowartAssetSourceKeys.set(src, cacheKey)
    return objectUrl
  } catch (error) {
    console.warn('Cowart could not resolve local page asset through MCP; falling back to source URL.', error)
    return src
  }
}

function recordsAreEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

const REMOTE_REMOVABLE_RECORD_TYPES = new Set(['asset', 'binding', 'shape'])

function isRemoteRemovableRecord(record) {
  return REMOTE_REMOVABLE_RECORD_TYPES.has(record?.typeName)
}

function storeChangedSinceSnapshot(editor, baselineStore) {
  const currentStore = editor.store.getStoreSnapshot().store
  const baselineIds = new Set(Object.keys(baselineStore))

  for (const [id, baselineRecord] of Object.entries(baselineStore)) {
    const currentRecord = currentStore[id]
    if (!currentRecord) return true
    if (!recordsAreEqual(currentRecord, baselineRecord)) return true
  }

  for (const id of Object.keys(currentStore)) {
    if (!baselineIds.has(id)) return true
  }

  return false
}

function applyRemoteCanvasSnapshot(editor, snapshot, { preserveLocalChanges = false } = {}) {
  if (!isCanvasSnapshot(snapshot)) return { changedRecords: 0, skippedRecords: [] }

  const sanitized = sanitizeCanvasSnapshotForTldraw(snapshot)
  if (!sanitized.snapshot) return { changedRecords: 0, skippedRecords: sanitized.skippedRecords }

  const recordsToPut = Object.values(sanitized.snapshot.store).filter((record) => {
    if (preserveLocalChanges) return false
    const localRecord = editor.store.get(record.id)
    if (!localRecord) return true
    return !recordsAreEqual(localRecord, record)
  })
  const remoteRecordIds = new Set(Object.keys(sanitized.snapshot.store))
  const recordsToRemove = preserveLocalChanges
    ? []
    : Object.values(editor.store.getStoreSnapshot().store)
        .filter((record) => isRemoteRemovableRecord(record) && !remoteRecordIds.has(record.id))
        .map((record) => record.id)

  if (recordsToPut.length === 0 && recordsToRemove.length === 0) {
    return { changedRecords: 0, skippedRecords: sanitized.skippedRecords }
  }

  let changedRecords = 0
  editor.store.mergeRemoteChanges(() => {
    if (recordsToRemove.length > 0) {
      editor.store.remove(recordsToRemove)
      changedRecords += recordsToRemove.length
    }
    for (const record of recordsToPut) {
      try {
        editor.store.put([record])
        changedRecords += 1
      } catch (error) {
        sanitized.skippedRecords.push(describeSkippedRecord(record, error))
      }
    }
  })

  return { changedRecords, skippedRecords: sanitized.skippedRecords }
}

function getAiImageHolderMeta() {
  return {
    cowartAiImageHolder: true,
    cowartAiImageHolderVersion: 1
  }
}

function isAiImageHolderShape(shape) {
  return shape?.type === 'frame' && shape.meta?.cowartAiImageHolder === true
}

function isImageShape(shape) {
  return shape?.type === 'image'
}

function isImageShapeRecord(record) {
  return record?.typeName === 'shape' && record.type === 'image'
}

function recordValues(records) {
  return Object.values(records || {})
}

function collectRemovedImageShapeIds(changes) {
  const imageShapeIds = []
  for (const removedRecord of recordValues(changes?.removed)) {
    if (isImageShapeRecord(removedRecord)) imageShapeIds.push(removedRecord.id)
  }
  return imageShapeIds
}

function isAiImageAspectLocked(shape) {
  return isAiImageHolderShape(shape) && shape.meta?.cowartAiAspectLocked === true
}

function clampAiImageSize(value) {
  if (!Number.isFinite(value)) return null
  return Math.round(Math.min(Math.max(value, AI_IMAGE_SIZE_MIN), AI_IMAGE_SIZE_MAX))
}

function getAiImageAspectRatio(shape) {
  const metaRatio = Number(shape?.meta?.cowartAiAspectRatio)
  if (Number.isFinite(metaRatio) && metaRatio > 0) return metaRatio

  const w = Number(shape?.props?.w)
  const h = Number(shape?.props?.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null

  return w / h
}

function getAiImageAspectPreset(shape) {
  if (!shape?.props) return null

  const w = Number(shape.props.w)
  const h = Number(shape.props.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null

  const shapeRatio = w / h
  return (
    AI_IMAGE_ASPECT_PRESETS.find((preset) => {
      const presetRatio = preset.w / preset.h
      return Math.abs(shapeRatio - presetRatio) < 0.01
    }) ?? null
  )
}

function formatAiImageSize(value) {
  return String(Math.round(Number.isFinite(value) ? value : 0))
}

function getAspectIconStyle(preset) {
  const maxSize = 22
  const scale = Math.min(maxSize / preset.w, maxSize / preset.h)
  return {
    width: `${Math.max(8, Math.round(preset.w * scale))}px`,
    height: `${Math.max(8, Math.round(preset.h * scale))}px`
  }
}

function createAiImageHolderShape(editor, id, shapeOverrides = {}) {
  const scale = editor.getResizeScaleFactor()
  const { meta, props, ...shapeRecordOverrides } = shapeOverrides
  const { scale: _scale, ...frameProps } = props ?? {}

  return editor.createShape({
    ...shapeRecordOverrides,
    id,
    type: 'frame',
    meta: {
      ...getAiImageHolderMeta(),
      ...meta
    },
    props: {
      w: AI_IMAGE_HOLDER_DEFAULT_W * scale,
      h: AI_IMAGE_HOLDER_DEFAULT_H * scale,
      name: AI_IMAGE_HOLDER_LABEL,
      color: 'blue',
      ...frameProps
    }
  })
}

function createAiImageHolderAtViewportCenter(editor) {
  const scale = editor.getResizeScaleFactor()
  const w = AI_IMAGE_HOLDER_DEFAULT_W * scale
  const h = AI_IMAGE_HOLDER_DEFAULT_H * scale
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()

  createAiImageHolderShape(editor, id, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h }
  })
  editor.select(id)
  editor.setCurrentTool('select.idle')
}

function startEditingAnnotationArrowLabel(editor, arrowId) {
  const shape = editor.getShape(arrowId)
  if (!shape || !editor.canEditShape(shape)) {
    return
  }

  editor.select(arrowId)
  startEditingShapeWithRichText(editor, arrowId, { selectAll: true })
  pinAnnotationArrowLabelPosition(editor, arrowId)
  editor.getCurrentTool().setCurrentToolIdMask(ANNOTATION_TOOL_ID)
  selectAnnotationTextWhenReady(editor, arrowId)
}

function pinAnnotationArrowLabelPosition(editor, arrowId, attempt = 0) {
  editor.timers.setTimeout(() => {
    const shape = editor.getShape(arrowId)
    if (!shape || shape.meta?.cowartAnnotationArrow !== true) return
    if (shape.props.labelPosition !== ANNOTATION_LABEL_POSITION) {
      editor.updateShapes([
        {
          id: arrowId,
          type: 'arrow',
          props: {
            labelPosition: ANNOTATION_LABEL_POSITION
          }
        }
      ])
    }

    if (attempt < 2 && editor.getEditingShapeId() === arrowId) {
      pinAnnotationArrowLabelPosition(editor, arrowId, attempt + 1)
    }
  }, 16)
}

function unlockGlobalToolLock(editor) {
  if (!editor.getInstanceState().isToolLocked) return
  editor.updateInstanceState({ isToolLocked: false })
}

function selectAnnotationTextWhenReady(editor, arrowId, attempt = 0) {
  editor.timers.setTimeout(() => {
    const editingShapeId = editor.getEditingShapeId()
    if (editingShapeId !== arrowId) return

    const textEditor = editor.getRichTextEditor()
    if (textEditor) {
      textEditor.view.focus()
      textEditor.view.dispatch(
        textEditor.state.tr.setSelection(new AllSelection(textEditor.state.doc)).scrollIntoView()
      )
    }

    const didSelectText = selectAnnotationTextRange(editor, arrowId)
    if (didSelectText && attempt >= ANNOTATION_SELECT_TEXT_SETTLE_ATTEMPTS) {
      return
    }

    if (attempt < ANNOTATION_SELECT_TEXT_MAX_ATTEMPTS) {
      selectAnnotationTextWhenReady(editor, arrowId, attempt + 1)
    }
  }, 16)
}

function selectAnnotationTextRange(editor, arrowId) {
  const doc = editor.getContainerDocument()
  const shapeElement = Array.from(doc.querySelectorAll('[data-shape-id]')).find(
    (element) => element.getAttribute('data-shape-id') === arrowId
  )
  const editable = shapeElement?.querySelector('[contenteditable="true"]')

  if (!editable || typeof editable.focus !== 'function') {
    return false
  }

  editable.focus()

  const textNodes = getTextNodes(editable)
  if (textNodes.length === 0) {
    return doc.activeElement === editable || editable.contains(doc.activeElement)
  }

  const range = doc.createRange()
  const firstTextNode = textNodes[0]
  const lastTextNode = textNodes[textNodes.length - 1]
  range.setStart(firstTextNode, 0)
  range.setEnd(lastTextNode, lastTextNode.textContent?.length ?? 0)

  const selection = doc.getSelection()
  if (!selection) return false

  selection.removeAllRanges()
  selection.addRange(range)
  doc.execCommand?.('selectAll')

  return selection.rangeCount > 0 && selection.toString() === editable.textContent
}

function getTextNodes(node, textNodes = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent) {
      textNodes.push(child)
    } else {
      getTextNodes(child, textNodes)
    }
  }

  return textNodes
}

function getDefaultAnnotationArrowBend(dx, dy, scale) {
  const length = Math.hypot(dx, dy)
  if (length === 0) return 0

  const bend = Math.min(
    Math.max(length * ANNOTATION_BEND_RATIO, ANNOTATION_MIN_BEND * scale),
    ANNOTATION_MAX_BEND * scale
  )

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? -bend : bend
  }

  return bend
}

function getAnnotationColor(editor) {
  const color = editor.getStyleForNextShape(DefaultColorStyle)
  return color === DefaultColorStyle.defaultValue ? ANNOTATION_DEFAULT_COLOR : color
}

function expandBox(bounds, padding) {
  return new Box(
    bounds.x - padding,
    bounds.y - padding,
    bounds.w + padding * 2,
    bounds.h + padding * 2
  )
}

function annotationEditNearMargin(imageBounds) {
  return Math.min(
    ANNOTATION_EDIT_NEAR_MARGIN_MAX,
    Math.max(ANNOTATION_EDIT_NEAR_MARGIN_MIN, Math.max(imageBounds.w, imageBounds.h))
  )
}

function shapeHasAnnotationColor(shape) {
  const color = shape?.props?.color
  const labelColor = shape?.props?.labelColor
  return ANNOTATION_EDIT_COLORS.has(color) || ANNOTATION_EDIT_COLORS.has(labelColor)
}

function isAnnotationArrowShape(shape) {
  return shape?.type === 'arrow' && (shape.meta?.cowartAnnotationArrow === true || shapeHasAnnotationColor(shape))
}

function isAnnotationTextShape(shape) {
  return shape?.type === 'text' && (shape.meta?.cowartAnnotationText === true || shapeHasAnnotationColor(shape))
}

function uniqueShapeIds(shapeIds) {
  return Array.from(new Set(shapeIds.filter(Boolean)))
}

function collectAnnotationEditShapeIds(editor, imageShapeId) {
  const imageShape = editor.getShape(imageShapeId)
  if (!isImageShape(imageShape)) {
    throw new Error('请选择一张图片后再按标注修改。')
  }

  const imageBounds = editor.getShapePageBounds(imageShapeId)
  if (!imageBounds) {
    throw new Error('无法读取当前图片的画布位置。')
  }

  const nearBounds = expandBox(imageBounds, annotationEditNearMargin(imageBounds))
  const relatedArrowIds = []
  const relatedArrowBounds = []
  const relatedTextIds = []

  for (const shape of editor.getCurrentPageShapesSorted()) {
    if (!shape || shape.id === imageShapeId) continue

    const bounds = editor.getShapePageBounds(shape)
    if (!bounds) continue

    if (isAnnotationArrowShape(shape) && nearBounds.collides(bounds)) {
      relatedArrowIds.push(shape.id)
      relatedArrowBounds.push(bounds)
      continue
    }

    if (!isAnnotationTextShape(shape)) continue

    if (nearBounds.collides(bounds)) {
      relatedTextIds.push(shape.id)
      continue
    }

    if (
      relatedArrowBounds.some((arrowBounds) =>
        expandBox(arrowBounds, ANNOTATION_EDIT_RELATED_TEXT_MARGIN).collides(bounds)
      )
    ) {
      relatedTextIds.push(shape.id)
    }
  }

  return uniqueShapeIds([imageShapeId, ...relatedArrowIds, ...relatedTextIds])
}

function buildAnnotationEditPrompt({ imageShapeId, shapeIds, exportWidth, exportHeight, screenshotAsset }) {
  const annotationCount = Math.max(0, shapeIds.length - 1)
  const lines = [
    ANNOTATION_EDIT_PROMPT,
    '',
    `Cowart source image shape: ${imageShapeId}`,
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${Math.round(exportWidth)}x${Math.round(exportHeight)}`
  ]

  if (screenshotAsset?.assetPath) {
    lines.push(
      `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
      'Use this local screenshot file as the authoritative visual reference for the requested edits.'
    )
  }

  return lines.join('\n')
}

function getAnnotationEditExportPixelRatio(bounds) {
  const maxDimension = Math.max(bounds.w, bounds.h)
  if (maxDimension > 1600) return 1
  if (maxDimension > 1000) return 1.5
  return 2
}

function annotationEditScreenshotFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `annotation-edit-${timestamp}.png`
}

function dataUrlToImageContent(dataUrl, meta = {}) {
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    throw new Error('导出的截图不是有效的图片 data URL。')
  }

  return {
    type: 'image',
    data: match[2],
    mimeType: match[1],
    _meta: meta
  }
}

function followUpSender() {
  if (typeof window.cowartMcp?.sendFollowUpMessage === 'function') {
    return (message) => window.cowartMcp.sendFollowUpMessage(message)
  }
  if (typeof window.openai?.sendFollowUpMessage === 'function') {
    return (message) => window.openai.sendFollowUpMessage(message)
  }
  return null
}

function cowartHostCapabilities() {
  try {
    return (
      window.cowartMcp?.getHostCapabilities?.() ||
      window.openai?.hostCapabilities ||
      globalThis.__COWART_MCP_APP__?.getHostCapabilities?.() ||
      null
    )
  } catch (_error) {
    return null
  }
}

function supportsCowartMessageImages() {
  return Boolean(cowartHostCapabilities()?.message?.image)
}

async function sendAnnotationEditRequest(editor, imageShapeId) {
  const shapeIds = collectAnnotationEditShapeIds(editor, imageShapeId)
  const rawBounds = editor.getShapesPageBounds(shapeIds)
  if (!rawBounds) throw new Error('无法计算截图范围。')

  const exportBounds = expandBox(rawBounds, ANNOTATION_EDIT_EXPORT_PADDING)
  const exportResult = await editor.toImageDataUrl(shapeIds, {
    bounds: exportBounds,
    background: true,
    darkMode: false,
    format: 'png',
    padding: 0,
    pixelRatio: getAnnotationEditExportPixelRatio(exportBounds)
  })
  const screenshotAsset = await saveCowartReferenceImage({
    anchorShapeId: imageShapeId,
    fileName: annotationEditScreenshotFileName(),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const prompt = buildAnnotationEditPrompt({
    imageShapeId,
    shapeIds,
    exportWidth: exportResult.width,
    exportHeight: exportResult.height,
    screenshotAsset
  })
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  }

  const content = [{ type: 'text', text: prompt }]

  if (supportsCowartMessageImages()) {
    content.push(
      dataUrlToImageContent(exportResult.url, {
        cowartAnnotationEdit: true,
        cowartSourceImageShapeId: imageShapeId,
        cowartIncludedShapeIds: shapeIds,
        cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
        cowartAnnotationScreenshotFileName: screenshotAsset.fileName || null
      })
    )
  }

  return sender({ prompt, content })
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function formatAiImageGenerationTarget(shape) {
  const targetWidth = Math.round(Number(shape?.props?.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const targetHeight = Math.round(Number(shape?.props?.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  const ratio = targetHeight ? targetWidth / targetHeight : 1
  const preset = getAiImageAspectPreset(shape)
  const ratioLabel = preset?.label ?? `${targetWidth}:${targetHeight}`

  return {
    targetWidth,
    targetHeight,
    ratio,
    ratioLabel,
    label: `${ratioLabel} · ${targetWidth}x${targetHeight}`
  }
}

function getAiImageGenerationPanelLayout(editor, shapeId) {
  const bounds = editor.getShapePageBounds(shapeId)
  if (!bounds) return null

  const containerBounds = editor.getContainer().getBoundingClientRect()
  const viewportWidth = containerBounds.width || window.innerWidth || 0
  const viewportHeight = containerBounds.height || window.innerHeight || 0
  if (!viewportWidth || !viewportHeight) return null

  const bottomLeft = editor.pageToViewport({ x: bounds.x, y: bounds.y + bounds.h })
  const bottomRight = editor.pageToViewport({ x: bounds.x + bounds.w, y: bounds.y + bounds.h })
  const screenWidth = Math.abs(bottomRight.x - bottomLeft.x)
  const panelWidth = Math.min(
    AI_IMAGE_GENERATION_PANEL_MAX_W,
    Math.max(AI_IMAGE_GENERATION_PANEL_MIN_W, screenWidth * 2.6)
  )
  const panelLeft = clampNumber(
    bottomLeft.x + screenWidth / 2 - panelWidth / 2,
    AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN,
    Math.max(AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN, viewportWidth - panelWidth - AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN)
  )
  const preferredTop = bottomLeft.y + AI_IMAGE_GENERATION_PANEL_OFFSET
  const panelTop = clampNumber(
    preferredTop,
    AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN,
    Math.max(AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN, viewportHeight - AI_IMAGE_GENERATION_PANEL_ESTIMATED_H - AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN)
  )

  return {
    left: panelLeft,
    top: panelTop,
    width: panelWidth
  }
}

function aiImageReferenceLines({ references, referenceAttached }) {
  if (!references.length) return ['Reference images: none']

  const lines = [`Reference images: ${references.length}`]
  const localPathLines = []
  references.forEach((reference, index) => {
    const savedReference = reference.savedReference
    const displayName = savedReference?.fileName || reference.file?.name || `selected reference image ${index + 1}`
    if (savedReference?.assetPath) {
      localPathLines.push(`${index + 1}. ${savedReference.assetPath}`)
    } else {
      localPathLines.push(`${index + 1}. ${displayName} (local path unavailable)`)
    }
  })

  if (localPathLines.some((line) => !line.endsWith('(local path unavailable)'))) {
    lines.push('Reference image local paths:', ...localPathLines, 'Use these local files as visual references.')
  } else if (referenceAttached) {
    lines.push('Reference images are attached as image content blocks; use them as visual references.')
  } else {
    lines.push('Reference image local paths were unavailable.')
  }
  return lines
}

function buildAiImageGenerationPrompt({ holderShape, userPrompt, references, referenceAttached }) {
  const { targetWidth, targetHeight, ratio, ratioLabel } = formatAiImageGenerationTarget(holderShape)
  const referenceLines = aiImageReferenceLines({ references, referenceAttached })

  return [
    AI_IMAGE_GENERATION_PROMPT_PREFIX,
    '',
    `Cowart AI image holder shape: ${holderShape.id}`,
    `Target canvas slot: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${ratioLabel} (${ratio.toFixed(3)} width/height).`,
    'Compose the final bitmap for this slot without cropping or stretching.',
    ...referenceLines,
    '',
    'Prompt:',
    userPrompt.trim()
  ].join('\n')
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result || '')))
    reader.addEventListener('error', () => reject(reader.error || new Error('无法读取参考图。')))
    reader.readAsDataURL(file)
  })
}

function stopEditorOverlayEvent(event) {
  event.stopPropagation()
}

async function sendAiImageGenerationRequest({ holderShape, userPrompt, referenceFiles = [] }) {
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  }

  const imageReferences = referenceFiles.slice(0, AI_IMAGE_REFERENCE_MAX_FILES)
  const referenceAttached = Boolean(imageReferences.length && supportsCowartMessageImages())
  const references = []

  for (const [index, referenceFile] of imageReferences.entries()) {
    const referenceDataUrl = await readFileAsDataUrl(referenceFile)
    let savedReference = null
    if (hasCowartWidgetBridge()) {
      try {
        savedReference = await saveCowartReferenceImage({
          holderShapeId: holderShape.id,
          fileName: referenceFile.name || `reference-${index + 1}.png`,
          dataUrl: referenceDataUrl,
          mimeType: referenceFile.type || undefined
        })
      } catch (error) {
        if (!referenceAttached) {
          throw new Error(`参考图无法保存到 Cowart 本地 assets：${error instanceof Error ? error.message : String(error)}`)
        }
        console.warn('Cowart reference image could not be saved; relying on direct image attachment.', error)
      }
    } else if (!referenceAttached) {
      throw new Error('当前 Codex host 没有声明支持图片附件，也没有可用的 Cowart MCP 文件保存桥。')
    }
    references.push({ file: referenceFile, dataUrl: referenceDataUrl, savedReference })
  }

  const prompt = buildAiImageGenerationPrompt({
    holderShape,
    userPrompt,
    references,
    referenceAttached
  })
  const content = [{ type: 'text', text: prompt }]

  if (referenceAttached) {
    for (const [index, reference] of references.entries()) {
      content.push(dataUrlToImageContent(reference.dataUrl, {
        cowartAiImageReference: true,
        cowartAiImageReferenceIndex: index + 1,
        cowartAiImageHolderShapeId: holderShape.id,
        cowartReferenceFileName: reference.file.name || null,
        cowartReferenceAssetPath: reference.savedReference?.assetPath || null
      }))
    }
  }

  return sender({ prompt, content })
}

class CowartAnnotationTool extends StateNode {
  static id = ANNOTATION_TOOL_ID
  static initial = 'idle'

  static children() {
    return [CowartAnnotationIdle, CowartAnnotationPointing]
  }

  onEnter() {
    unlockGlobalToolLock(this.editor)
  }
}

class CowartAnnotationIdle extends StateNode {
  static id = 'idle'

  onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  onPointerDown(info) {
    this.parent.transition('pointing', info)
  }

  onCancel() {
    this.editor.setCurrentTool('select')
  }
}

class CowartAnnotationPointing extends StateNode {
  static id = 'pointing'

  arrowId = null
  markId = ''
  origin = null

  onEnter() {
    const origin = this.editor.inputs.getOriginPagePoint()
    const scale = this.editor.getResizeScaleFactor()
    const color = getAnnotationColor(this.editor)
    const arrowId = createShapeId()

    this.arrowId = arrowId
    this.origin = { x: origin.x, y: origin.y }
    this.markId = this.editor.markHistoryStoppingPoint(`creating_annotation:${arrowId}`)

    this.editor.createShape({
      id: arrowId,
      type: 'arrow',
      x: origin.x,
      y: origin.y,
      meta: {
        cowartAnnotationArrow: true
      },
      props: {
        kind: 'arc',
        dash: 'draw',
        size: 'm',
        fill: 'none',
        color,
        labelColor: color,
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
        richText: toRichText(''),
        labelPosition: ANNOTATION_LABEL_POSITION,
        font: 'draw',
        scale
      }
    })
  }

  onPointerMove() {
    this.updateArrowEnd()
  }

  onPointerUp() {
    this.complete()
  }

  onCancel() {
    this.cancel()
  }

  onInterrupt() {
    this.cancel()
  }

  updateArrowEnd() {
    if (!this.arrowId || !this.origin) return

    const point = this.editor.inputs.getCurrentPagePoint()
    this.editor.updateShapes([
      {
        id: this.arrowId,
        type: 'arrow',
        props: {
          end: {
            x: point.x - this.origin.x,
            y: point.y - this.origin.y
          }
        }
      }
    ])
  }

  complete() {
    if (!this.arrowId || !this.origin) {
      this.editor.setCurrentTool(ANNOTATION_TOOL_ID)
      return
    }

    this.updateArrowEnd()

    const point = this.editor.inputs.getCurrentPagePoint()
    const dx = point.x - this.origin.x
    const dy = point.y - this.origin.y
    const length = Math.hypot(dx, dy)

    if (length < ANNOTATION_MIN_LENGTH / this.editor.getZoomLevel()) {
      this.editor.bailToMark(this.markId)
      this.parent.transition('idle')
      return
    }

    this.editor.updateShapes([
      {
        id: this.arrowId,
        type: 'arrow',
        props: {
          bend: getDefaultAnnotationArrowBend(dx, dy, this.editor.getResizeScaleFactor())
        }
      }
    ])

    startEditingAnnotationArrowLabel(this.editor, this.arrowId)
  }

  cancel() {
    if (this.arrowId) {
      this.editor.bailToMark(this.markId)
    }
    this.parent.transition('idle')
  }
}

class CowartFrameShapeUtil extends FrameShapeUtil {
  isAspectRatioLocked(shape) {
    if (isAiImageHolderShape(shape)) {
      return isAiImageAspectLocked(shape)
    }

    return super.isAspectRatioLocked(shape)
  }
}

const cowartShapeUtils = [CowartFrameShapeUtil]

const cowartUiOverrides = {
  translations: {
    en: {
      'tool.ai-image': AI_IMAGE_HOLDER_LABEL,
      'tool.cowart-annotation': ANNOTATION_TOOL_LABEL
    },
    'zh-cn': {
      'tool.ai-image': AI_IMAGE_HOLDER_LABEL,
      'tool.cowart-annotation': ANNOTATION_TOOL_LABEL
    }
  },
  tools(editor, tools) {
    return {
      ...tools,
      arrow: {
        ...tools.arrow,
        kbd: undefined
      },
      [AI_IMAGE_TOOL_ID]: {
        id: AI_IMAGE_TOOL_ID,
        label: 'tool.ai-image',
        icon: aiFrameToolIcon,
        kbd: 'a',
        onSelect() {
          createAiImageHolderAtViewportCenter(editor)
        },
        onDragStart(source, info) {
          const scale = editor.getResizeScaleFactor()
          onDragFromToolbarToCreateShape(editor, info, {
            createShape: (id) =>
              createAiImageHolderShape(editor, id, {
                props: {
                  w: AI_IMAGE_HOLDER_DEFAULT_W * scale,
                  h: AI_IMAGE_HOLDER_DEFAULT_H * scale
                }
              }),
            onDragEnd: (id) => editor.select(id)
          })
        },
        meta: {
          cowartTool: 'ai-image-holder'
        }
      },
      [ANNOTATION_TOOL_ID]: {
        id: ANNOTATION_TOOL_ID,
        label: 'tool.cowart-annotation',
        icon: annotationToolIcon,
        kbd: 'c',
        onSelect() {
          unlockGlobalToolLock(editor)
          editor.setCurrentTool(ANNOTATION_TOOL_ID)
        },
        meta: {
          cowartTool: 'annotation'
        }
      }
    }
  }
}

const cowartComponents = {
  Toolbar: CowartToolbar,
  ImageToolbar: CowartImageToolbar,
  InFrontOfTheCanvas: CowartCanvasOverlay,
  StylePanel: CowartStylePanel
}

function CowartCanvasOverlay() {
  return <CowartAiImageGenerationPanel />
}

function CowartAiImageGenerationPanel() {
  const editor = useEditor()
  const selectedTarget = useValue(
    'selected ai image holder generation panel target',
    () => {
      const shape = editor.getOnlySelectedShape()
      if (!isAiImageHolderShape(shape)) return null

      editor.getCamera()
      editor.getViewportScreenBounds()

      const layout = getAiImageGenerationPanelLayout(editor, shape.id)
      if (!layout) return null

      return {
        shape,
        layout
      }
    },
    [editor]
  )
  const fileInputRef = useRef(null)
  const [promptValue, setPromptValue] = useState('')
  const [referenceFiles, setReferenceFiles] = useState([])
  const [referencePreviews, setReferencePreviews] = useState([])
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    setStatus('idle')
    setErrorMessage('')
  }, [selectedTarget?.shape.id])

  useEffect(() => {
    if (status !== 'sent') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), AI_IMAGE_GENERATION_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  useEffect(() => {
    const previews = referenceFiles.map((file, index) => ({
      file,
      key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      url: URL.createObjectURL(file)
    }))
    setReferencePreviews(previews)
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url))
    }
  }, [referenceFiles])

  if (!selectedTarget) return null

  const { shape, layout } = selectedTarget
  const canSend = promptValue.trim().length > 0 || referenceFiles.length > 0
  const isSending = status === 'sending'

  function handleReferenceChange(event) {
    const selectedFiles = Array.from(event.target.files || [])
    if (!selectedFiles.length) return

    const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length !== selectedFiles.length) {
      setStatus('error')
      setErrorMessage('请选择图片文件。')
      event.target.value = ''
      return
    }

    const availableSlots = Math.max(0, AI_IMAGE_REFERENCE_MAX_FILES - referenceFiles.length)
    if (!availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
      event.target.value = ''
      return
    }

    const filesToAdd = imageFiles.slice(0, availableSlots)
    setReferenceFiles((currentFiles) => [...currentFiles, ...filesToAdd].slice(0, AI_IMAGE_REFERENCE_MAX_FILES))
    if (imageFiles.length > availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
    } else {
      setStatus('idle')
      setErrorMessage('')
    }
    event.target.value = ''
  }

  function clearReferences() {
    setReferenceFiles([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function removeReferenceAt(indexToRemove) {
    setReferenceFiles((currentFiles) => currentFiles.filter((_file, index) => index !== indexToRemove))
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    if (status === 'error') {
      setStatus('idle')
      setErrorMessage('')
    }
  }

  async function handleSubmit(event) {
    event?.preventDefault()
    if (!canSend || isSending) return

    setStatus('sending')
    setErrorMessage('')
    try {
      await sendAiImageGenerationRequest({
        holderShape: shape,
        userPrompt: promptValue,
        referenceFiles
      })
      setPromptValue('')
      clearReferences()
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : '发送失败，请重试。')
    }
  }

  function handlePromptKeyDown(event) {
    stopEditorOverlayEvent(event)
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      handleSubmit(event)
    }
  }

  return (
    <div className="cowart-ai-generation-overlay" aria-hidden={false}>
      <form
        aria-label="AI 图片生成"
        className="cowart-ai-generation-panel"
        data-status={status}
        onClick={stopEditorOverlayEvent}
        onDoubleClick={stopEditorOverlayEvent}
        onKeyDown={stopEditorOverlayEvent}
        onPointerDown={stopEditorOverlayEvent}
        onSubmit={handleSubmit}
        style={{
          left: `${layout.left}px`,
          top: `${layout.top}px`,
          width: `${layout.width}px`
        }}
      >
        <div className="cowart-ai-generation-reference-row">
          <div className="cowart-ai-generation-reference-strip">
            {referencePreviews.map((preview, index) => (
              <div className="cowart-ai-generation-reference-preview" key={preview.key}>
                <img alt={`参考图 ${index + 1}`} src={preview.url} />
                <button aria-label={`移除参考图 ${index + 1}`} onClick={() => removeReferenceAt(index)} type="button">
                  <TldrawUiButtonIcon icon="cross-2" small />
                </button>
              </div>
            ))}
            {referenceFiles.length < AI_IMAGE_REFERENCE_MAX_FILES && (
              <button
                aria-label="选择参考图"
                className="cowart-ai-generation-reference-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <TldrawUiButtonIcon icon="tool-media" small />
                <span>参考图</span>
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            accept="image/*"
            className="cowart-ai-generation-file-input"
            multiple
            onChange={handleReferenceChange}
            type="file"
          />
        </div>

        <textarea
          aria-label="自定义 prompt"
          className="cowart-ai-generation-prompt"
          disabled={isSending}
          onChange={(event) => {
            setPromptValue(event.target.value)
            if (status === 'error') {
              setStatus('idle')
              setErrorMessage('')
            }
          }}
          onKeyDown={handlePromptKeyDown}
          placeholder="描述你想生成的图片"
          rows={3}
          value={promptValue}
        />

        <div className="cowart-ai-generation-footer">
          <div className="cowart-ai-generation-status" aria-live="polite">
            {status === 'sending'
              ? '正在发送'
              : status === 'sent'
                ? '已发送'
                : errorMessage}
          </div>
          <button
            aria-label="发送生成请求"
            className="cowart-ai-generation-send"
            disabled={!canSend || isSending}
            type="submit"
          >
            <span>{isSending ? '发送中' : '发送'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}

function CowartStylePanel(props) {
  return (
    <DefaultStylePanel {...props}>
      <DefaultStylePanelContent />
      <CowartAiImageStyleControls />
    </DefaultStylePanel>
  )
}

function CowartAiImageStyleControls() {
  const editor = useEditor()
  const selectedAiImageShape = useValue(
    'selected ai image holder shape',
    () => {
      const selectedShapeIds = editor.getSelectedShapeIds()
      if (selectedShapeIds.length !== 1) return null

      const shape = editor.getShape(selectedShapeIds[0])
      return isAiImageHolderShape(shape) ? shape : null
    },
    [editor]
  )
  const [widthValue, setWidthValue] = useState('')
  const [heightValue, setHeightValue] = useState('')

  useEffect(() => {
    if (!selectedAiImageShape) {
      setWidthValue('')
      setHeightValue('')
      return
    }

    setWidthValue(formatAiImageSize(selectedAiImageShape.props.w))
    setHeightValue(formatAiImageSize(selectedAiImageShape.props.h))
  }, [selectedAiImageShape?.id, selectedAiImageShape?.props.w, selectedAiImageShape?.props.h])

  if (!selectedAiImageShape) return null

  const activePreset = getAiImageAspectPreset(selectedAiImageShape)
  const currentWidth = Number(selectedAiImageShape.props.w)
  const currentHeight = Number(selectedAiImageShape.props.h)
  const currentRatio = currentHeight ? currentWidth / currentHeight : 1
  const isAspectLocked = isAiImageAspectLocked(selectedAiImageShape)

  function updateAiImageSize(nextWidth, nextHeight, historyMark = 'resize-ai-image-holder') {
    const w = clampAiImageSize(nextWidth)
    const h = clampAiImageSize(nextHeight)
    if (!w || !h) return

    editor.markHistoryStoppingPoint(historyMark)
    editor.updateShapes([
      {
        id: selectedAiImageShape.id,
        type: 'frame',
        meta: {
          ...selectedAiImageShape.meta,
          cowartAiAspectRatio: w / h
        },
        props: { w, h }
      }
    ])
  }

  function toggleAspectLock() {
    const nextIsLocked = !isAspectLocked
    editor.markHistoryStoppingPoint('toggle-ai-image-aspect-lock')
    editor.updateShapes([
      {
        id: selectedAiImageShape.id,
        type: 'frame',
        meta: {
          ...selectedAiImageShape.meta,
          cowartAiAspectLocked: nextIsLocked,
          cowartAiAspectRatio: currentRatio
        }
      }
    ])
  }

  function commitWidth(value) {
    const nextWidth = clampAiImageSize(Number(value))
    if (!nextWidth) {
      setWidthValue(formatAiImageSize(currentWidth))
      return
    }

    const nextHeight = isAspectLocked ? Math.round(nextWidth / currentRatio) : currentHeight
    updateAiImageSize(nextWidth, nextHeight)
  }

  function commitHeight(value) {
    const nextHeight = clampAiImageSize(Number(value))
    if (!nextHeight) {
      setHeightValue(formatAiImageSize(currentHeight))
      return
    }

    const nextWidth = isAspectLocked ? Math.round(nextHeight * currentRatio) : currentWidth
    updateAiImageSize(nextWidth, nextHeight)
  }

  function handleNumberKeyDown(event) {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
    if (event.key === 'Escape') {
      setWidthValue(formatAiImageSize(currentWidth))
      setHeightValue(formatAiImageSize(currentHeight))
      event.currentTarget.blur()
    }
  }

  return (
    <div className="cowart-ai-image-style-panel" aria-label="AI 图片尺寸设置">
      <section className="cowart-ai-style-section">
        <div className="cowart-ai-style-heading">
          <span>尺寸</span>
        </div>
        <div className="cowart-ai-size-row">
          <label className="cowart-ai-size-field">
            <span>W</span>
            <input
              aria-label="AI 图片宽度"
              inputMode="numeric"
              min={AI_IMAGE_SIZE_MIN}
              max={AI_IMAGE_SIZE_MAX}
              value={widthValue}
              onChange={(event) => setWidthValue(event.target.value)}
              onBlur={(event) => commitWidth(event.target.value)}
              onKeyDown={handleNumberKeyDown}
            />
          </label>
          <button
            aria-label={isAspectLocked ? '解除宽高比例锁定' : '锁定宽高比例'}
            aria-pressed={isAspectLocked}
            className="cowart-ai-aspect-lock"
            onClick={toggleAspectLock}
            type="button"
          >
            <CowartAspectLockIcon locked={isAspectLocked} />
          </button>
          <label className="cowart-ai-size-field">
            <span>H</span>
            <input
              aria-label="AI 图片高度"
              inputMode="numeric"
              min={AI_IMAGE_SIZE_MIN}
              max={AI_IMAGE_SIZE_MAX}
              value={heightValue}
              onChange={(event) => setHeightValue(event.target.value)}
              onBlur={(event) => commitHeight(event.target.value)}
              onKeyDown={handleNumberKeyDown}
            />
          </label>
        </div>
      </section>

      <section className="cowart-ai-style-section">
        <div className="cowart-ai-style-heading">
          <span>比例</span>
        </div>
        <div className="cowart-ai-aspect-grid">
          {AI_IMAGE_ASPECT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              aria-pressed={activePreset?.id === preset.id}
              className="cowart-ai-aspect-preset"
              onClick={() =>
                updateAiImageSize(preset.w, preset.h, `resize-ai-image-holder:${preset.id}`)
              }
              type="button"
            >
              <span
                className="cowart-ai-aspect-icon"
                style={getAspectIconStyle(preset)}
              />
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function CowartAspectLockIcon({ locked }) {
  if (locked) {
    return (
      <svg
        aria-hidden="true"
        className="cowart-ai-lock-icon"
        viewBox="0 0 20 20"
      >
        <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
        <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" />
      </svg>
    )
  }

  return (
    <svg
      aria-hidden="true"
      className="cowart-ai-lock-icon"
      viewBox="0 0 20 20"
    >
      <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
      <path d="M7 8.5V6.5a3 3 0 0 1 5.8-1.1" />
    </svg>
  )
}

function CowartImageToolbar() {
  return (
    <DefaultImageToolbar>
      <CowartImageToolbarContent />
    </DefaultImageToolbar>
  )
}

function CowartImageToolbarContent() {
  const editor = useEditor()
  const imageShapeId = useValue(
    'cowart selected image shape id',
    () => {
      const shape = editor.getOnlySelectedShape()
      return isImageShape(shape) ? shape.id : null
    },
    [editor]
  )
  const isInCropTool = useValue('cowart image crop tool state', () => editor.isIn('select.crop.'), [
    editor
  ])
  const [isEditingAltText, setIsEditingAltText] = useState(false)

  const handleManipulatingEnd = useCallback(() => {
    editor.setCroppingShape(null)
    editor.setCurrentTool('select.idle')
  }, [editor])
  const handleManipulatingStart = useCallback(() => editor.setCurrentTool('select.crop.idle'), [editor])
  const handleEditAltTextStart = useCallback(() => setIsEditingAltText(true), [])
  const handleEditAltTextClose = useCallback(() => setIsEditingAltText(false), [])

  useEffect(() => {
    setIsEditingAltText(false)
  }, [imageShapeId])

  if (!imageShapeId) return null

  if (isEditingAltText) {
    return (
      <CowartAltTextEditor
        onClose={handleEditAltTextClose}
        shapeId={imageShapeId}
      />
    )
  }

  return (
    <>
      <DefaultImageToolbarContent
        imageShapeId={imageShapeId}
        isManipulating={isInCropTool}
        onEditAltTextStart={handleEditAltTextStart}
        onManipulatingEnd={handleManipulatingEnd}
        onManipulatingStart={handleManipulatingStart}
      />
      {!isInCropTool && <CowartAnnotationEditToolbarButton imageShapeId={imageShapeId} />}
      {!isInCropTool && <CowartExportAnnotatedImageButton imageShapeId={imageShapeId} />}
    </>
  )
}

function CowartAltTextEditor({ shapeId, onClose }) {
  const editor = useEditor()
  const msg = useTranslation()
  const trackEvent = useUiEvents()
  const inputRef = useRef(null)
  const isReadonly = editor.getIsReadonly()
  const [altText, setAltText] = useState(() => {
    const shape = editor.getShape(shapeId)
    return typeof shape?.props?.altText === 'string' ? shape.props.altText : ''
  })

  const handleComplete = useCallback(() => {
    trackEvent('set-alt-text', { source: 'image-toolbar' })
    const shape = editor.getShape(shapeId)
    if (shape && 'altText' in shape.props) {
      editor.updateShapes([
        {
          id: shape.id,
          type: shape.type,
          props: { altText }
        }
      ])
    }
    onClose()
  }, [altText, editor, onClose, shapeId, trackEvent])

  useEffect(() => {
    inputRef.current?.select()

    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }

    const doc = editor.getContainerDocument()
    doc.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => doc.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [editor, inputRef, onClose])

  useEffect(() => {
    function handlePointerDown(event) {
      const toolbar = editor.getContainerDocument().querySelector('.tlui-media__toolbar')
      if (toolbar?.contains(event.target)) return
      handleComplete()
    }

    const doc = editor.getContainerDocument()
    doc.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => doc.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [editor, handleComplete])

  return (
    <>
      <TldrawUiInput
        ref={inputRef}
        aria-label={msg('tool.media-alt-text-desc')}
        className="tlui-media__toolbar-alt-text-input"
        data-testid="media-toolbar.alt-text-input"
        disabled={isReadonly}
        onCancel={onClose}
        onComplete={handleComplete}
        onValueChange={setAltText}
        placeholder={msg('tool.media-alt-text-desc')}
        value={altText}
      />
      {!isReadonly && (
        <TldrawUiButton
          data-testid="tool.media-alt-text-confirm"
          onClick={handleComplete}
          onPointerDown={(event) => event.preventDefault()}
          title={msg('tool.media-alt-text-confirm')}
          type="icon"
        >
          <TldrawUiButtonIcon icon="check" small />
        </TldrawUiButton>
      )}
    </>
  )
}

function CowartAnnotationEditToolbarButton({ imageShapeId }) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    if (status === 'idle' || status === 'sending') return
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  async function handleClick() {
    if (status === 'sending') return

    setStatus('sending')
    try {
      await sendAnnotationEditRequest(editor, imageShapeId)
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }

  const title =
    status === 'sending'
      ? '正在提交标注修改'
      : status === 'sent'
        ? '已提交标注修改'
        : status === 'error'
          ? '提交失败，请重试'
          : ANNOTATION_EDIT_TOOL_LABEL

  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-annotation-edit-toolbar-button"
      data-status={status}
      data-testid="tool.cowart-annotation-edit"
      disabled={status === 'sending'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      <TldrawUiButtonIcon
        icon={status === 'sent' ? 'check' : status === 'error' ? 'warning-triangle' : 'tool-highlight'}
        small
      />
      <span className="cowart-annotation-edit-toolbar-label">{ANNOTATION_EDIT_TOOL_LABEL}</span>
    </TldrawUiToolbarButton>
  )
}

const EXPORT_ANNOTATED_IMAGE_LABEL = '导出标注图'
const EXPORT_ANNOTATED_IMAGE_RESET_MS = 2200

function CowartExportAnnotatedImageButton({ imageShapeId }) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    if (status === 'processing' || status === 'idle') return
    const timer = window.setTimeout(() => setStatus('idle'), EXPORT_ANNOTATED_IMAGE_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  async function handleClick() {
    if (status === 'processing') return

    setStatus('processing')
    try {
      const shapeIds = collectAnnotationEditShapeIds(editor, imageShapeId)
      const rawBounds = editor.getShapesPageBounds(shapeIds)
      if (!rawBounds) throw new Error('无法计算导出范围。')

      const exportBounds = expandBox(rawBounds, ANNOTATION_EDIT_EXPORT_PADDING)
      const exportResult = await editor.toImageDataUrl(shapeIds, {
        bounds: exportBounds,
        background: true,
        darkMode: false,
        format: 'png',
        padding: 0,
        pixelRatio: Math.max(getAnnotationEditExportPixelRatio(exportBounds), 2)
      })

      const dataUrl = exportResult.url

      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
      const fileName = `cowart-export-${timestamp}.png`

      const link = document.createElement('a')
      link.download = fileName
      link.href = dataUrl
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      const response = await fetch(dataUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])

      setStatus('success')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }

  const title =
    status === 'processing'
      ? '正在导出…'
      : status === 'success'
        ? '已导出并复制到剪贴板'
        : status === 'error'
          ? '导出失败，请重试'
          : EXPORT_ANNOTATED_IMAGE_LABEL

  const iconName = status === 'success' ? 'check' : status === 'error' ? 'warning-triangle' : 'duplicate'

  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-export-annotated-image-toolbar-button"
      data-status={status}
      data-testid="tool.cowart-export-annotated-image"
      disabled={status === 'processing'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      <TldrawUiButtonIcon icon={iconName} small />
      <span className="cowart-export-annotated-image-toolbar-label">{EXPORT_ANNOTATED_IMAGE_LABEL}</span>
    </TldrawUiToolbarButton>
  )
}

function CowartToolbarItem({ toolId }) {
  const editor = useEditor()
  const isSelected = useValue(
    `is ${toolId} selected`,
    () => editor.getCurrentToolId() === toolId,
    [editor, toolId]
  )

  return <TldrawUiMenuToolItem toolId={toolId} isSelected={isSelected} />
}

function CowartAnnotationToolbarItem() {
  const editor = useEditor()
  const isSelected = useValue(
    'is annotation selected',
    () => editor.getCurrentToolId() === ANNOTATION_TOOL_ID,
    [editor]
  )

  return (
    <button
      aria-label={ANNOTATION_TOOL_LABEL}
      aria-pressed={isSelected ? 'true' : 'false'}
      className="tlui-button tlui-button__tool cowart-annotation-toolbar-button"
      data-testid={`tools.${ANNOTATION_TOOL_ID}`}
      data-value={ANNOTATION_TOOL_ID}
      draggable={false}
      onClick={() => {
        unlockGlobalToolLock(editor)
        editor.setCurrentTool(ANNOTATION_TOOL_ID)
      }}
      onTouchStart={(event) => {
        event.preventDefault()
        unlockGlobalToolLock(editor)
        editor.setCurrentTool(ANNOTATION_TOOL_ID)
      }}
      title={ANNOTATION_TOOL_LABEL}
      type="button"
    >
      {annotationToolIcon}
      <span className="cowart-annotation-toolbar-label" draggable={false}>
        {ANNOTATION_TOOL_LABEL}
      </span>
    </button>
  )
}

function CowartToolbarDivider() {
  return <div aria-orientation="vertical" className="cowart-toolbar-divider" role="separator" />
}

function CowartToolbar(props) {
  return (
    <DefaultToolbar {...props} maxItems={9}>
      <CowartAnnotationToolbarItem />
      <CowartToolbarDivider />
      <SelectToolbarItem />
      <HandToolbarItem />
      <CowartToolbarItem toolId={AI_IMAGE_TOOL_ID} />
      <CowartToolbarDivider />
      <AssetToolbarItem />
      <DrawToolbarItem />
      <EraserToolbarItem />
      <TextToolbarItem />
      <ArrowToolbarItem />
      <NoteToolbarItem />
      <RectangleToolbarItem />
      <EllipseToolbarItem />
      <TriangleToolbarItem />
      <DiamondToolbarItem />
      <HexagonToolbarItem />
      <OvalToolbarItem />
      <RhombusToolbarItem />
      <StarToolbarItem />
      <CloudToolbarItem />
      <HeartToolbarItem />
      <XBoxToolbarItem />
      <CheckBoxToolbarItem />
      <ArrowLeftToolbarItem />
      <ArrowUpToolbarItem />
      <ArrowDownToolbarItem />
      <ArrowRightToolbarItem />
      <LineToolbarItem />
      <HighlightToolbarItem />
      <LaserToolbarItem />
      <FrameToolbarItem />
    </DefaultToolbar>
  )
}

function getCowartSelection(editor) {
  const selectedShapeIds = editor.getSelectedShapeIds()
  return selectedShapeIds.map((id) => {
    const shape = editor.getShape(id)
    const asset = shape?.props?.assetId ? editor.getAsset(shape.props.assetId) : null
    return {
      id,
      type: shape?.type ?? null,
      parentId: shape?.parentId ?? null,
      x: shape?.x ?? null,
      y: shape?.y ?? null,
      rotation: shape?.rotation ?? null,
      meta: shape?.meta ?? null,
      isAiImageHolder: shape?.meta?.cowartAiImageHolder === true,
      props: shape?.props ?? null,
      asset: asset
        ? {
            id: asset.id,
            type: asset.type,
            name: asset.props?.name ?? null,
            src: asset.props?.src ?? null,
            w: asset.props?.w ?? null,
            h: asset.props?.h ?? null,
            mimeType: asset.props?.mimeType ?? null,
            fileSize: asset.props?.fileSize ?? null
          }
        : null
    }
  })
}

function getCowartSelectionSnapshot(editor) {
  return {
    selectedShapes: getCowartSelection(editor)
  }
}

function getCowartViewState(editor) {
  const camera = editor.getCamera()
  return {
    version: 1,
    currentPageId: editor.getCurrentPageId(),
    camera: {
      x: camera.x,
      y: camera.y,
      z: camera.z
    }
  }
}

function isRestorableViewState(viewState) {
  return (
    viewState &&
    typeof viewState === 'object' &&
    typeof viewState.currentPageId === 'string' &&
    viewState.camera &&
    Number.isFinite(viewState.camera.x) &&
    Number.isFinite(viewState.camera.y) &&
    Number.isFinite(viewState.camera.z)
  )
}

function restoreCowartViewState(editor, viewState) {
  if (!isRestorableViewState(viewState)) return
  if (!editor.getPage(viewState.currentPageId)) return

  editor.setCurrentPage(viewState.currentPageId)
  editor.setCamera(viewState.camera, { immediate: true, force: true })
}

function writeCowartSelectionState(selectionSnapshot) {
  let stateElement = document.getElementById(SELECTION_STATE_ELEMENT_ID)
  if (!stateElement) {
    stateElement = document.createElement('script')
    stateElement.id = SELECTION_STATE_ELEMENT_ID
    stateElement.type = 'application/json'
    document.body.append(stateElement)
  }

  stateElement.textContent = JSON.stringify({
    ...selectionSnapshot,
    updatedAt: new Date().toISOString()
  })
}

export default function App() {
  const [snapshot, setSnapshot] = useState()
  const [viewState, setViewState] = useState()
  const [loadError, setLoadError] = useState(null)
  const [skippedRecords, setSkippedRecords] = useState([])

  useEffect(() => {
    const controller = new AbortController()

    async function loadCanvas() {
      try {
        const canvasState = await loadCowartCanvasState(controller.signal)
        const sanitized = sanitizeCanvasSnapshotForTldraw(canvasState.snapshot)
        setSnapshot(sanitized.snapshot)
        setSkippedRecords(sanitized.skippedRecords)
        setViewState(canvasState.viewState ?? null)
      } catch (error) {
        if (error.name === 'AbortError') return
        setLoadError(error)
        setSnapshot(null)
        setViewState(null)
      }
    }

    loadCanvas()

    return () => controller.abort()
  }, [])

  const handleMount = useCallback((editor) => {
    window.__cowartEditor = editor
    window.__cowartSelection = () => getCowartSelection(editor)
    window.__cowartViewState = () => getCowartViewState(editor)
    let lastSyncedSelectionState = ''
    let isSelectionStateSaving = false
    let hasPendingSelectionState = false
    let lastSyncedViewState = ''
    let isViewStateSaving = false
    let hasPendingViewState = false

    editor.timers.requestAnimationFrame(() => {
      restoreCowartViewState(editor, viewState)
    })

    async function syncSelectionState() {
      const selectionSnapshot = getCowartSelectionSnapshot(editor)
      writeCowartSelectionState(selectionSnapshot)

      const selectionState = JSON.stringify(selectionSnapshot)
      if (selectionState === lastSyncedSelectionState) return
      lastSyncedSelectionState = selectionState

      if (isSelectionStateSaving) {
        hasPendingSelectionState = true
        return
      }

      isSelectionStateSaving = true
      try {
        await saveCowartSelectionState({
          ...selectionSnapshot,
          updatedAt: new Date().toISOString()
        })
      } catch (error) {
        console.error(error)
      } finally {
        isSelectionStateSaving = false
        if (hasPendingSelectionState) {
          hasPendingSelectionState = false
          syncSelectionState()
        }
      }
    }

    syncSelectionState()
    const selectionStateTimer = window.setInterval(syncSelectionState, 250)

    async function syncViewState() {
      const viewStateSnapshot = {
        ...getCowartViewState(editor),
        updatedAt: new Date().toISOString()
      }

      const nextViewState = JSON.stringify(viewStateSnapshot)
      if (nextViewState === lastSyncedViewState) return
      lastSyncedViewState = nextViewState

      if (isViewStateSaving) {
        hasPendingViewState = true
        return
      }

      isViewStateSaving = true
      try {
        await saveCowartViewState(viewStateSnapshot)
      } catch (error) {
        console.error(error)
      } finally {
        isViewStateSaving = false
        if (hasPendingViewState) {
          hasPendingViewState = false
          syncViewState()
        }
      }
    }

    const viewStateTimer = window.setInterval(syncViewState, 500)
    editor.timers.setTimeout(syncViewState, 100)

    let saveTimer = null
    let isSaving = false
    let hasPendingSave = false
    let hasUnsavedChanges = false
    let isSyncingAnnotationShape = false
    let remoteLoadController = null
    const acknowledgedImageShapeDeletes = new Set()

    async function saveCanvas() {
      if (!hasUnsavedChanges) return

      if (isSaving) {
        hasPendingSave = true
        return
      }

      isSaving = true
      try {
        const saveResult = await saveCowartCanvasSnapshot(editor.store.getStoreSnapshot(), {
          protectImageRecords: true,
          acknowledgedImageShapeDeletes: Array.from(acknowledgedImageShapeDeletes)
        })
        if (saveResult?.ok === false) {
          throw new Error(saveResult.message || 'Cowart refused to save the canvas snapshot.')
        }
        acknowledgedImageShapeDeletes.clear()
        hasUnsavedChanges = false
      } catch (error) {
        console.error(error)
      } finally {
        isSaving = false
        if (hasPendingSave) {
          hasPendingSave = false
          scheduleSave()
        }
      }
    }

    function scheduleSave() {
      hasUnsavedChanges = true
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(saveCanvas, 500)
    }

    async function loadRemoteCanvasSnapshot() {
      remoteLoadController?.abort()
      const controller = new AbortController()
      remoteLoadController = controller

      const preserveLocalChanges = hasUnsavedChanges || isSaving
      const preFetchStore = preserveLocalChanges ? null : editor.store.getStoreSnapshot().store

      try {
        const nextSnapshot = await refreshCowartCanvasSnapshot(controller.signal)
        const effectivePreserve =
          preserveLocalChanges || (preFetchStore && storeChangedSinceSnapshot(editor, preFetchStore))
        const { changedRecords, skippedRecords: nextSkippedRecords } = applyRemoteCanvasSnapshot(
          editor,
          nextSnapshot,
          {
            preserveLocalChanges: effectivePreserve
          }
        )
        setSkippedRecords(nextSkippedRecords)

        if (changedRecords > 0 && effectivePreserve) {
          hasUnsavedChanges = true
          if (isSaving) {
            hasPendingSave = true
          } else {
            scheduleSave()
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') return
        console.error(error)
      } finally {
        if (remoteLoadController === controller) {
          remoteLoadController = null
        }
      }
    }

    const unsubscribe = editor.store.listen(
      ({ changes }) => {
        for (const imageShapeId of collectRemovedImageShapeIds(changes)) {
          acknowledgedImageShapeDeletes.add(imageShapeId)
        }
        scheduleSave()
      },
      {
        source: 'user',
        scope: 'document'
      }
    )

    let canvasEvents = null
    let canvasRefreshTimer = null
    if (hasCowartWidgetBridge()) {
      canvasRefreshTimer = window.setInterval(loadRemoteCanvasSnapshot, 1600)
    } else if (!IS_COWART_WIDGET_BUILD && 'EventSource' in window) {
      canvasEvents = new window.EventSource('/api/canvas-events')
      canvasEvents.addEventListener('canvas-changed', loadRemoteCanvasSnapshot)
      canvasEvents.onerror = (error) => {
        console.warn('Cowart canvas live refresh disconnected.', error)
      }
    }

    const unsubscribeAnnotationEditingToolLock = editor.store.listen(
      ({ changes }) => {
        for (const [previous, next] of Object.values(changes.updated)) {
          if (previous?.typeName !== 'instance_page_state') continue
          if (!previous.editingShapeId || next.editingShapeId) continue

          const shape = editor.getShape(previous.editingShapeId)
          if (shape?.meta?.cowartAnnotationArrow !== true) continue

          editor.timers.requestAnimationFrame(() => {
            if (editor.getEditingShapeId()) return
            if (editor.getCurrentToolId() !== 'select') return
            editor.setCurrentTool(ANNOTATION_TOOL_ID)
          })
        }
      },
      {
        source: 'all',
        scope: 'session'
      }
    )

    const unsubscribeAnnotationShapeSync = editor.store.listen(
      ({ changes }) => {
        if (isSyncingAnnotationShape) return

        const updates = []
        for (const [_previous, next] of Object.values(changes.updated)) {
          if (next?.typeName !== 'shape') continue
          if (next.type !== 'arrow') continue
          if (next.meta?.cowartAnnotationArrow !== true) continue

          const props = {}
          if (next.props?.color !== next.props?.labelColor) {
            props.labelColor = next.props.color
          }
          if (next.props?.labelPosition !== ANNOTATION_LABEL_POSITION) {
            props.labelPosition = ANNOTATION_LABEL_POSITION
          }

          if (Object.keys(props).length === 0) continue

          updates.push({
            id: next.id,
            type: 'arrow',
            props
          })
        }

        if (updates.length === 0) return

        isSyncingAnnotationShape = true
        try {
          editor.updateShapes(updates)
        } finally {
          isSyncingAnnotationShape = false
        }
      },
      {
        source: 'all',
        scope: 'document'
      }
    )

    return () => {
      window.clearTimeout(saveTimer)
      window.clearInterval(selectionStateTimer)
      window.clearInterval(viewStateTimer)
      window.clearInterval(canvasRefreshTimer)
      remoteLoadController?.abort()
      canvasEvents?.close()
      if (window.__cowartEditor === editor) {
        delete window.__cowartEditor
        delete window.__cowartSelection
        delete window.__cowartViewState
      }
      document.getElementById(SELECTION_STATE_ELEMENT_ID)?.remove()
      unsubscribe()
      unsubscribeAnnotationEditingToolLock()
      unsubscribeAnnotationShapeSync()
      syncViewState()
      saveCanvas()
    }
  }, [viewState])

  if (snapshot === undefined || viewState === undefined) {
    return (
      <main className="cowart-status" aria-live="polite">
        Loading canvas...
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="cowart-status" aria-live="polite">
        Canvas file could not be loaded.
      </main>
    )
  }

  return (
    <main className="cowart-canvas" aria-label="Cowart infinite canvas">
      <SkippedRecordsNotice records={skippedRecords} />
      <Tldraw
        snapshot={snapshot ?? undefined}
        assetUrls={cowartAssetUrls}
        assets={cowartTldrawAssetStore}
        inferDarkMode
        onMount={handleMount}
        overrides={cowartUiOverrides}
        components={cowartComponents}
        shapeUtils={cowartShapeUtils}
        tools={[CowartAnnotationTool]}
      />
    </main>
  )
}

function SkippedRecordsNotice({ records }) {
  const [isVisible, setIsVisible] = useState(false)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const recordsKey = records
    .map((record) => `${record.id}:${record.typeName ?? ''}:${record.type ?? ''}:${record.reason}`)
    .join('\n')

  useEffect(() => {
    if (!records.length) {
      setIsVisible(false)
      setIsDetailsOpen(false)
      return
    }

    setIsVisible(true)
    setIsDetailsOpen(false)
  }, [records.length, recordsKey])

  useEffect(() => {
    if (!records.length || !isVisible || isDetailsOpen) return undefined

    const noticeTimer = window.setTimeout(() => {
      setIsVisible(false)
    }, SKIPPED_RECORDS_NOTICE_AUTO_HIDE_MS)

    return () => window.clearTimeout(noticeTimer)
  }, [records.length, recordsKey, isVisible, isDetailsOpen])

  if (!records.length || !isVisible) return null

  return (
    <aside className="cowart-skipped-records" aria-live="polite">
      <strong>Skipped {records.length} invalid canvas record{records.length === 1 ? '' : 's'}.</strong>
      <span>Valid content was loaded.</span>
      <details open={isDetailsOpen} onToggle={(event) => setIsDetailsOpen(event.currentTarget.open)}>
        <summary>Details</summary>
        <ul>
          {records.slice(0, 8).map((record, index) => (
            <li key={`${record.id}:${index}`}>
              <code>{record.id}</code>
              {record.typeName ? ` ${record.typeName}` : ''}
              {record.type ? `/${record.type}` : ''}: {record.reason}
            </li>
          ))}
        </ul>
      </details>
    </aside>
  )
}
