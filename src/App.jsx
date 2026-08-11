import {
  ArrowDownToolbarItem,
  ArrowLeftToolbarItem,
  ArrowRightToolbarItem,
  ArrowShapeUtil,
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
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  DefaultStylePanel,
  DefaultStylePanelContent,
  DiamondToolbarItem,
  DrawToolbarItem,
  EllipseToolbarItem,
  EmbedShapeUtil,
  EraserToolbarItem,
  FrameToolbarItem,
  FrameShapeUtil,
  GeoShapeUtil,
  HandToolbarItem,
  HeartToolbarItem,
  HTMLContainer,
  HexagonToolbarItem,
  HighlightToolbarItem,
  LaserToolbarItem,
  LineToolbarItem,
  NoteToolbarItem,
  NoteShapeUtil,
  OvalToolbarItem,
  PathBuilder,
  RectangleToolbarItem,
  RhombusToolbarItem,
  SelectToolbarItem,
  StateNode,
  StarToolbarItem,
  TextToolbarItem,
  Tldraw,
  TldrawUiButton,
  TldrawUiButtonIcon,
  TldrawUiContextualToolbar,
  TldrawUiInput,
  TldrawUiToolbarButton,
  TriangleToolbarItem,
  XBoxToolbarItem,
  createShapeId,
  DEFAULT_EMBED_DEFINITIONS,
  onDragFromToolbarToCreateShape,
  renderPlaintextFromRichText,
  startEditingShapeWithRichText,
  toRichText,
  toDomPrecision,
  useEditor,
  useIsEditing,
  useTranslation,
  useUiEvents,
  useValue
} from 'tldraw'
import { AllSelection } from '@tiptap/pm/state'
import html2canvas from 'html2canvas'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileCode, Image as ImageIcon, LassoSelect, LockKeyhole, Play, X } from 'lucide-react'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import aiHtmlToolIconRaw from './assets/ai-html.svg?raw'
import aiImageToolIconRaw from './assets/ai-image.svg?raw'
import aiSlidesToolIconRaw from './assets/ai-slides.svg?raw'
import annotationToolIconRaw from './assets/tool-comment.svg?raw'
import {
  trackAnnotationCreated,
  trackCanvasOpened
} from './analytics.js'
import {
  collectAnnotationTargetShapeIds,
  expandBox,
  getAnnotationExportPixelRatio as getAnnotationEditExportPixelRatio,
  isAnnotationMarkShape
} from './annotationContext.js'
import { buildCanvasHtmlDocument, canvasExportFileName } from './canvasExportDocument.js'
import { buildCanvasPptxBase64 } from './canvasPptx.js'
import {
  IS_COWART_WIDGET_BUILD,
  copyCowartImageToClipboard,
  downloadCowartFile,
  hasCowartWidgetBridge,
  loadCowartCanvasState,
  readCowartPageAsset,
  refreshCowartCanvasSnapshot,
  saveCowartCanvasSnapshot,
  saveCowartReferenceImage,
  saveCowartSelectionState,
  saveCowartViewState,
  updateCowartHtmlDraft
} from './cowartClient.js'
import {
  describeSkippedRecord,
  isCanvasSnapshot,
  sanitizeCanvasSnapshotForTldraw
} from './canvasSnapshot.js'
import {
  COWART_FONT_SIZE_MAX,
  COWART_FONT_SIZE_MIN,
  COWART_FONT_SIZE_PRESETS,
  clampCowartFontSize,
  getCowartEffectiveFontSize,
  getCowartFontSizeOverride,
  getCowartNativeFontSize,
  isCowartTypographyShape,
  withCowartFontSizeMeta,
  withoutCowartFontSizeMeta
} from './cowartTypography.js'
import { cowartTldrawThemes, installCowartHandDrawnFontFaces } from './cowartTheme.js'
import { COWART_CARD_GEO } from './cowartGeoTypes.js'
import {
  imageContentFromDataUrl as dataUrlToImageContent,
  followUpSender,
  supportsMessageImages as supportsCowartMessageImages
} from './widgetMessaging.js'
import { CowartThinkingReviewToolbar } from './ThinkingReviewToolbar.jsx'
import { ExcalidrawCowartChrome } from './ExcalidrawWorkspace.jsx'
import {
  COWART_AGENT_LASSO_TOOL_ID,
  COWART_AGENT_LASSO_TOOL_LABEL,
  CowartAgentLassoTool
} from './agentLasso.js'
import { getCowartSelection, getCowartSelectionSnapshot } from './selectionContext.js'

installCowartHandDrawnFontFaces()

const SELECTION_STATE_ELEMENT_ID = 'cowart-selection-state'
const PAGE_ASSETS_ROUTE = '/page-assets/'
const GLOBAL_ASSETS_ROUTE = '/assets/'
const AI_IMAGE_TOOL_ID = 'ai-image'
const AI_IMAGE_HOLDER_LABEL = 'AI 图片'
const AI_DRAFT_TOOL_ID = 'ai-draft'
const AI_DRAFT_HOLDER_LABEL = 'AI HTML'
const AI_SLIDES_TOOL_ID = 'ai-slides'
const AI_SLIDES_LABEL = 'AI Slides'
const AI_SLIDES_PRESENT_LABEL = '演示 Slides'
const COWART_EXPORT_LABEL = '导出'
const COWART_EXPORT_IMAGE_LABEL = '导出为图片'
const COWART_EXPORT_HTML_LABEL = '导出为 HTML'
const COWART_CANVAS_EXPORT_PADDING = 48
const COWART_CANVAS_EXPORT_MAX_DIMENSION = 4096
const COWART_CANVAS_EXPORT_MAX_PIXELS = 16_000_000
const COWART_CANVAS_EXPORT_HTML_CAPTURE_RATIO = 1.5
const COWART_CANVAS_DETAIL_SKIP_TYPES = new Set(['arrow', 'draw', 'highlight', 'line'])
const AI_SLIDES_GAP = 32
const COWART_OPEN_SLIDES_EVENT = 'cowart:open-slides'
const AI_IMAGE_HOLDER_DEFAULT_W = 512
const AI_IMAGE_HOLDER_DEFAULT_H = 683
const AI_DRAFT_HOLDER_DEFAULT_W = 1024
const AI_DRAFT_HOLDER_DEFAULT_H = 576
const AI_SLIDES_PADDING = 12
const AI_SLIDES_DEFAULT_W = AI_DRAFT_HOLDER_DEFAULT_W + AI_SLIDES_PADDING * 2
const AI_SLIDES_DEFAULT_H = AI_DRAFT_HOLDER_DEFAULT_H + AI_SLIDES_PADDING * 2
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
const COWART_HTML_DRAFT_URL_ORIGIN = 'http://cowart.local'
const COWART_HTML_DRAFT_EMBED_TYPE = 'cowart_html_draft'
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
const ANNOTATION_HTML_TOOL_LABEL = '按标注生成 Html'
const ANNOTATION_EDIT_PROMPT = [
  '[@cowart-thinking-canvas](plugin://cowart-thinking-canvas@cowart-thinking-github) 按标注修改',
  '',
  '请根据这张 Cowart 截图里的标注修改当前选中的图片：',
  '- 截图包含当前图片，以及连到图片里或图片附近的标注箭头和标注文字。',
  '- 请把标注文字当作修改要求，生成一张新的干净图片。',
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏带进最终图片。',
  '- 保留原图和原标注不动，把新图放到原图旁边。'
].join('\n')
const AI_HTML_LOCAL_ASSET_PROMPT_LINES = [
  '- HTML 中不要引用 http:// 或 https:// 远程图片；Yogurt AI widget 的 CSP 不允许 HTML iframe 直接加载这些资源。',
  '- 如果 HTML 需要图片，先确定目标 shape 所在的 page，再把图片下载到当前项目的 canvas/pages/<page-id-without-page-prefix>/assets/ 目录。',
  '- HTML 内必须使用 /page-assets/<page-id-without-page-prefix>/<filename> 引用这些本地图片；不要使用 file:// URL 或绝对文件路径。',
  '- Yogurt AI 会在将 HTML 放入 iframe 前，通过 read_cowart_page_asset 把 /page-assets/ 图片转换为 data: URL。'
]
const ANNOTATION_HTML_PROMPT = [
  '[@cowart-thinking-canvas](plugin://cowart-thinking-canvas@cowart-thinking-github) 按标注生成 AI HTML',
  '',
  '请根据这张 Cowart 截图里的当前图片和周围标注，生成一个新的单文件 HTML 草稿：',
  '- 截图包含当前选中的图片，以及连到图片里或图片附近的标注箭头和标注文字。',
  '- 请把当前图片作为主体、构图和视觉风格参考，把标注文字作为 HTML 的修改或生成要求。',
  '- 这不是图片生成任务：不要调用 imagegen，不要调用 insert_cowart_image。',
  '- 请生成完整可运行的 HTML 文档，CSS 和 JS 尽量内联，适合直接放进 iframe 预览。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES,
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏写进 HTML。',
  '- 保留原图片和原标注不动，把新 HTML 草稿放到原图片右侧。'
].join('\n')
const ANNOTATION_EDIT_EXPORT_PADDING = 32
const ANNOTATION_EDIT_STATUS_RESET_MS = 2200
const HTML_DRAFT_CAPTURE_DELAY_MS = 2000
const HTML_DRAFT_ASSET_RETRY_DELAYS_MS = [0, 200, 600, 1400]
const HTML_DRAFT_DOM_EDIT_LABEL = '编辑文本'
const HTML_DRAFT_DOM_EDIT_DONE_LABEL = '完成编辑'
const HTML_DRAFT_ANNOTATION_EDIT_LABEL = '按标注修改'
const HTML_DRAFT_ANNOTATION_IMAGE_LABEL = '按标注生图'
const HTML_DRAFT_ANNOTATION_EDIT_PROMPT = [
  '[@cowart-thinking-canvas](plugin://cowart-thinking-canvas@cowart-thinking-github) 按标注修改 AI HTML',
  '',
  '请根据这张 Cowart 截图里的标注修改当前选中的 HTML 草稿：',
  '- 截图包含当前 HTML 草稿，以及草稿周围的标注箭头和标注文字。',
  '- 请把标注文字当作修改要求，并以现有 HTML 源文件为基础修改。',
  '- 不要生成 bitmap，不要调用 imagegen，也不要调用 insert_cowart_image。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES,
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏写进 HTML。',
  '- 保留原 HTML 草稿和原标注不动，创建一个修改后的新 HTML 草稿并放到原草稿右侧。',
  '- 不要覆盖原草稿的 HTML 文件、shape 或画布记录。'
].join('\n')
const HTML_DRAFT_ANNOTATION_IMAGE_PROMPT = [
  '[@cowart-thinking-canvas](plugin://cowart-thinking-canvas@cowart-thinking-github) 按标注生图',
  '',
  '请使用内置 imagegen skill，根据这张 Cowart 截图里的 HTML 草稿和标注生成一张新的干净位图：',
  '- 截图包含当前 HTML 草稿，以及草稿周围的标注箭头和标注文字。',
  '- 请把标注文字当作生成要求，并保留草稿的主体、构图和纵横比，除非标注明确要求改变。',
  '- 不要修改 HTML，不要调用 insert_cowart_html_draft。',
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏带进最终图片。',
  '- 保留原 HTML 草稿和原标注不动，把生成的图片放到草稿右侧。'
].join('\n')
const AI_IMAGE_GENERATION_PROMPT_PREFIX = [
  '[@cowart-thinking-canvas](plugin://cowart-thinking-canvas@cowart-thinking-github) 生成图片',
  '',
  '请根据下面的 prompt 生成一张图片，并替换当前选中的 Yogurt AI 图片框；最终画布里应留下普通图片形状，不保留 AI 图片框容器。',
  '默认生成一张；如果用户在 prompt 中明确要求多张图片，则用户要求的数量优先于上面的单数措辞。',
  '多张时必须分别生成对应数量的独立 bitmap，并作为多个普通图片形状从左到右平铺在画布上；第一张替换当前 AI 图片框，后续图片放在上一张图片右侧。',
  '插入多张图片时，第一张按默认流程替换 AI 图片框；之后每次使用上一张插入结果返回的 shapeId 作为 anchorShapeId，并设置 replaceAiImageHolder: false、matchAnchor: false、placement: "right"。',
  '不要把多张图片合成一张拼图、画册或带分页的单一产物。',
  '如果附带一张或多张参考图，请把参考图作为视觉参考；不要把参考图文件名或任何界面元素画进最终图片。',
  '不需要选择生图模型，使用 Codex 当前可用的图片生成能力。'
].join('\n')
const AI_DRAFT_GENERATION_PROMPT_PREFIX = [
  '[@cowart-thinking-canvas](plugin://cowart-thinking-canvas@cowart-thinking-github) 生成 AI HTML',
  '',
  '请根据下面的 prompt 生成一个单文件 HTML 草稿，并把它嵌入当前选中的 Yogurt AI HTML 框。',
  '默认生成一个 HTML；如果用户在 prompt 中明确要求多个 HTML、多个方案或多张页面，则用户要求的数量优先于上面的单数措辞。',
  '多个 HTML 必须分别生成为对应数量的完整、独立、可运行的单文件 HTML，并作为多个 HTML embed 从左到右平铺在画布上；第一个替换当前 AI HTML 框，后续 HTML 放在上一个 HTML 右侧。',
  '不要在一个 AI HTML 里制作多页、分页、选项卡、轮播或幻灯片来代替多个独立 HTML；只有用户明确要求 AI Slides 时才使用多页 Slides 语义。',
  '这不是图片生成任务：不要生成 bitmap，不要调用 insert_cowart_image。',
  '请生成完整可运行的 HTML 文档，CSS 和 JS 尽量内联，适合直接放进 iframe 预览。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES,
  '完成后调用 Cowart MCP 工具 insert_cowart_html_draft，把 htmlContent 写入当前 page 的 canvas/pages/<page-id>/assets/，并替换对应 AI HTML 框为 HTML embed。'
].join('\n')
const AI_SLIDES_GENERATION_PROMPT_PREFIX = [
  '[@cowart-thinking-canvas](plugin://cowart-thinking-canvas@cowart-thinking-github) 生成 AI Slides',
  '',
  '请根据下面的 prompt 生成一套视觉与叙事连贯的 AI Slides。',
  '每一页都必须是完整、独立、可运行的单文件 HTML；CSS 和 JS 尽量内联。',
  '每页画布固定为 1024 x 576（16:9），不要生成 bitmap，不要调用 insert_cowart_image。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES
].join('\n')
const AI_SLIDES_ANNOTATION_EDIT_PROMPT = [
  '[@cowart-thinking-canvas](plugin://cowart-thinking-canvas@cowart-thinking-github) 按标注修改 AI Slides',
  '',
  '请根据 Cowart 截图中的原 AI Slides 和周围标注，生成一套修改后的新 Slides。',
  '原 AI Slides 和标注必须保持不动；新的目标 AI Slides 已经创建在原 Slides 下方，请只把修改后的页面加入新 Slides。',
  '每一页都必须是完整、独立、可运行的单文件 HTML；CSS 和 JS 尽量内联。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES,
  '每页画布固定为 1024 x 576（16:9），不要生成 bitmap，不要调用 insert_cowart_image。'
].join('\n')
const aiImageToolIconSvg = aiImageToolIconRaw.replaceAll('black', 'currentColor')
const aiImageToolIcon = (
  <div
    aria-hidden="true"
    className="cowart-ai-frame-tool-icon"
    dangerouslySetInnerHTML={{ __html: aiImageToolIconSvg }}
  />
)
const aiHtmlToolIconSvg = aiHtmlToolIconRaw.replaceAll('black', 'currentColor')
const aiHtmlToolIcon = (
  <div
    aria-hidden="true"
    className="cowart-ai-frame-tool-icon"
    dangerouslySetInnerHTML={{ __html: aiHtmlToolIconSvg }}
  />
)
const aiSlidesToolIconSvg = aiSlidesToolIconRaw.replaceAll('black', 'currentColor')
const aiSlidesToolIcon = (
  <div
    aria-hidden="true"
    className="cowart-ai-frame-tool-icon"
    dangerouslySetInnerHTML={{ __html: aiSlidesToolIconSvg }}
  />
)
const annotationToolIconSvg = annotationToolIconRaw.replaceAll('black', 'currentColor')
const annotationToolIcon = (
  <div
    className="cowart-annotation-tool-icon"
    dangerouslySetInnerHTML={{ __html: annotationToolIconSvg }}
  />
)
const agentLassoToolIcon = (
  <LassoSelect aria-hidden="true" className="cowart-agent-lasso-tool-icon" size={19} strokeWidth={1.8} />
)
const iconSvgSources = import.meta.glob(
  '../node_modules/@tldraw/assets/icons/icon/*.svg',
  { eager: true, query: '?raw', import: 'default' }
)
const cowartAssetUrls = buildCowartAssetUrls()
const cowartAssetObjectUrlCache = new Map()
const cowartAssetSourceKeys = new Map()
const cowartHtmlDraftIframes = new Map()
const cowartHtmlDraftDomEditSessions = new Map()
const cowartPendingSlidesPastes = new WeakMap()
const cowartCopiedContent = new WeakMap()

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
  return { icons }
}

function isCowartLocalAssetUrl(src) {
  return typeof src === 'string' && (src.startsWith(PAGE_ASSETS_ROUTE) || src.startsWith(GLOBAL_ASSETS_ROUTE))
}

const COWART_HTML_DRAFT_LOCAL_IMAGE_PATTERN =
  /(?:https?:\/\/cowart\.local)?(\/(?:page-assets|assets)\/[^"'()\s<>?#]+\.(?:apng|avif|gif|jpe?g|png|svg|webp))(?:[?#][^"'()\s<>]*)?/gi

async function hydrateCowartHtmlDraftLocalImages(htmlContent) {
  if (typeof htmlContent !== 'string' || !htmlContent || !hasCowartWidgetBridge()) return htmlContent

  const references = new Map()
  for (const match of htmlContent.matchAll(COWART_HTML_DRAFT_LOCAL_IMAGE_PATTERN)) {
    references.set(match[0], match[1])
  }
  if (!references.size) return htmlContent

  const replacements = await Promise.all(
    Array.from(references.entries()).map(async ([reference, assetUrl]) => {
      try {
        const asset = await readCowartPageAsset(assetUrl)
        if (!asset?.dataBase64 || !asset?.mimeType?.startsWith('image/')) return null
        return [reference, `data:${asset.mimeType};base64,${asset.dataBase64}`]
      } catch (error) {
        console.warn(`Cowart could not hydrate HTML draft image ${assetUrl}.`, error)
        return null
      }
    })
  )

  return replacements.filter(Boolean).reduce(
    (result, [reference, dataUrl]) => result.split(reference).join(dataUrl),
    htmlContent
  )
}

function isCowartHtmlDraftAssetUrl(src) {
  return typeof src === 'string' && src.startsWith(PAGE_ASSETS_ROUTE) && /\.html?(?:$|[?#])/i.test(src)
}

function isCowartHtmlDraftDataUrl(src) {
  return typeof src === 'string' && /^data:text\/html(?:;[^,]*)?,/i.test(src)
}

function cowartHtmlDraftAssetUrlFromVirtualUrl(src) {
  if (isCowartHtmlDraftAssetUrl(src)) return src
  if (typeof src !== 'string') return null

  try {
    const url = new URL(src)
    if (url.origin !== COWART_HTML_DRAFT_URL_ORIGIN) return null
    const assetUrl = `${url.pathname}${url.search}${url.hash}`
    return isCowartHtmlDraftAssetUrl(assetUrl) ? assetUrl : null
  } catch (_error) {
    return null
  }
}

function cowartHtmlDraftVirtualUrl(assetUrl) {
  const normalizedAssetUrl = cowartHtmlDraftAssetUrlFromVirtualUrl(assetUrl)
  return normalizedAssetUrl ? `${COWART_HTML_DRAFT_URL_ORIGIN}${normalizedAssetUrl}` : ''
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

function getAiDraftHolderMeta() {
  return {
    cowartAiDraftHolder: true,
    cowartAiDraftHolderVersion: 1
  }
}

function getAiSlidesMeta() {
  return {
    cowartAiSlides: true,
    cowartAiSlidesVersion: 1,
    cowartAiSlidesFlow: 'horizontal',
    cowartAiSlidesGap: AI_SLIDES_GAP,
    cowartAiSlidesPadding: AI_SLIDES_PADDING
  }
}

function isAiImageHolderShape(shape) {
  return shape?.type === 'frame' && shape.meta?.cowartAiImageHolder === true
}

function isAiDraftHolderShape(shape) {
  return shape?.type === 'frame' && shape.meta?.cowartAiDraftHolder === true
}

function isAiSlidesShape(shape) {
  return shape?.type === 'frame' && shape.meta?.cowartAiSlides === true
}

function isCowartAiHolderShape(shape) {
  return isAiImageHolderShape(shape) || isAiDraftHolderShape(shape)
}

function isAiSlidesItemShape(shape) {
  return isImageShape(shape) || isCowartHtmlDraftEmbedShape(shape)
}

function isCowartHtmlDraftEmbedShape(shape) {
  if (shape?.type !== 'embed') return false
  if (shape.meta?.cowartHtmlDraft === true) return true
  return Boolean(
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape.props?.url) ||
      isCowartHtmlDraftDataUrl(shape.props?.url)
  )
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
  return isCowartAiHolderShape(shape) && shape.meta?.cowartAiAspectLocked === true
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

function createAiDraftHolderShape(editor, id, shapeOverrides = {}) {
  const scale = editor.getResizeScaleFactor()
  const { meta, props, ...shapeRecordOverrides } = shapeOverrides
  const { scale: _scale, ...frameProps } = props ?? {}

  return editor.createShape({
    ...shapeRecordOverrides,
    id,
    type: 'frame',
    meta: {
      ...getAiDraftHolderMeta(),
      ...meta
    },
    props: {
      w: AI_DRAFT_HOLDER_DEFAULT_W * scale,
      h: AI_DRAFT_HOLDER_DEFAULT_H * scale,
      name: AI_DRAFT_HOLDER_LABEL,
      color: 'blue',
      ...frameProps
    }
  })
}

function createAiDraftHolderAtViewportCenter(editor) {
  const scale = editor.getResizeScaleFactor()
  const w = AI_DRAFT_HOLDER_DEFAULT_W * scale
  const h = AI_DRAFT_HOLDER_DEFAULT_H * scale
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()

  createAiDraftHolderShape(editor, id, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h }
  })
  editor.select(id)
  editor.setCurrentTool('select.idle')
}

function createAiSlidesShape(editor, id, shapeOverrides = {}) {
  const scale = editor.getResizeScaleFactor()
  const { meta, props, ...shapeRecordOverrides } = shapeOverrides
  const { scale: _scale, ...frameProps } = props ?? {}

  return editor.createShape({
    ...shapeRecordOverrides,
    id,
    type: 'frame',
    meta: {
      ...getAiSlidesMeta(),
      ...meta
    },
    props: {
      w: AI_SLIDES_DEFAULT_W * scale,
      h: AI_SLIDES_DEFAULT_H * scale,
      name: AI_SLIDES_LABEL,
      color: 'blue',
      ...frameProps
    }
  })
}

function createAiSlidesAtViewportCenter(editor) {
  const scale = editor.getResizeScaleFactor()
  const w = AI_SLIDES_DEFAULT_W * scale
  const h = AI_SLIDES_DEFAULT_H * scale
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()

  createAiSlidesShape(editor, id, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h }
  })
  editor.select(id)
  editor.setCurrentTool('select.idle')
}

function getAiSlidesItems(editor, slidesShapeId) {
  return editor
    .getSortedChildIdsForParent(slidesShapeId)
    .map((shapeId) => editor.getShape(shapeId))
    .filter(isAiSlidesItemShape)
    .sort((a, b) => {
      const aCenter = Number(a.x) + Number(a.props?.w || 0) / 2
      const bCenter = Number(b.x) + Number(b.props?.w || 0) / 2
      return aCenter - bCenter
    })
}

function layoutAiSlides(editor, slidesShapeId) {
  const slidesShape = editor.getShape(slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) return false

  const items = getAiSlidesItems(editor, slidesShapeId)
  if (!items.length) return false

  const padding = Number(slidesShape.meta?.cowartAiSlidesPadding) || AI_SLIDES_PADDING
  const gap = Number(slidesShape.meta?.cowartAiSlidesGap) || AI_SLIDES_GAP
  let cursorX = padding
  let maxHeight = 0
  const updates = []

  for (const item of items) {
    const width = Math.max(1, Number(item.props?.w) || 1)
    const height = Math.max(1, Number(item.props?.h) || 1)
    maxHeight = Math.max(maxHeight, height)
    if (Math.abs(item.x - cursorX) > 0.01 || Math.abs(item.y - padding) > 0.01 || item.rotation !== 0) {
      updates.push({ id: item.id, type: item.type, x: cursorX, y: padding, rotation: 0 })
    }
    cursorX += width + gap
  }

  const nextWidth = Math.max(AI_SLIDES_DEFAULT_W, cursorX - gap + padding)
  const nextHeight = Math.max(AI_SLIDES_DEFAULT_H, maxHeight + padding * 2)
  if (
    Math.abs(Number(slidesShape.props.w) - nextWidth) > 0.01 ||
    Math.abs(Number(slidesShape.props.h) - nextHeight) > 0.01
  ) {
    updates.push({
      id: slidesShape.id,
      type: 'frame',
      props: { w: nextWidth, h: nextHeight }
    })
  }

  if (!updates.length) return false
  editor.updateShapes(updates)
  return true
}

function layoutAllAiSlides(editor) {
  for (const shape of editor.getCurrentPageShapes()) {
    if (isAiSlidesShape(shape)) layoutAiSlides(editor, shape.id)
  }
}

function adoptGeneratedAiSlidesItems(editor) {
  const itemsBySlides = new Map()
  for (const shape of editor.getCurrentPageShapes()) {
    if (!isAiSlidesItemShape(shape)) continue
    const slidesShapeId = shape.meta?.cowartAiSlidesParentShapeId
    const slidesShape = slidesShapeId ? editor.getShape(slidesShapeId) : null
    if (!isAiSlidesShape(slidesShape) || shape.parentId === slidesShapeId) continue

    const itemIds = itemsBySlides.get(slidesShapeId) ?? []
    itemIds.push(shape.id)
    itemsBySlides.set(slidesShapeId, itemIds)
  }

  for (const [slidesShapeId, itemIds] of itemsBySlides) {
    editor.reparentShapes(itemIds, slidesShapeId)
  }
}

function normalizeAiDraftHolderLabels(editor) {
  const updates = editor
    .getCurrentPageShapes()
    .filter((shape) => isAiDraftHolderShape(shape) && shape.props?.name !== AI_DRAFT_HOLDER_LABEL)
    .map((shape) => ({
      id: shape.id,
      type: shape.type,
      props: { name: AI_DRAFT_HOLDER_LABEL }
    }))

  if (updates.length) editor.updateShapes(updates)
}

function copySelectedCowartContent(editor, event) {
  if (!event.clipboardData || editor.getEditingShapeId() !== null) return false

  const content = editor.getContentFromCurrentPage(editor.getSelectedShapeIds())
  if (!content) return false

  const copiedContent = structuredClone(content)
  cowartCopiedContent.set(editor, copiedContent)

  const clipboardPayload = JSON.stringify({
    type: 'application/tldraw',
    kind: 'content',
    version: 2,
    data: copiedContent
  })
  event.clipboardData.setData('text/html', `<div data-tldraw>${clipboardPayload}</div>`)
  event.clipboardData.setData('text/plain', ' ')
  event.preventDefault()
  event.stopImmediatePropagation()
  return true
}

function rememberAiSlidesPasteTarget(editor) {
  const slidesShape = editor.getOnlySelectedShape()
  if (!isAiSlidesShape(slidesShape)) {
    cowartPendingSlidesPastes.delete(editor)
    return
  }

  cowartPendingSlidesPastes.set(editor, {
    slidesShapeId: slidesShape.id,
    existingShapeIds: new Set(editor.getCurrentPageShapeIds()),
    expiresAt: Date.now() + 5000
  })
}

function getPendingAiSlidesPaste(editor) {
  const pendingPaste = cowartPendingSlidesPastes.get(editor)
  if (!pendingPaste) return null
  if (pendingPaste.expiresAt >= Date.now()) return pendingPaste
  cowartPendingSlidesPastes.delete(editor)
  return null
}

function preparePastedItemForAiSlides(editor, shape, source) {
  if (source !== 'user' || !isAiSlidesItemShape(shape)) return shape

  const pendingPaste = getPendingAiSlidesPaste(editor)
  if (!pendingPaste || pendingPaste.existingShapeIds.has(shape.id)) return shape

  const slidesShape = editor.getShape(pendingPaste.slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) {
    cowartPendingSlidesPastes.delete(editor)
    return shape
  }

  return {
    ...shape,
    parentId: slidesShape.id
  }
}

function movePastedItemsIntoAiSlides(editor) {
  const pendingPaste = getPendingAiSlidesPaste(editor)
  if (!pendingPaste) return false

  const slidesShape = editor.getShape(pendingPaste.slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) {
    cowartPendingSlidesPastes.delete(editor)
    return false
  }

  const pastedItems = editor.getSelectedShapes().filter((shape) =>
    isAiSlidesItemShape(shape) &&
    !pendingPaste.existingShapeIds.has(shape.id)
  )
  if (!pastedItems.length) return false

  editor.run(
    () => {
      const itemsToReparent = pastedItems.filter((shape) => shape.parentId !== slidesShape.id)
      if (itemsToReparent.length) {
        editor.reparentShapes(itemsToReparent.map((shape) => shape.id), slidesShape.id)
      }
      layoutAiSlides(editor, slidesShape.id)
    },
    { history: 'ignore' }
  )
  cowartPendingSlidesPastes.delete(editor)
  return true
}

const cowartTldrawOptions = {
  onBeforeCopyToClipboard({ editor, content }) {
    cowartCopiedContent.set(editor, structuredClone(content))
  },
  onBeforePasteFromClipboard({ editor }) {
    rememberAiSlidesPasteTarget(editor)
  },
  onClipboardPasteRaw({ editor }) {
    const slidesShape = editor.getOnlySelectedShape()
    const copiedContent = cowartCopiedContent.get(editor)
    if (!isAiSlidesShape(slidesShape) || !copiedContent) return

    rememberAiSlidesPasteTarget(editor)
    editor.markHistoryStoppingPoint('paste')
    editor.putContentOntoCurrentPage(structuredClone(copiedContent), { select: true })
    return false
  }
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

function collectAnnotationEditShapeIds(editor, imageShapeId) {
  return collectAnnotationTargetShapeIds(
    editor,
    imageShapeId,
    isImageShape,
    '请选择一张图片后再按标注修改。'
  )
}

function collectHtmlDraftAnnotationShapeIds(editor, draftShapeId) {
  return collectAnnotationTargetShapeIds(
    editor,
    draftShapeId,
    isCowartHtmlDraftEmbedShape,
    '请选择一个已生成 HTML 的 AI HTML。'
  )
}

function collectAiSlidesAnnotationShapeIds(editor, slidesShapeId) {
  return collectAnnotationTargetShapeIds(
    editor,
    slidesShapeId,
    isAiSlidesShape,
    '请选择一个已有内容的 AI Slides。'
  )
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

function buildAnnotationHtmlPrompt({ imageShape, shapeIds, exportWidth, exportHeight, screenshotAsset }) {
  const targetWidth = Math.round(Number(imageShape.props?.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const targetHeight = Math.round(Number(imageShape.props?.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  const ratio = targetHeight ? targetWidth / targetHeight : 1
  const annotationCount = Math.max(0, shapeIds.length - 1)
  return [
    ANNOTATION_HTML_PROMPT,
    '',
    `Cowart source image shape: ${imageShape.id}`,
    `Target canvas HTML size: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${targetWidth}:${targetHeight} (${ratio.toFixed(3)} width/height).`,
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${Math.round(exportWidth)}x${Math.round(exportHeight)}`,
    ...(screenshotAsset?.assetPath
      ? [
          `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
          'Use this local screenshot as the authoritative visual reference and annotation brief.'
        ]
      : []),
    '',
    'Required completion step:',
    `- Call insert_cowart_html_draft with anchorShapeId: "${imageShape.id}", replaceDraftHolder: false, placement: "right", margin: 40, matchAnchor: true, displayWidth: ${targetWidth}, and displayHeight: ${targetHeight}.`,
    '- Pass the final complete HTML document as htmlContent.',
    '- Use a new short .html fileName that describes the result.',
    '- Do not pass draftShapeId for the source image and do not update or replace any existing shape.',
    '- Set shapeMeta.cowartGeneratedFromImageAnnotationHtml to true.',
    '- The returned shapeId must be a new HTML draft shape placed to the right of the source image.'
  ].join('\n')
}

function annotationEditScreenshotFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `annotation-edit-${timestamp}.png`
}

function annotationHtmlScreenshotFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `image-annotation-html-${timestamp}.png`
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
    throw new Error('当前 Yogurt AI 画布没有可用的 Codex MCP 消息桥。')
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

  return sender(
    { prompt, content },
    { promptType: 'annotation_edit', hasReference: true }
  )
}

async function sendAnnotationHtmlRequest(editor, imageShapeId) {
  const imageShape = editor.getShape(imageShapeId)
  if (!isImageShape(imageShape)) throw new Error('请选择一张图片后再按标注生成 Html。')

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
    fileName: annotationHtmlScreenshotFileName(),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const prompt = buildAnnotationHtmlPrompt({
    imageShape,
    shapeIds,
    exportWidth: exportResult.width,
    exportHeight: exportResult.height,
    screenshotAsset
  })
  const sender = followUpSender()
  if (!sender) throw new Error('当前 Yogurt AI 画布没有可用的 Codex MCP 消息桥。')

  const content = [{ type: 'text', text: prompt }]
  if (supportsCowartMessageImages()) {
    content.push(
      dataUrlToImageContent(exportResult.url, {
        cowartAnnotationHtml: true,
        cowartSourceImageShapeId: imageShapeId,
        cowartIncludedShapeIds: shapeIds,
        cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
        cowartAnnotationScreenshotFileName: screenshotAsset.fileName || null
      })
    )
  }

  return sender(
    { prompt, content },
    { promptType: 'annotation_html', aiType: 'html', hasReference: true }
  )
}

async function waitForHtmlDraftDocument(shapeId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const iframe = cowartHtmlDraftIframes.get(shapeId)
    try {
      const iframeDocument = iframe?.contentDocument
      if (iframeDocument?.documentElement && iframeDocument.readyState !== 'loading') {
        return iframeDocument
      }
    } catch (_error) {
      // The iframe is briefly cross-origin while its same-origin blob URL is being prepared.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }

  throw new Error('HTML 草稿仍在加载，请稍后重试。')
}

const COWART_DOM_EDITOR_STYLE_ID = 'cowart-dom-editor-style'
const COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE = 'data-cowart-dom-editor-active'
const COWART_DOM_EDITOR_HOVER_ATTRIBUTE = 'data-cowart-dom-editor-hover'
const COWART_DOM_EDITOR_SELECTED_ATTRIBUTE = 'data-cowart-dom-editor-selected'
const COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE = 'data-cowart-dom-editor-editable'
const COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE =
  'data-cowart-dom-editor-added-contenteditable'

function cowartHtmlDraftDataUrl(htmlContent) {
  const bytes = new TextEncoder().encode(String(htmlContent || ''))
  const chunks = []
  const chunkSize = 8192
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return `data:text/html;base64,${window.btoa(chunks.join(''))}`
}

function serializeHtmlDoctype(doctype) {
  if (!doctype) return '<!doctype html>'
  let result = `<!DOCTYPE ${doctype.name}`
  if (doctype.publicId) result += ` PUBLIC "${doctype.publicId}"`
  if (doctype.systemId) result += doctype.publicId ? ` "${doctype.systemId}"` : ` SYSTEM "${doctype.systemId}"`
  return `${result}>`
}

function serializeCowartHtmlDraftDocument(iframeDocument) {
  const root = iframeDocument.documentElement.cloneNode(true)
  root.removeAttribute(COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE)
  root.querySelector(`#${COWART_DOM_EDITOR_STYLE_ID}`)?.remove()
  for (const element of root.querySelectorAll(
    `[${COWART_DOM_EDITOR_HOVER_ATTRIBUTE}],` +
      `[${COWART_DOM_EDITOR_SELECTED_ATTRIBUTE}],` +
      `[${COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE}],` +
      `[${COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE}]`
  )) {
    element.removeAttribute(COWART_DOM_EDITOR_HOVER_ATTRIBUTE)
    element.removeAttribute(COWART_DOM_EDITOR_SELECTED_ATTRIBUTE)
    element.removeAttribute(COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE)
    if (element.hasAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE)) {
      element.removeAttribute('contenteditable')
      element.removeAttribute('spellcheck')
      element.removeAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE)
    }
  }
  return `${serializeHtmlDoctype(iframeDocument.doctype)}\n${root.outerHTML}`
}

function isCowartDomTextElement(element) {
  if (!element || ['HTML', 'BODY', 'SCRIPT', 'STYLE', 'SVG', 'CANVAS', 'IMG', 'VIDEO'].includes(element.tagName)) {
    return false
  }
  if (!element.textContent?.trim()) return false
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === window.Node.TEXT_NODE && node.textContent?.trim()
  )
}

function cowartDomSelectionTarget(target, iframeDocument) {
  const ElementClass = iframeDocument.defaultView?.Element
  if (!ElementClass || !(target instanceof ElementClass)) return null
  if (target.closest('script, style, link, meta, title, noscript')) return null
  return target.closest('svg') || target
}

function placeCowartDomCaret(iframeDocument, element, clientX, clientY) {
  const selection = iframeDocument.getSelection()
  if (!selection) return

  let range = iframeDocument.caretRangeFromPoint?.(clientX, clientY) || null
  if (!range || !element.contains(range.startContainer)) {
    range = iframeDocument.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

function captureCowartDomTextSelection(iframeDocument) {
  const selection = iframeDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
    ranges: Array.from({ length: selection.rangeCount }, (_, index) =>
      selection.getRangeAt(index).cloneRange()
    )
  }
}

function restoreCowartDomTextSelection(iframeDocument, selectionSnapshot) {
  if (!selectionSnapshot) return false
  const selection = iframeDocument.getSelection()
  if (!selection) return false

  selection.removeAllRanges()
  if (
    typeof selection.setBaseAndExtent === 'function' &&
    selectionSnapshot.anchorNode?.isConnected &&
    selectionSnapshot.focusNode?.isConnected
  ) {
    selection.setBaseAndExtent(
      selectionSnapshot.anchorNode,
      selectionSnapshot.anchorOffset,
      selectionSnapshot.focusNode,
      selectionSnapshot.focusOffset
    )
    return true
  }

  for (const range of selectionSnapshot.ranges) selection.addRange(range)
  return selection.rangeCount > 0 && !selection.isCollapsed
}

function createCowartHtmlDraftDomEditorSession(iframeDocument, { onSave, onRequestExit }) {
  const style = iframeDocument.createElement('style')
  style.id = COWART_DOM_EDITOR_STYLE_ID
  style.textContent = `
    [${COWART_DOM_EDITOR_HOVER_ATTRIBUTE}]:not([${COWART_DOM_EDITOR_SELECTED_ATTRIBUTE}]) {
      outline: 1px dashed #2f80ed !important;
      outline-offset: 2px !important;
    }
    [${COWART_DOM_EDITOR_SELECTED_ATTRIBUTE}] {
      outline: 2px solid #2f80ed !important;
      outline-offset: 2px !important;
    }
    [${COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE}] {
      cursor: text !important;
    }
  `
  iframeDocument.head?.append(style)
  iframeDocument.documentElement.setAttribute(COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE, 'true')

  let selectedElement = null
  let hoveredElement = null
  let revision = 0
  let savedRevision = 0
  let savePromise = null

  function clearHoveredElement() {
    hoveredElement?.removeAttribute(COWART_DOM_EDITOR_HOVER_ATTRIBUTE)
    hoveredElement = null
  }

  function clearSelectedElement() {
    if (!selectedElement) return
    selectedElement.removeAttribute(COWART_DOM_EDITOR_SELECTED_ATTRIBUTE)
    selectedElement.removeAttribute(COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE)
    if (selectedElement.hasAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE)) {
      selectedElement.removeAttribute('contenteditable')
      selectedElement.removeAttribute('spellcheck')
      selectedElement.removeAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE)
    }
    selectedElement = null
  }

  function selectElement(element, event) {
    const textSelection = captureCowartDomTextSelection(iframeDocument)
    if (selectedElement !== element) clearSelectedElement()
    selectedElement = element
    selectedElement.setAttribute(COWART_DOM_EDITOR_SELECTED_ATTRIBUTE, 'true')

    if (!isCowartDomTextElement(selectedElement)) return
    selectedElement.setAttribute(COWART_DOM_EDITOR_EDITABLE_ATTRIBUTE, 'true')
    if (!selectedElement.hasAttribute('contenteditable')) {
      selectedElement.setAttribute('contenteditable', 'plaintext-only')
      selectedElement.setAttribute('spellcheck', 'false')
      selectedElement.setAttribute(COWART_DOM_EDITOR_ADDED_CONTENTEDITABLE_ATTRIBUTE, 'true')
    }
    selectedElement.focus({ preventScroll: true })
    if (!restoreCowartDomTextSelection(iframeDocument, textSelection)) {
      placeCowartDomCaret(iframeDocument, selectedElement, event.clientX, event.clientY)
    }
  }

  function handlePointerOver(event) {
    const nextElement = cowartDomSelectionTarget(event.target, iframeDocument)
    if (!nextElement || nextElement === selectedElement || nextElement === hoveredElement) return
    clearHoveredElement()
    hoveredElement = nextElement
    hoveredElement.setAttribute(COWART_DOM_EDITOR_HOVER_ATTRIBUTE, 'true')
  }

  function handlePointerOut(event) {
    if (hoveredElement && !hoveredElement.contains(event.relatedTarget)) clearHoveredElement()
  }

  function handleClick(event) {
    const element = cowartDomSelectionTarget(event.target, iframeDocument)
    if (!element) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    clearHoveredElement()
    selectElement(element, event)
  }

  function handleInput(event) {
    if (!selectedElement || !selectedElement.contains(event.target)) return
    revision += 1
  }

  function handleKeyDown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onRequestExit()
  }

  iframeDocument.addEventListener('pointerover', handlePointerOver, true)
  iframeDocument.addEventListener('pointerout', handlePointerOut, true)
  iframeDocument.addEventListener('click', handleClick, true)
  iframeDocument.addEventListener('input', handleInput, true)
  iframeDocument.addEventListener('keydown', handleKeyDown, true)

  async function flush() {
    if (savePromise) await savePromise
    if (revision === savedRevision) return null

    const targetRevision = revision
    const htmlContent = serializeCowartHtmlDraftDocument(iframeDocument)
    savePromise = Promise.resolve(onSave(htmlContent))
    try {
      const result = await savePromise
      savedRevision = targetRevision
      if (revision > savedRevision) return flush()
      return result
    } finally {
      savePromise = null
    }
  }

  function dispose({ save = true } = {}) {
    const pendingSave = save ? flush() : Promise.resolve(null)
    iframeDocument.removeEventListener('pointerover', handlePointerOver, true)
    iframeDocument.removeEventListener('pointerout', handlePointerOut, true)
    iframeDocument.removeEventListener('click', handleClick, true)
    iframeDocument.removeEventListener('input', handleInput, true)
    iframeDocument.removeEventListener('keydown', handleKeyDown, true)
    clearHoveredElement()
    clearSelectedElement()
    iframeDocument.documentElement.removeAttribute(COWART_DOM_EDITOR_ACTIVE_ATTRIBUTE)
    style.remove()
    return pendingSave
  }

  return { dispose, flush }
}

async function waitForHtmlDraftAssets(iframeDocument) {
  const pending = []
  if (iframeDocument.fonts?.ready) pending.push(iframeDocument.fonts.ready.catch(() => undefined))

  for (const image of Array.from(iframeDocument.images || [])) {
    if (image.complete) {
      if (typeof image.decode === 'function') pending.push(image.decode().catch(() => undefined))
      continue
    }
    pending.push(
      new Promise((resolve) => {
        const finish = () => resolve()
        image.addEventListener('load', finish, { once: true })
        image.addEventListener('error', finish, { once: true })
      })
    )
  }

  await Promise.race([
    Promise.all(pending),
    new Promise((resolve) => window.setTimeout(resolve, 1500))
  ])
}

function waitForHtmlDraftPaint(iframeDocument) {
  const frameWindow = iframeDocument.defaultView
  if (!frameWindow?.requestAnimationFrame) {
    return new Promise((resolve) => window.setTimeout(resolve, 34))
  }

  return new Promise((resolve) => {
    frameWindow.requestAnimationFrame(() => frameWindow.requestAnimationFrame(resolve))
  })
}

async function waitForHtmlDraftCaptureReady(iframeDocument) {
  await Promise.all([
    waitForHtmlDraftAssets(iframeDocument),
    new Promise((resolve) => window.setTimeout(resolve, HTML_DRAFT_CAPTURE_DELAY_MS))
  ])
  await waitForHtmlDraftPaint(iframeDocument)
}

function loadRasterImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener('error', () => reject(new Error('HTML 草稿无法转换成图片。')), {
      once: true
    })
    image.src = src
  })
}

function getCowartHtmlDraftAssetUrl(shape) {
  return (
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape?.meta?.cowartHtmlDraftAssetUrl) ||
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape?.props?.url) ||
    null
  )
}

function getCowartHtmlDraftLocalPath(shape) {
  const projectDir = window.openai?.toolOutput?.projectDir
  const assetUrl = getCowartHtmlDraftAssetUrl(shape)
  const match = assetUrl?.match(/^\/page-assets\/([^/]+)\/(.+)$/)
  if (!projectDir || !match) return null

  try {
    return `${projectDir}/canvas/pages/${decodeURIComponent(match[1])}/assets/${decodeURIComponent(match[2])}`
  } catch (_error) {
    return null
  }
}

async function renderCowartHtmlDraftCanvas(shape, pixelRatio) {
  if (!isCowartHtmlDraftEmbedShape(shape)) {
    throw new Error('请选择一个已生成 HTML 的 AI HTML。')
  }

  const iframeDocument = await waitForHtmlDraftDocument(shape.id)
  await waitForHtmlDraftCaptureReady(iframeDocument)

  const width = Math.max(1, Number(shape.props.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const height = Math.max(1, Number(shape.props.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  const captureRatio = Math.max(1, Number(pixelRatio) || 1)
  const canvas = await html2canvas(iframeDocument.documentElement, {
    allowTaint: false,
    backgroundColor: '#ffffff',
    height,
    logging: false,
    onclone(clonedDocument) {
      clonedDocument.querySelectorAll('script').forEach((script) => script.remove())
      for (const animation of clonedDocument.getAnimations?.() || []) {
        try {
          const timing = animation.effect?.getComputedTiming?.()
          if (Number.isFinite(timing?.endTime)) animation.finish()
        } catch (_error) {
          // Infinite or detached animations cannot be finished; pausing below still stabilizes them.
        }
      }
      const captureStyle = clonedDocument.createElement('style')
      captureStyle.textContent = `
        html, body { width: ${width}px !important; height: ${height}px !important; }
        *, *::before, *::after { animation-play-state: paused !important; caret-color: transparent !important; transition: none !important; }
      `
      clonedDocument.head?.append(captureStyle)
    },
    scale: captureRatio,
    scrollX: 0,
    scrollY: 0,
    useCORS: true,
    width,
    windowHeight: height,
    windowWidth: width,
    x: 0,
    y: 0
  })
  return {
    canvas,
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    displayWidth: width,
    displayHeight: height,
    pixelRatio: captureRatio
  }
}

function htmlDraftExportBaseName(shape) {
  const assetUrl = getCowartHtmlDraftAssetUrl(shape)
  const rawName = assetUrl?.split('/').pop()?.split(/[?#]/)[0]
  let htmlName = 'ai-draft.html'
  if (rawName) {
    try {
      htmlName = decodeURIComponent(rawName)
    } catch (_error) {
      htmlName = rawName
    }
  }
  return htmlName.replace(/\.html?$/i, '')
}

function htmlDraftExportFileName(shape, extension) {
  return `${htmlDraftExportBaseName(shape)}.${extension}`
}

function textDataUrl(text, mimeType = 'text/plain') {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`
}

async function readCowartHtmlDraftContent(shape) {
  if (!isCowartHtmlDraftEmbedShape(shape)) {
    throw new Error('请选择一个已生成 HTML 的 AI HTML。')
  }

  const directHtmlUrl = isCowartHtmlDraftDataUrl(shape.props?.url) ? shape.props.url : null
  if (directHtmlUrl) {
    const response = await window.fetch(directHtmlUrl)
    if (!response.ok) throw new Error(`HTML 草稿读取失败：${response.status}`)
    return response.text()
  }

  const assetUrl = getCowartHtmlDraftAssetUrl(shape)
  if (!assetUrl) throw new Error('当前 HTML 草稿没有可导出的源文件。')
  if (hasCowartWidgetBridge()) {
    const pageAsset = await readCowartPageAsset(assetUrl)
    return blobFromBase64(pageAsset.dataBase64, pageAsset.mimeType).text()
  }

  const response = await window.fetch(assetUrl)
  if (!response.ok) throw new Error(`HTML 草稿读取失败：${response.status}`)
  return response.text()
}

async function readCowartImageDataUrl(editor, imageShape) {
  const asset = imageShape?.props?.assetId ? editor.getAsset(imageShape.props.assetId) : null
  const sourceUrl = asset?.props?.src
  if (!asset || !sourceUrl) throw new Error('当前图片没有可读取的原始文件。')

  if (sourceUrl.startsWith(PAGE_ASSETS_ROUTE) && hasCowartWidgetBridge()) {
    const pageAsset = await readCowartPageAsset(sourceUrl)
    return `data:${pageAsset.mimeType};base64,${pageAsset.dataBase64}`
  }
  if (sourceUrl.startsWith('data:')) return sourceUrl

  const resolvedUrl = /^https?:\/\//.test(sourceUrl)
    ? sourceUrl
    : await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
  if (!resolvedUrl) throw new Error('无法读取当前图片的原始文件。')
  const response = await window.fetch(resolvedUrl)
  if (!response.ok) throw new Error(`读取当前图片失败：${response.status}`)
  return readFileAsDataUrl(await response.blob())
}

function cowartSlidesExportName(slidesShape) {
  const name = String(slidesShape?.props?.name || '').trim()
  return name || AI_SLIDES_LABEL
}

function escapeHtmlText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function cowartImageSlideHtml(dataUrl, title) {
  const safeDataUrl = JSON.stringify(dataUrl).replaceAll('<', '\\u003c')
  const safeTitle = JSON.stringify(title).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtmlText(title)}</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}
    body{display:grid;place-items:center}img{display:block;width:100%;height:100%;object-fit:contain}
  </style>
</head>
<body><img id="cowart-slide-image" alt=""></body>
<script>
  document.title=${safeTitle};
  document.getElementById('cowart-slide-image').src=${safeDataUrl};
</script>
</html>`
}

function cowartSlidesPlayerHtml(slidesName, pageFiles) {
  const safeTitle = JSON.stringify(slidesName).replaceAll('<', '\\u003c')
  const safePages = JSON.stringify(pageFiles).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtmlText(slidesName)} · Play</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
    .stage{position:fixed;inset:0;overflow:hidden;background:#000;cursor:pointer}
    .canvas{position:absolute;width:1024px;height:576px;overflow:hidden;transform-origin:top left;background:#000}
    iframe{display:block;width:1024px;height:576px;border:0;background:#fff}
    .controls{position:fixed;z-index:2;top:16px;left:50%;display:flex;align-items:center;gap:2px;padding:4px;color:#fff;background:#0009;border-radius:9px;transform:translateX(-50%);backdrop-filter:blur(14px)}
    button{display:grid;width:26px;height:26px;padding:0;place-items:center;color:#fff;background:transparent;border:0;border-radius:8px;cursor:pointer;font:18px/1 system-ui,sans-serif}
    button:hover{background:#ffffff26}button:disabled{opacity:.35;cursor:default}.count{min-width:42px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}
  </style>
</head>
<body>
  <main class="stage" id="stage"><div class="canvas" id="canvas"><iframe id="slide" title="Slides player"></iframe></div></main>
  <nav class="controls" id="controls" aria-label="翻页控制"><button id="prev" aria-label="上一页">‹</button><span class="count" id="count"></span><button id="next" aria-label="下一页">›</button></nav>
  <script>
    const title=${safeTitle}, pages=${safePages}; let index=0;
    const stage=document.getElementById('stage'), canvas=document.getElementById('canvas'), frame=document.getElementById('slide'), count=document.getElementById('count'), prev=document.getElementById('prev'), next=document.getElementById('next');
    document.title=title+' · Play';
    function layout(){const scale=Math.min(innerWidth/1024,innerHeight/576);canvas.style.left=(innerWidth-1024*scale)/2+'px';canvas.style.top=(innerHeight-576*scale)/2+'px';canvas.style.transform='scale('+scale+')'}
    function show(value){index=Math.max(0,Math.min(pages.length-1,value));frame.src=pages[index];count.textContent=(index+1)+' / '+pages.length;prev.disabled=index===0;next.disabled=index===pages.length-1}
    function go(delta){show(index+delta)}
    function isInteractiveClick(event){const target=event.target;return !!target?.closest?.('a[href],button,input,select,textarea,summary,video,audio,canvas,[contenteditable="true"],[onclick],[role="button"],[role="link"],[role="menuitem"],[role="tab"]')}
    function handleKey(event){if(event.key==='ArrowLeft'){event.preventDefault();go(-1)}else if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();go(1)}}
    function bindSlideEvents(){try{const doc=frame.contentDocument;if(!doc)return;doc.addEventListener('click',event=>{if(!isInteractiveClick(event))go(1)});doc.addEventListener('keydown',handleKey)}catch(_error){}}
    frame.addEventListener('load',bindSlideEvents);
    stage.addEventListener('click',()=>go(1));
    document.getElementById('controls').addEventListener('click',event=>event.stopPropagation());
    prev.onclick=()=>go(-1);next.onclick=()=>go(1);
    addEventListener('keydown',handleKey);addEventListener('resize',layout);
    layout();
    show(0);
  </script>
</body>
</html>`
}

function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

async function downloadCowartImageShape(editor, imageShape) {
  const asset = imageShape?.props?.assetId ? editor.getAsset(imageShape.props.assetId) : null
  const sourceUrl = asset?.props?.src
  if (!asset || !sourceUrl) throw new Error('当前图片没有可下载的原始文件。')

  const fileName = asset.props.name || 'cowart-image.png'
  if (sourceUrl.startsWith(PAGE_ASSETS_ROUTE)) {
    return downloadCowartFile({ assetUrl: sourceUrl, fileName })
  }

  let dataUrl = sourceUrl
  if (!sourceUrl.startsWith('data:')) {
    const resolvedUrl = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
    if (!resolvedUrl) throw new Error('无法读取当前图片的原始文件。')
    const response = await window.fetch(resolvedUrl)
    if (!response.ok) throw new Error(`读取当前图片失败：${response.status}`)
    dataUrl = await readFileAsDataUrl(await response.blob())
  }

  return downloadCowartFile({
    dataUrl,
    fileName,
    mimeType: asset.props.mimeType || undefined
  })
}

async function exportCowartHtmlDraft(editor, draftShapeId, format) {
  const shape = editor.getShape(draftShapeId)
  if (format === 'html') {
    const htmlContent = await readCowartHtmlDraftContent(shape)
    const fileName = htmlDraftExportFileName(shape, 'html')
    const dataUrl = textDataUrl(htmlContent, 'text/html')
    if (hasCowartWidgetBridge()) {
      return downloadCowartFile({ dataUrl, fileName, mimeType: 'text/html' })
    }
    downloadDataUrl(dataUrl, fileName)
    return { fileName }
  }

  const bounds = new Box(0, 0, Number(shape?.props?.w) || 1, Number(shape?.props?.h) || 1)
  const exportResult = await renderCowartHtmlDraftCanvas(
    shape,
    getAnnotationEditExportPixelRatio(bounds)
  )
  const fileName = htmlDraftExportFileName(shape, 'png')
  if (hasCowartWidgetBridge()) {
    return downloadCowartFile({
      dataUrl: exportResult.url,
      fileName,
      mimeType: 'image/png'
    })
  }

  downloadDataUrl(exportResult.url, fileName)
  return { fileName }
}

async function exportCowartSlides(editor, slidesShapeId, format) {
  if (!hasCowartWidgetBridge()) {
    throw new Error('导出 Slides 文件夹需要在 Codex Cowart 小组件中使用。')
  }

  const slidesShape = editor.getShape(slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) throw new Error('请选择一个 AI Slides。')
  const items = getAiSlidesItems(editor, slidesShapeId)
  if (!items.length) throw new Error('当前 AI Slides 还没有可导出的页面。')
  let directoryName = cowartSlidesExportName(slidesShape)
  const results = []

  if (format === 'image') {
    for (const [index, item] of items.entries()) {
      let dataUrl
      if (isCowartHtmlDraftEmbedShape(item)) {
        const bounds = new Box(0, 0, Number(item.props?.w) || 1, Number(item.props?.h) || 1)
        dataUrl = (await renderCowartHtmlDraftCanvas(item, getAnnotationEditExportPixelRatio(bounds))).url
      } else {
        const exportResult = await editor.toImageDataUrl([item.id], {
          background: true,
          format: 'png',
          padding: 0,
          pixelRatio: 1
        })
        dataUrl = exportResult.url
      }
      const result = await downloadCowartFile({
        dataUrl,
        directoryName,
        fileName: `page-${String(index + 1).padStart(2, '0')}.png`,
        mimeType: 'image/png',
        overwrite: true,
        uniqueDirectory: index === 0
      })
      if (index === 0 && result.directoryName) directoryName = result.directoryName
      results.push(result)
    }
    return { directoryName, filePath: results[0]?.directoryPath, results }
  }

  const pageFiles = []
  for (const [index, item] of items.entries()) {
    const fileName = `page-${String(index + 1).padStart(2, '0')}.html`
    let htmlContent
    if (isCowartHtmlDraftEmbedShape(item)) {
      htmlContent = await readCowartHtmlDraftContent(item)
    } else {
      const imageDataUrl = await readCowartImageDataUrl(editor, item)
      htmlContent = cowartImageSlideHtml(imageDataUrl, `${directoryName} · ${index + 1}`)
    }
    pageFiles.push(`pages/${fileName}`)
    const result = await downloadCowartFile({
      dataUrl: textDataUrl(htmlContent, 'text/html'),
      directoryName,
      subdirectory: 'pages',
      fileName,
      mimeType: 'text/html',
      overwrite: true,
      uniqueDirectory: index === 0
    })
    if (index === 0 && result.directoryName) directoryName = result.directoryName
    results.push(result)
  }

  results.push(await downloadCowartFile({
    dataUrl: textDataUrl(cowartSlidesPlayerHtml(directoryName, pageFiles), 'text/html'),
    directoryName,
    fileName: 'Play.html',
    mimeType: 'text/html',
    overwrite: true
  }))
  return { directoryName, filePath: results.at(-1)?.directoryPath, results }
}

function cowartCanvasExportPixelRatio(
  bounds,
  {
    maxDimension = COWART_CANVAS_EXPORT_MAX_DIMENSION,
    maxPixels = COWART_CANVAS_EXPORT_MAX_PIXELS
  } = {}
) {
  const width = Math.max(1, Number(bounds?.w) || 1)
  const height = Math.max(1, Number(bounds?.h) || 1)
  return Math.max(
    0.2,
    Math.min(
      2,
      maxDimension / Math.max(width, height),
      Math.sqrt(maxPixels / (width * height))
    )
  )
}

function cachedCowartHtmlCapture(cache, shape) {
  let capture = cache.get(shape.id)
  if (!capture) {
    capture = renderCowartHtmlDraftCanvas(shape, COWART_CANVAS_EXPORT_HTML_CAPTURE_RATIO)
    cache.set(shape.id, capture)
  }
  return capture
}

async function renderCowartCanvasComposite(
  editor,
  rootShapeIds,
  {
    padding = COWART_CANVAS_EXPORT_PADDING,
    htmlCaptureCache = new Map(),
    maxDimension,
    maxPixels,
    outputFormat = 'png'
  } = {}
) {
  const rootIds = rootShapeIds.filter((shapeId) => editor.getShape(shapeId))
  if (!rootIds.length) throw new Error('当前画布没有可导出的内容。')

  const includedShapeIds = editor.getShapeAndDescendantIds(rootIds)
  const shapes = editor
    .getCurrentPageShapesSorted()
    .filter((shape) => includedShapeIds.has(shape.id) && !editor.isShapeHidden(shape.id))
  if (!shapes.length) throw new Error('当前画布没有可见内容。')

  const rawBounds = editor.getShapesPageBounds(shapes.map((shape) => shape.id))
  if (!rawBounds) throw new Error('无法计算当前画布的导出范围。')
  const bounds = expandBox(rawBounds, padding)
  const pixelRatio = cowartCanvasExportPixelRatio(bounds, { maxDimension, maxPixels })
  const htmlShapes = shapes.filter(isCowartHtmlDraftEmbedShape)
  const baseCapturePromise = editor.toImageDataUrl(rootIds, {
    bounds,
    background: true,
    darkMode: false,
    format: 'png',
    padding: 0,
    pixelRatio
  })
  const htmlCapturesPromise = Promise.all(
    htmlShapes.map((shape) => cachedCowartHtmlCapture(htmlCaptureCache, shape))
  )
  const [baseCapture, htmlCaptures] = await Promise.all([
    baseCapturePromise,
    htmlCapturesPromise
  ])

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(Number(baseCapture.width) || bounds.w * pixelRatio))
  canvas.height = Math.max(1, Math.round(Number(baseCapture.height) || bounds.h * pixelRatio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建画布导出图。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(await loadRasterImage(baseCapture.url), 0, 0, canvas.width, canvas.height)

  const scaleX = canvas.width / bounds.w
  const scaleY = canvas.height / bounds.h
  for (const [index, shape] of htmlShapes.entries()) {
    const capture = htmlCaptures[index]
    const pageTransform = editor.getShapePageTransform(shape.id)
    if (!pageTransform) continue
    context.setTransform(
      scaleX * pageTransform.a,
      scaleY * pageTransform.b,
      scaleX * pageTransform.c,
      scaleY * pageTransform.d,
      scaleX * (pageTransform.e - bounds.x),
      scaleY * (pageTransform.f - bounds.y)
    )
    context.drawImage(
      capture.canvas,
      0,
      0,
      Number(shape.props?.w) || capture.displayWidth,
      Number(shape.props?.h) || capture.displayHeight
    )
  }

  const annotationShapeIds = shapes
    .filter((shape) => isAnnotationMarkShape(shape))
    .map((shape) => shape.id)
  if (annotationShapeIds.length) {
    const annotationOverlay = await editor.toImageDataUrl(annotationShapeIds, {
      bounds,
      background: false,
      darkMode: false,
      format: 'png',
      padding: 0,
      pixelRatio
    })
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(
      await loadRasterImage(annotationOverlay.url),
      0,
      0,
      canvas.width,
      canvas.height
    )
  }

  return {
    dataUrl: outputFormat === 'jpeg'
      ? canvas.toDataURL('image/jpeg', 0.86)
      : canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    displayWidth: bounds.w,
    displayHeight: bounds.h,
    bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
    shapeIds: shapes.map((shape) => shape.id)
  }
}

function cowartExportShapeTypeLabel(shape) {
  if (isCowartHtmlDraftEmbedShape(shape)) return 'HTML'
  if (isAiSlidesShape(shape)) return 'Slides'
  return ({
    arrow: '连线',
    bookmark: '链接',
    draw: '手绘',
    embed: '嵌入内容',
    frame: '画框',
    geo: '卡片',
    group: '组合',
    highlight: '高亮',
    image: '图片',
    line: '线条',
    note: '便签',
    text: '文本',
    video: '视频'
  })[shape?.type] || '画布内容'
}

function cowartShapePlainText(shape) {
  if (!shape) return ''
  const candidates = []
  if (typeof shape.meta?.cowartThinkingBody === 'string') {
    candidates.push(shape.meta.cowartThinkingBody)
  }
  if (shape.props?.richText) {
    try {
      candidates.push(renderPlaintextFromRichText(shape.props.richText))
    } catch (_error) {
      // Keep reading the remaining plain-text fields.
    }
  }
  for (const key of ['text', 'name', 'altText']) {
    if (typeof shape.props?.[key] === 'string') candidates.push(shape.props[key])
  }
  return candidates
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('\n')
}

async function cowartShapeExportText(shape, htmlTextCache) {
  const plainText = cowartShapePlainText(shape)
  if (!isCowartHtmlDraftEmbedShape(shape)) return plainText

  let htmlText = htmlTextCache.get(shape.id)
  if (htmlText === undefined) {
    try {
      const iframeDocument = await waitForHtmlDraftDocument(shape.id)
      htmlText = String(iframeDocument.body?.innerText || '').trim()
    } catch (_error) {
      htmlText = ''
    }
    htmlTextCache.set(shape.id, htmlText)
  }
  return [plainText, htmlText].filter(Boolean).join('\n')
}

function cowartShapeExportTitle(shape, text) {
  const firstLine = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (firstLine) return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
  return cowartExportShapeTypeLabel(shape)
}

function cowartShapeExternalUrl(shape) {
  for (const value of [shape?.props?.url, shape?.props?.href]) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  }
  return null
}

async function collectCowartCanvasExportItems(editor, shapes, htmlTextCache) {
  const items = await Promise.all(shapes.map(async (shape) => {
    const bounds = editor.getShapePageBounds(shape.id)
    if (!bounds) return null
    const text = await cowartShapeExportText(shape, htmlTextCache)
    const link = cowartShapeExternalUrl(shape)
    const isVisualContent = ['bookmark', 'embed', 'frame', 'image', 'video'].includes(shape.type)
    if (!text && !link && !isVisualContent) return null
    return {
      shapeId: shape.id,
      type: cowartExportShapeTypeLabel(shape),
      title: cowartShapeExportTitle(shape, text),
      text,
      link,
      bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }
    }
  }))
  return items.filter(Boolean)
}

function cowartCanvasDetailShapes(editor, rootShapes) {
  const detailShapes = []
  const seen = new Set()
  for (const rootShape of rootShapes) {
    const candidates = isAiSlidesShape(rootShape)
      ? getAiSlidesItems(editor, rootShape.id)
      : [rootShape]
    for (const shape of candidates) {
      if (
        !shape ||
        seen.has(shape.id) ||
        editor.isShapeHidden(shape.id) ||
        COWART_CANVAS_DETAIL_SKIP_TYPES.has(shape.type)
      ) {
        continue
      }
      seen.add(shape.id)
      detailShapes.push(shape)
    }
  }
  return detailShapes
}

function cowartDetailShapeNeedsImage(shape) {
  return ['bookmark', 'embed', 'frame', 'group', 'image', 'video'].includes(shape?.type)
}

async function cowartDetailShapeText(editor, shape, htmlTextCache) {
  const descendantIds = editor.getShapeAndDescendantIds([shape.id])
  const texts = []
  for (const item of editor.getCurrentPageShapesSorted()) {
    if (!descendantIds.has(item.id) || editor.isShapeHidden(item.id)) continue
    const text = await cowartShapeExportText(item, htmlTextCache)
    if (text && !texts.includes(text)) texts.push(text)
  }
  return texts.join('\n\n')
}

function downloadCowartBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  downloadDataUrl(url, fileName)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function exportCowartCanvas(editor, format) {
  const rootShapes = editor
    .getSortedChildIdsForParent(editor.getCurrentPageId())
    .map((shapeId) => editor.getShape(shapeId))
    .filter((shape) => shape && !editor.isShapeHidden(shape.id))
  if (!rootShapes.length) throw new Error('当前画布没有可导出的内容。')

  const exportedAt = new Date()
  const fileName = canvasExportFileName(format, exportedAt)
  const pageName = String(editor.getCurrentPage()?.name || '').trim()
  const contentName = rootShapes
    .map((shape) => String(shape.props?.name || '').trim())
    .find((name) => name && ![AI_DRAFT_HOLDER_LABEL, AI_SLIDES_LABEL].includes(name))
  const title = pageName && !/^Page(?: \d+)?$/i.test(pageName)
    ? pageName
    : contentName || 'Yogurt AI 画布'
  const htmlCaptureCache = new Map()
  const htmlTextCache = new Map()
  const overview = await renderCowartCanvasComposite(
    editor,
    rootShapes.map((shape) => shape.id),
    { htmlCaptureCache }
  )
  const overviewShapeIds = new Set(overview.shapeIds)
  const overviewShapes = editor
    .getCurrentPageShapesSorted()
    .filter((shape) => overviewShapeIds.has(shape.id))
  const items = await collectCowartCanvasExportItems(editor, overviewShapes, htmlTextCache)

  if (format === 'html') {
    const htmlContent = buildCanvasHtmlDocument({
      title,
      overview,
      items,
      exportedAt: exportedAt.toLocaleString('zh-CN')
    })
    let result = { fileName }
    if (hasCowartWidgetBridge()) {
      result = await downloadCowartFile({
        dataUrl: textDataUrl(htmlContent, 'text/html'),
        fileName,
        mimeType: 'text/html'
      })
    } else {
      downloadCowartBlob(new Blob([htmlContent], { type: 'text/html;charset=utf-8' }), fileName)
    }
    return { ...result, format, itemCount: items.length, slideCount: null }
  }

  const sections = []
  for (const shape of cowartCanvasDetailShapes(editor, rootShapes)) {
    const text = await cowartDetailShapeText(editor, shape, htmlTextCache)
    const needsImage = cowartDetailShapeNeedsImage(shape)
    if (!text && !needsImage) continue
    let capture = null
    if (needsImage) {
      try {
        capture = await renderCowartCanvasComposite(editor, [shape.id], {
          padding: 24,
          htmlCaptureCache,
          maxDimension: 1600,
          maxPixels: 2_500_000,
          outputFormat: 'jpeg'
        })
      } catch (error) {
        console.warn(`Could not render PPT detail shape ${shape.id}.`, error)
      }
    }
    sections.push({
      shapeId: shape.id,
      type: cowartExportShapeTypeLabel(shape),
      title: cowartShapeExportTitle(shape, text),
      text,
      imageDataUrl: capture?.dataUrl || null,
      imageWidth: capture?.width || null,
      imageHeight: capture?.height || null
    })
  }

  const pptxResult = await buildCanvasPptxBase64({
    title,
    overview,
    sections,
    exportedAt: exportedAt.toISOString()
  })
  let result = { fileName }
  if (hasCowartWidgetBridge()) {
    result = await downloadCowartFile({
      dataBase64: pptxResult.base64,
      fileName,
      mimeType: pptxResult.mimeType
    })
  } else {
    downloadDataUrl(`data:${pptxResult.mimeType};base64,${pptxResult.base64}`, fileName)
  }
  return {
    ...result,
    format,
    itemCount: items.length,
    slideCount: pptxResult.slideCount
  }
}

async function exportCowartHtmlDraftAnnotationScreenshot(editor, draftShapeId) {
  const shapeIds = collectHtmlDraftAnnotationShapeIds(editor, draftShapeId)
  const draftShape = editor.getShape(draftShapeId)
  const rawBounds = editor.getShapesPageBounds(shapeIds)
  if (!draftShape || !rawBounds) throw new Error('无法计算 HTML 草稿截图范围。')

  const exportBounds = expandBox(rawBounds, ANNOTATION_EDIT_EXPORT_PADDING)
  const pixelRatio = getAnnotationEditExportPixelRatio(exportBounds)
  const draftCapture = await renderCowartHtmlDraftCanvas(draftShape, pixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(exportBounds.w * pixelRatio))
  canvas.height = Math.max(1, Math.round(exportBounds.h * pixelRatio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建标注截图。')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const pageTransform = editor.getShapePageTransform(draftShapeId)
  if (!pageTransform) throw new Error('无法读取 HTML 草稿的画布变换。')
  context.setTransform(
    pixelRatio * pageTransform.a,
    pixelRatio * pageTransform.b,
    pixelRatio * pageTransform.c,
    pixelRatio * pageTransform.d,
    pixelRatio * (pageTransform.e - exportBounds.x),
    pixelRatio * (pageTransform.f - exportBounds.y)
  )
  context.drawImage(
    draftCapture.canvas,
    0,
    0,
    Number(draftShape.props.w) || draftCapture.displayWidth,
    Number(draftShape.props.h) || draftCapture.displayHeight
  )

  const annotationShapeIds = shapeIds.filter((shapeId) => shapeId !== draftShapeId)
  if (annotationShapeIds.length) {
    const overlay = await editor.toImageDataUrl(annotationShapeIds, {
      bounds: exportBounds,
      background: false,
      darkMode: false,
      format: 'png',
      padding: 0,
      pixelRatio
    })
    const overlayImage = await loadRasterImage(overlay.url)
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(overlayImage, 0, 0, canvas.width, canvas.height)
  }

  return {
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    shapeIds
  }
}

async function exportCowartSlidesAnnotationScreenshot(editor, slidesShapeId) {
  const shapeIds = collectAiSlidesAnnotationShapeIds(editor, slidesShapeId)
  const slidesShape = editor.getShape(slidesShapeId)
  const rawBounds = editor.getShapesPageBounds(shapeIds)
  if (!slidesShape || !rawBounds) throw new Error('无法计算 AI Slides 标注截图范围。')

  const exportBounds = expandBox(rawBounds, ANNOTATION_EDIT_EXPORT_PADDING)
  const pixelRatio = getAnnotationEditExportPixelRatio(exportBounds)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(exportBounds.w * pixelRatio))
  canvas.height = Math.max(1, Math.round(exportBounds.h * pixelRatio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建 AI Slides 标注截图。')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const slidesCapture = await editor.toImageDataUrl([slidesShapeId], {
    bounds: exportBounds,
    background: false,
    darkMode: false,
    format: 'png',
    padding: 0,
    pixelRatio
  })
  context.drawImage(await loadRasterImage(slidesCapture.url), 0, 0, canvas.width, canvas.height)

  for (const item of getAiSlidesItems(editor, slidesShapeId)) {
    if (!isCowartHtmlDraftEmbedShape(item)) continue
    const htmlCapture = await renderCowartHtmlDraftCanvas(item, pixelRatio)
    const pageTransform = editor.getShapePageTransform(item.id)
    if (!pageTransform) continue
    context.setTransform(
      pixelRatio * pageTransform.a,
      pixelRatio * pageTransform.b,
      pixelRatio * pageTransform.c,
      pixelRatio * pageTransform.d,
      pixelRatio * (pageTransform.e - exportBounds.x),
      pixelRatio * (pageTransform.f - exportBounds.y)
    )
    context.drawImage(
      htmlCapture.canvas,
      0,
      0,
      Number(item.props.w) || htmlCapture.displayWidth,
      Number(item.props.h) || htmlCapture.displayHeight
    )
  }

  const annotationShapeIds = shapeIds.filter((shapeId) => shapeId !== slidesShapeId)
  if (annotationShapeIds.length) {
    const annotationOverlay = await editor.toImageDataUrl(annotationShapeIds, {
      bounds: exportBounds,
      background: false,
      darkMode: false,
      format: 'png',
      padding: 0,
      pixelRatio
    })
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(await loadRasterImage(annotationOverlay.url), 0, 0, canvas.width, canvas.height)
  }

  return {
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    shapeIds
  }
}

function aiSlidesAnnotationScreenshotFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `ai-slides-annotation-edit-${timestamp}.png`
}

function createAiSlidesBelowSource(editor, sourceSlidesShape) {
  const sourceBounds = editor.getShapePageBounds(sourceSlidesShape.id)
  if (!sourceBounds) throw new Error('无法读取原 AI Slides 的画布位置。')

  const width = Math.max(AI_SLIDES_DEFAULT_W, Number(sourceSlidesShape.props?.w) || AI_SLIDES_DEFAULT_W)
  const height = Math.max(AI_SLIDES_DEFAULT_H, Number(sourceSlidesShape.props?.h) || AI_SLIDES_DEFAULT_H)
  const margin = 80
  const pageId = editor.getCurrentPageId()
  const obstacles = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.parentId === pageId && shape.id !== sourceSlidesShape.id)
    .map((shape) => editor.getShapePageBounds(shape.id))
    .filter(Boolean)

  let x = sourceBounds.x
  let y = sourceBounds.maxY + margin
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = new Box(x, y, width, height)
    if (!obstacles.some((bounds) => candidate.collides(bounds))) break
    y += height + margin
  }

  const slidesShapeId = createShapeId()
  createAiSlidesShape(editor, slidesShapeId, {
    x,
    y,
    meta: {
      cowartGeneratedFromAiSlidesAnnotation: true,
      cowartSourceAiSlidesShapeId: sourceSlidesShape.id
    },
    props: {
      w: width,
      h: height,
      name: AI_SLIDES_LABEL
    }
  })
  return slidesShapeId
}

function buildAiSlidesAnnotationEditPrompt({
  sourceSlidesShape,
  targetSlidesShapeId,
  sourceItems,
  exportResult,
  screenshotAsset
}) {
  const pageCount = sourceItems.length
  const annotationCount = Math.max(0, exportResult.shapeIds.length - 1)
  const sourcePageLines = sourceItems.flatMap((item, index) => {
    if (isCowartHtmlDraftEmbedShape(item)) {
      const assetPath = getCowartHtmlDraftLocalPath(item)
      return [`${index + 1}. HTML shape ${item.id}${assetPath ? ` — ${assetPath}` : ''}`]
    }
    return [`${index + 1}. Image shape ${item.id}`]
  })

  return [
    AI_SLIDES_ANNOTATION_EDIT_PROMPT,
    '',
    `Yogurt AI source Slides frame: ${sourceSlidesShape.id}`,
    `Yogurt AI target Slides frame below source: ${targetSlidesShapeId}`,
    `Required page count: exactly ${pageCount}.`,
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${exportResult.width}x${exportResult.height}`,
    ...(screenshotAsset?.assetPath
      ? [
          `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
          'Use this screenshot as the authoritative visual reference and annotation brief.'
        ]
      : []),
    'Source pages in order:',
    ...sourcePageLines,
    '',
    'Required tool calls after generating the revised HTML pages:',
    `- Call insert_cowart_html_draft exactly ${pageCount} times, once per page, in page order.`,
    `- For every call set draftShapeId to "${targetSlidesShapeId}".`,
    '- Set replaceDraftHolder: false, updateExistingDraft: false, matchAnchor: false, displayWidth: 1024, and displayHeight: 576.',
    `- Set shapeMeta.cowartAiSlidesParentShapeId to "${targetSlidesShapeId}".`,
    `- Set shapeMeta.cowartAiSlidesGeneratedFromAnnotation to true and shapeMeta.cowartAiSlidesSourceShapeId to "${sourceSlidesShape.id}".`,
    `- Set shapeMeta.cowartAiSlidesGeneratedPageCount to ${pageCount}, and shapeMeta.cowartAiSlidesGeneratedPage to the 1-based page number.`,
    '- Use unique ordered file names such as revised-slide-01.html, revised-slide-02.html, and so on.',
    '- Keep the source Slides, source page assets, and annotations unchanged.',
    '- The target Slides already exists below the source; do not create another frame and do not place pages beside the source.'
  ].join('\n')
}

async function sendAiSlidesAnnotationEditRequest(editor, slidesShapeId) {
  const sender = followUpSender()
  if (!sender) throw new Error('当前 Yogurt AI 画布没有可用的 Codex MCP 消息桥。')

  const sourceSlidesShape = editor.getShape(slidesShapeId)
  const sourceItems = getAiSlidesItems(editor, slidesShapeId)
  if (!isAiSlidesShape(sourceSlidesShape) || !sourceItems.length) {
    throw new Error('请选择一个已有内容的 AI Slides。')
  }

  const exportResult = await exportCowartSlidesAnnotationScreenshot(editor, slidesShapeId)
  const screenshotAsset = await saveCowartReferenceImage({
    anchorShapeId: slidesShapeId,
    fileName: aiSlidesAnnotationScreenshotFileName(),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const targetSlidesShapeId = createAiSlidesBelowSource(editor, sourceSlidesShape)

  try {
    const saveResult = await saveCowartCanvasSnapshot(editor.store.getStoreSnapshot(), {
      protectImageRecords: true
    })
    if (saveResult?.ok === false) throw new Error(saveResult.message || '新的 AI Slides 保存失败。')

    const prompt = buildAiSlidesAnnotationEditPrompt({
      sourceSlidesShape,
      targetSlidesShapeId,
      sourceItems,
      exportResult,
      screenshotAsset
    })
    const content = [{ type: 'text', text: prompt }]
    if (supportsCowartMessageImages()) {
      content.push(
        dataUrlToImageContent(exportResult.url, {
          cowartAiSlidesAnnotation: true,
          cowartSourceAiSlidesShapeId: slidesShapeId,
          cowartTargetAiSlidesShapeId: targetSlidesShapeId,
          cowartIncludedShapeIds: exportResult.shapeIds,
          cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
          cowartAnnotationScreenshotFileName: screenshotAsset.fileName || null
        })
      )
    }
    return await sender(
      { prompt, content },
      {
        promptType: 'slides_annotation_edit',
        aiType: 'slides',
        hasReference: true,
        pageCount: sourceItems.length
      }
    )
  } catch (error) {
    editor.deleteShapes([targetSlidesShapeId])
    await saveCowartCanvasSnapshot(editor.store.getStoreSnapshot(), { protectImageRecords: true })
    throw error
  }
}

function htmlDraftAnnotationScreenshotFileName(mode) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `html-draft-annotation-${mode}-${timestamp}.png`
}

function buildHtmlDraftAnnotationEditPrompt({ draftShape, exportResult, screenshotAsset }) {
  const assetUrl = getCowartHtmlDraftAssetUrl(draftShape)
  const assetPath = getCowartHtmlDraftLocalPath(draftShape)
  const annotationCount = Math.max(0, exportResult.shapeIds.length - 1)
  const targetWidth = Math.round(Number(draftShape.props.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const targetHeight = Math.round(Number(draftShape.props.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  return [
    HTML_DRAFT_ANNOTATION_EDIT_PROMPT,
    '',
    `Yogurt AI HTML draft shape: ${draftShape.id}`,
    `HTML draft asset URL: ${assetUrl || 'unavailable'}`,
    ...(assetPath ? [`HTML draft local path: ${assetPath}`] : []),
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${exportResult.width}x${exportResult.height}`,
    ...(screenshotAsset?.assetPath
      ? [
          `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
          'Use this screenshot as the authoritative source for the annotation requests.'
        ]
      : []),
    '',
    'Required completion step:',
    `- Call insert_cowart_html_draft with draftShapeId: "${draftShape.id}", updateExistingDraft: false, replaceDraftHolder: false, placement: "right", margin: 40, matchAnchor: true, displayWidth: ${targetWidth}, and displayHeight: ${targetHeight}.`,
    '- Pass the final complete HTML document as htmlContent.',
    '- Use a new short .html fileName; do not overwrite the original HTML asset.',
    '- Keep the original draft shape and annotations unchanged. The returned shapeId must be a new shape placed to the right.',
    '- If this already-open Codex task does not expose updateExistingDraft yet, omit that argument but still pass replaceDraftHolder: false, placement: "right", margin: 40, matchAnchor: true, displayWidth and displayHeight. Never edit the original HTML file or original shape record.'
  ].join('\n')
}

function buildHtmlDraftAnnotationImagePrompt({ draftShape, exportResult, screenshotAsset }) {
  const targetWidth = Math.round(Number(draftShape.props.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const targetHeight = Math.round(Number(draftShape.props.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  const ratio = targetHeight ? targetWidth / targetHeight : 1
  const annotationCount = Math.max(0, exportResult.shapeIds.length - 1)
  return [
    HTML_DRAFT_ANNOTATION_IMAGE_PROMPT,
    '',
    `Yogurt AI HTML draft shape: ${draftShape.id}`,
    `Target canvas image size: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${targetWidth}:${targetHeight} (${ratio.toFixed(3)} width/height).`,
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${exportResult.width}x${exportResult.height}`,
    ...(screenshotAsset?.assetPath
      ? [
          `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
          'Use this screenshot as the authoritative visual input for image generation.'
        ]
      : []),
    '',
    'Required placement after imagegen:',
    `- Call insert_cowart_image with anchorShapeId: "${draftShape.id}", placement: "right", margin: 40, matchAnchor: true, displayWidth: ${targetWidth}, and displayHeight: ${targetHeight}.`,
    '- Leave replaceAiImageHolder false or unset; this HTML draft is the source anchor and must remain unchanged.',
    '- Set shapeMeta.cowartGeneratedFromHtmlDraftAnnotation to true.'
  ].join('\n')
}

async function sendHtmlDraftAnnotationRequest(editor, draftShapeId, mode) {
  const sender = followUpSender()
  if (!sender) throw new Error('当前 Yogurt AI 画布没有可用的 Codex MCP 消息桥。')

  const draftShape = editor.getShape(draftShapeId)
  if (!isCowartHtmlDraftEmbedShape(draftShape)) {
    throw new Error('请选择一个已生成 HTML 的 AI HTML。')
  }

  const exportResult = await exportCowartHtmlDraftAnnotationScreenshot(editor, draftShapeId)
  const screenshotAsset = await saveCowartReferenceImage({
    anchorShapeId: draftShapeId,
    fileName: htmlDraftAnnotationScreenshotFileName(mode),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const prompt =
    mode === 'edit'
      ? buildHtmlDraftAnnotationEditPrompt({ draftShape, exportResult, screenshotAsset })
      : buildHtmlDraftAnnotationImagePrompt({ draftShape, exportResult, screenshotAsset })
  const content = [{ type: 'text', text: prompt }]

  if (supportsCowartMessageImages()) {
    content.push(
      dataUrlToImageContent(exportResult.url, {
        cowartHtmlDraftAnnotation: true,
        cowartHtmlDraftAnnotationMode: mode,
        cowartSourceHtmlDraftShapeId: draftShapeId,
        cowartIncludedShapeIds: exportResult.shapeIds,
        cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
        cowartAnnotationScreenshotFileName: screenshotAsset.fileName || null
      })
    )
  }

  return sender(
    { prompt, content },
    {
      promptType: mode === 'edit' ? 'html_annotation_edit' : 'html_annotation_image',
      aiType: mode === 'edit' ? 'html' : 'image',
      hasReference: true
    }
  )
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
    `Yogurt AI image holder shape: ${holderShape.id}`,
    `Target canvas slot: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${ratioLabel} (${ratio.toFixed(3)} width/height).`,
    'Compose the final bitmap for this slot without cropping or stretching.',
    ...referenceLines,
    '',
    'Prompt:',
    userPrompt.trim()
  ].join('\n')
}

function buildAiDraftGenerationPrompt({ holderShape, userPrompt, references, referenceAttached }) {
  const { targetWidth, targetHeight, ratio, ratioLabel } = formatAiImageGenerationTarget(holderShape)
  const referenceLines = aiImageReferenceLines({ references, referenceAttached })

  return [
    AI_DRAFT_GENERATION_PROMPT_PREFIX,
    '',
    `Yogurt AI draft holder shape: ${holderShape.id}`,
    `Target canvas draft slot: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${ratioLabel} (${ratio.toFixed(3)} width/height).`,
    'Design the HTML so it fills this iframe size without needing external files.',
    ...referenceLines,
    '',
    'Required tool call after generating the HTML:',
    `- Call insert_cowart_html_draft with draftShapeId: "${holderShape.id}".`,
    '- Pass the final HTML document as htmlContent.',
    '- Use a short .html fileName that describes the draft.',
    '- Leave replaceDraftHolder unset or true so the AI HTML frame becomes the embedded HTML preview.',
    '- If the prompt requests multiple HTML outputs, call insert_cowart_html_draft once per HTML. Use the holder id above only for the first call.',
    '- For each additional HTML, use the previous call result shapeId as draftShapeId and set updateExistingDraft: false, replaceDraftHolder: false, matchAnchor: false, and placement: "right" so the independent HTML embeds are laid out horizontally.',
    '',
    'Prompt:',
    userPrompt.trim()
  ].join('\n')
}

function buildAiSlidesGenerationPrompt({ slidesShape, pageCount, userPrompt, references, referenceAttached }) {
  const referenceLines = aiImageReferenceLines({ references, referenceAttached })

  return [
    AI_SLIDES_GENERATION_PROMPT_PREFIX,
    '',
    `Yogurt AI Slides frame: ${slidesShape.id}`,
    `Required page count: exactly ${pageCount}.`,
    'Create the deck as a coherent sequence with a clear opening, development, and conclusion.',
    ...referenceLines,
    '',
    'Required tool calls after generating the HTML pages:',
    `- Call insert_cowart_html_draft exactly ${pageCount} times, once per page, in page order.`,
    `- For every call set draftShapeId to "${slidesShape.id}".`,
    '- Set replaceDraftHolder: false, updateExistingDraft: false, matchAnchor: false, displayWidth: 1024, and displayHeight: 576.',
    `- Set shapeMeta.cowartAiSlidesParentShapeId to "${slidesShape.id}".`,
    `- Set shapeMeta.cowartAiSlidesGeneratedPageCount to ${pageCount}, and shapeMeta.cowartAiSlidesGeneratedPage to the 1-based page number.`,
    '- Use unique ordered file names such as slide-01.html, slide-02.html, and so on.',
    '- Do not replace or delete the AI Slides frame.',
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

function clipboardImageFiles(event) {
  const clipboardData = event.clipboardData
  if (!clipboardData) return []

  const itemFiles = Array.from(clipboardData.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)

  if (itemFiles.length) return itemFiles
  return Array.from(clipboardData.files || []).filter((file) => file.type.startsWith('image/'))
}

function stopEditorOverlayEvent(event) {
  event.stopPropagation()
}

async function sendAiImageGenerationRequest({ holderShape, userPrompt, referenceFiles = [] }) {
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Yogurt AI 画布没有可用的 Codex MCP 消息桥。')
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
          throw new Error(`参考图无法保存到 Yogurt AI 本地 assets：${error instanceof Error ? error.message : String(error)}`)
        }
        console.warn('Cowart reference image could not be saved; relying on direct image attachment.', error)
      }
    } else if (!referenceAttached) {
      throw new Error('当前 Codex host 没有声明支持图片附件，也没有可用的 Yogurt AI MCP 文件保存桥。')
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

  return sender(
    { prompt, content },
    {
      promptType: 'ai_image',
      aiType: 'image',
      hasReference: imageReferences.length > 0
    }
  )
}

async function sendAiDraftGenerationRequest({ holderShape, userPrompt, referenceFiles = [] }) {
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Yogurt AI 画布没有可用的 Codex MCP 消息桥。')
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
          fileName: referenceFile.name || `draft-reference-${index + 1}.png`,
          dataUrl: referenceDataUrl,
          mimeType: referenceFile.type || undefined
        })
      } catch (error) {
        if (!referenceAttached) {
          throw new Error(`参考图无法保存到 Yogurt AI 本地 assets：${error instanceof Error ? error.message : String(error)}`)
        }
        console.warn('Cowart draft reference image could not be saved; relying on direct image attachment.', error)
      }
    } else if (!referenceAttached) {
      throw new Error('当前 Codex host 没有声明支持图片附件，也没有可用的 Yogurt AI MCP 文件保存桥。')
    }
    references.push({ file: referenceFile, dataUrl: referenceDataUrl, savedReference })
  }

  const prompt = buildAiDraftGenerationPrompt({
    holderShape,
    userPrompt,
    references,
    referenceAttached
  })
  const content = [{ type: 'text', text: prompt }]

  if (referenceAttached) {
    for (const [index, reference] of references.entries()) {
      content.push(dataUrlToImageContent(reference.dataUrl, {
        cowartAiDraftReference: true,
        cowartAiDraftReferenceIndex: index + 1,
        cowartAiDraftHolderShapeId: holderShape.id,
        cowartReferenceFileName: reference.file.name || null,
        cowartReferenceAssetPath: reference.savedReference?.assetPath || null
      }))
    }
  }

  return sender(
    { prompt, content },
    {
      promptType: 'ai_html',
      aiType: 'html',
      hasReference: imageReferences.length > 0
    }
  )
}

async function sendAiSlidesGenerationRequest({ slidesShape, pageCount, userPrompt, referenceFiles = [] }) {
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Yogurt AI 画布没有可用的 Codex MCP 消息桥。')
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
          holderShapeId: slidesShape.id,
          fileName: referenceFile.name || `slides-reference-${index + 1}.png`,
          dataUrl: referenceDataUrl,
          mimeType: referenceFile.type || undefined
        })
      } catch (error) {
        if (!referenceAttached) {
          throw new Error(`参考图无法保存到 Yogurt AI 本地 assets：${error instanceof Error ? error.message : String(error)}`)
        }
        console.warn('Cowart slides reference image could not be saved; relying on direct image attachment.', error)
      }
    } else if (!referenceAttached) {
      throw new Error('当前 Codex host 没有声明支持图片附件，也没有可用的 Yogurt AI MCP 文件保存桥。')
    }
    references.push({ file: referenceFile, dataUrl: referenceDataUrl, savedReference })
  }

  const prompt = buildAiSlidesGenerationPrompt({
    slidesShape,
    pageCount,
    userPrompt,
    references,
    referenceAttached
  })
  const content = [{ type: 'text', text: prompt }]

  if (referenceAttached) {
    for (const [index, reference] of references.entries()) {
      content.push(dataUrlToImageContent(reference.dataUrl, {
        cowartAiSlidesReference: true,
        cowartAiSlidesReferenceIndex: index + 1,
        cowartAiSlidesShapeId: slidesShape.id,
        cowartReferenceFileName: reference.file.name || null,
        cowartReferenceAssetPath: reference.savedReference?.assetPath || null
      }))
    }
  }

  return sender(
    { prompt, content },
    {
      promptType: 'ai_slides',
      aiType: 'slides',
      hasReference: imageReferences.length > 0,
      pageCount
    }
  )
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
        size: 's',
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

    trackAnnotationCreated()
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
    if (isCowartAiHolderShape(shape)) {
      return isAiImageAspectLocked(shape)
    }

    return super.isAspectRatioLocked(shape)
  }
}

const COWART_HTML_DRAFT_EMBED_DEFINITION = {
  type: COWART_HTML_DRAFT_EMBED_TYPE,
  title: AI_DRAFT_HOLDER_LABEL,
  hostnames: ['cowart.local'],
  width: AI_IMAGE_HOLDER_DEFAULT_W,
  height: AI_IMAGE_HOLDER_DEFAULT_H,
  minWidth: 160,
  minHeight: 120,
  doesResize: true,
  backgroundColor: '#ffffff',
  embedOnPaste: false,
  toEmbedUrl(url) {
    if (isCowartHtmlDraftDataUrl(url)) return url
    return cowartHtmlDraftAssetUrlFromVirtualUrl(url) ?? undefined
  },
  fromEmbedUrl(url) {
    if (isCowartHtmlDraftDataUrl(url)) return url
    const assetUrl = cowartHtmlDraftAssetUrlFromVirtualUrl(url)
    return assetUrl ? cowartHtmlDraftVirtualUrl(assetUrl) : undefined
  }
}

function CowartHtmlDraftEmbed({ shape }) {
  const editor = useEditor()
  const directHtmlUrl = isCowartHtmlDraftDataUrl(shape.props.url) ? shape.props.url : null
  const draftAssetUrl =
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape.meta?.cowartHtmlDraftAssetUrl) ||
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape.props.url)
  const isEditing = useIsEditing(shape.id)
  const [htmlSource, setHtmlSource] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [frameLoadVersion, setFrameLoadVersion] = useState(0)

  const handleIframeRef = useCallback(
    (iframe) => {
      if (iframe) {
        cowartHtmlDraftIframes.set(shape.id, iframe)
      } else if (cowartHtmlDraftIframes.get(shape.id)) {
        cowartHtmlDraftIframes.delete(shape.id)
      }
    },
    [shape.id]
  )

  useEffect(() => {
    setHtmlSource(null)
    setLoadError(null)
    // Newly generated drafts already carry their complete HTML as a data URL. Prefer that local
    // source so the first render does not depend on the MCP proxy becoming ready at the same time.
    const shouldReadPageAsset = !directHtmlUrl && draftAssetUrl && hasCowartWidgetBridge()
    const browserSourceUrl = directHtmlUrl || (!shouldReadPageAsset && draftAssetUrl)
    if (!shouldReadPageAsset && !browserSourceUrl) return undefined

    let isDisposed = false

    async function readDraftAssetWithRetry() {
      let lastError = null
      for (const delay of HTML_DRAFT_ASSET_RETRY_DELAYS_MS) {
        if (isDisposed) return null
        if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay))
        if (isDisposed) return null
        try {
          const pageAsset = await readCowartPageAsset(draftAssetUrl)
          return blobFromBase64(pageAsset.dataBase64, pageAsset.mimeType).text()
        } catch (error) {
          lastError = error
        }
      }
      throw lastError || new Error('HTML 草稿加载失败')
    }

    const htmlSourcePromise = shouldReadPageAsset
      ? readDraftAssetWithRetry()
      : window.fetch(browserSourceUrl).then((response) => {
          if (!response.ok) throw new Error(`HTML 草稿加载失败：${response.status}`)
          return response.text()
        })

    htmlSourcePromise
      .then((htmlContent) => {
        if (htmlContent === null) return null
        return hasCowartWidgetBridge() ? hydrateCowartHtmlDraftLocalImages(htmlContent) : htmlContent
      })
      .then((htmlContent) => {
        if (isDisposed || htmlContent === null) return
        setHtmlSource(htmlContent)
      })
      .catch((error) => {
        if (isDisposed) return
        console.warn('Cowart could not load HTML draft asset.', error)
        setLoadError(error instanceof Error ? error.message : 'HTML 草稿加载失败')
      })

    return () => {
      isDisposed = true
    }
  }, [directHtmlUrl, draftAssetUrl])

  const persistDomEdits = useCallback(
    async (htmlContent) => {
      const result = await updateCowartHtmlDraft({ draftShapeId: shape.id, htmlContent })
      const latestShape = editor.getShape(shape.id)
      if (!isCowartHtmlDraftEmbedShape(latestShape)) return
      editor.updateShape({
        id: shape.id,
        type: 'embed',
        meta: {
          ...latestShape.meta,
          ...(result?.assetUrl ? { cowartHtmlDraftAssetUrl: result.assetUrl } : {})
        },
        props: { url: cowartHtmlDraftDataUrl(htmlContent) }
      })
    },
    [editor, shape.id]
  )

  const exitDomEditing = useCallback(() => {
    editor.setEditingShape(null)
    editor.setCurrentTool('select')
  }, [editor])

  useEffect(() => {
    if (!isEditing || !htmlSource) return undefined

    let disposed = false
    let session = null
    waitForHtmlDraftDocument(shape.id)
      .then((iframeDocument) => {
        if (disposed) return
        session = createCowartHtmlDraftDomEditorSession(iframeDocument, {
          onSave: persistDomEdits,
          onRequestExit: exitDomEditing
        })
        cowartHtmlDraftDomEditSessions.set(shape.id, session)
      })
      .catch((error) => console.error('Cowart could not start HTML DOM editing.', error))

    return () => {
      disposed = true
      if (!session) return
      if (cowartHtmlDraftDomEditSessions.get(shape.id) === session) {
        cowartHtmlDraftDomEditSessions.delete(shape.id)
      }
      session
        .dispose({ save: true })
        .catch((error) => console.error('Cowart could not save HTML DOM edits.', error))
    }
  }, [exitDomEditing, frameLoadVersion, htmlSource, isEditing, persistDomEdits, shape.id])

  return (
    <HTMLContainer className="cowart-html-draft-container" id={shape.id}>
      {htmlSource ? (
        <iframe
          ref={handleIframeRef}
          className="cowart-html-draft-frame"
          data-cowart-html-draft-shape-id={shape.id}
          draggable={false}
          frameBorder="0"
          height={toDomPrecision(shape.props.h)}
          onLoad={() => setFrameLoadVersion((version) => version + 1)}
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
          srcDoc={htmlSource}
          tabIndex={isEditing ? 0 : -1}
          title={AI_DRAFT_HOLDER_LABEL}
          width={toDomPrecision(shape.props.w)}
          style={{
            pointerEvents: isEditing ? 'auto' : 'none',
            zIndex: isEditing ? '' : '-1'
          }}
        />
      ) : (
        <div
          className="cowart-html-draft-placeholder"
          style={{
            width: toDomPrecision(shape.props.w),
            height: toDomPrecision(shape.props.h)
          }}
        >
          <span>{loadError || 'HTML 草稿加载中'}</span>
        </div>
      )}
    </HTMLContainer>
  )
}

const CowartConfiguredEmbedShapeUtil = EmbedShapeUtil.configure({
  embedDefinitions: [COWART_HTML_DRAFT_EMBED_DEFINITION, ...DEFAULT_EMBED_DEFINITIONS]
})

class CowartEmbedShapeUtil extends CowartConfiguredEmbedShapeUtil {
  component(shape) {
    if (isCowartHtmlDraftEmbedShape(shape)) {
      return <CowartHtmlDraftEmbed shape={shape} />
    }

    return super.component(shape)
  }
}

const CowartGeoShapeUtil = GeoShapeUtil.configure({
  customGeoTypes: {
    [COWART_CARD_GEO]: {
      getPath(w, h) {
        const radius = Math.min(10, w / 4, h / 4)
        return new PathBuilder()
          .moveTo(radius, 0)
          .lineTo(w - radius, 0)
          .circularArcTo(radius, false, true, w, radius)
          .lineTo(w, h - radius)
          .circularArcTo(radius, false, true, w - radius, h)
          .lineTo(radius, h)
          .circularArcTo(radius, false, true, 0, h - radius)
          .lineTo(0, radius)
          .circularArcTo(radius, false, true, radius, 0)
          .close()
      },
      snapType: 'polygon',
      icon: 'geo-rectangle',
      defaultSize: { w: 240, h: 120 }
    }
  },
  getCustomDisplayValues(_editor, shape) {
    const labelFontSize = getCowartFontSizeOverride(shape)
    return labelFontSize ? { labelFontSize } : {}
  }
})

const CowartNoteShapeUtil = NoteShapeUtil.configure({
  getCustomDisplayValues(_editor, shape) {
    const labelFontSize = getCowartFontSizeOverride(shape)
    return labelFontSize ? { labelFontSize } : {}
  }
})

const CowartArrowShapeUtil = ArrowShapeUtil.configure({
  getCustomDisplayValues(_editor, shape) {
    const labelFontSize = getCowartFontSizeOverride(shape)
    return labelFontSize ? { labelFontSize } : {}
  }
})

const cowartShapeUtils = [
  CowartFrameShapeUtil,
  CowartEmbedShapeUtil,
  CowartGeoShapeUtil,
  CowartNoteShapeUtil,
  CowartArrowShapeUtil
]

const cowartUiOverrides = {
  actions(editor, actions, helpers) {
    const defaultDownloadOriginal = actions['download-original']
    const defaultCopyAsPng = actions['copy-as-png']
    return {
      ...actions,
      'copy-as-png': {
        ...defaultCopyAsPng,
        async onSelect(source) {
          // Codex widgets run inside an iframe where the host can deny the browser Clipboard API.
          // Render in the widget, then hand the PNG to the local MCP process for the native write.
          if (!hasCowartWidgetBridge()) {
            return defaultCopyAsPng.onSelect(source)
          }

          let shapeIds = editor.getSelectedShapeIds()
          if (shapeIds.length === 0) {
            shapeIds = Array.from(editor.getCurrentPageShapeIds())
          }
          if (shapeIds.length === 0) return

          try {
            const onlyShape = shapeIds.length === 1 ? editor.getShape(shapeIds[0]) : null
            let image
            if (isCowartHtmlDraftEmbedShape(onlyShape)) {
              const bounds = new Box(
                0,
                0,
                Number(onlyShape.props?.w) || 1,
                Number(onlyShape.props?.h) || 1
              )
              image = await renderCowartHtmlDraftCanvas(
                onlyShape,
                getAnnotationEditExportPixelRatio(bounds)
              )
            } else {
              image = await editor.toImageDataUrl(shapeIds, { format: 'png' })
            }
            const result = await copyCowartImageToClipboard({
              dataUrl: image.url,
              mimeType: 'image/png'
            })
            helpers.addToast({
              title: 'PNG 已复制',
              description: `${result.width} × ${result.height}，可直接粘贴到其他应用。`,
              severity: 'success'
            })
          } catch (error) {
            console.error(error)
            helpers.addToast({
              id: 'copy-fail',
              title: '复制失败',
              description: error instanceof Error ? error.message : '无法复制图像。',
              severity: 'error'
            })
          }
        }
      },
      'download-original': {
        ...defaultDownloadOriginal,
        async onSelect(source) {
          if (!hasCowartWidgetBridge()) {
            return defaultDownloadOriginal.onSelect(source)
          }

          const imageShapes = editor.getSelectedShapes().filter(isImageShape)
          if (!imageShapes.length) return

          try {
            const results = []
            for (const imageShape of imageShapes) {
              results.push(await downloadCowartImageShape(editor, imageShape))
            }
            helpers.addToast({
              title: imageShapes.length === 1 ? '图片已下载' : `${imageShapes.length} 张图片已下载`,
              description: results[0]?.filePath || '文件已保存到系统下载目录。',
              severity: 'success'
            })
          } catch (error) {
            console.error(error)
            helpers.addToast({
              title: '图片下载失败',
              description: error instanceof Error ? error.message : '请稍后重试。',
              severity: 'error'
            })
          }
        }
      }
    }
  },
  translations: {
    en: {
      'tool.ai-image': AI_IMAGE_HOLDER_LABEL,
      'tool.ai-draft': AI_DRAFT_HOLDER_LABEL,
      'tool.ai-slides': AI_SLIDES_LABEL,
      'tool.cowart-annotation': ANNOTATION_TOOL_LABEL,
      'tool.cowart-agent-lasso': COWART_AGENT_LASSO_TOOL_LABEL
    },
    'zh-cn': {
      'tool.ai-image': AI_IMAGE_HOLDER_LABEL,
      'tool.ai-draft': AI_DRAFT_HOLDER_LABEL,
      'tool.ai-slides': AI_SLIDES_LABEL,
      'tool.cowart-annotation': ANNOTATION_TOOL_LABEL,
      'tool.cowart-agent-lasso': COWART_AGENT_LASSO_TOOL_LABEL
    }
  },
  tools(editor, tools) {
    return {
      ...tools,
      [AI_IMAGE_TOOL_ID]: {
        id: AI_IMAGE_TOOL_ID,
        label: 'tool.ai-image',
        icon: aiImageToolIcon,
        kbd: undefined,
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
      [AI_DRAFT_TOOL_ID]: {
        id: AI_DRAFT_TOOL_ID,
        label: 'tool.ai-draft',
        icon: aiHtmlToolIcon,
        onSelect() {
          createAiDraftHolderAtViewportCenter(editor)
        },
        onDragStart(source, info) {
          const scale = editor.getResizeScaleFactor()
          onDragFromToolbarToCreateShape(editor, info, {
            createShape: (id) =>
              createAiDraftHolderShape(editor, id, {
                props: {
                  w: AI_DRAFT_HOLDER_DEFAULT_W * scale,
                  h: AI_DRAFT_HOLDER_DEFAULT_H * scale
                }
              }),
            onDragEnd: (id) => editor.select(id)
          })
        },
        meta: {
          cowartTool: 'ai-draft-holder'
        }
      },
      [AI_SLIDES_TOOL_ID]: {
        id: AI_SLIDES_TOOL_ID,
        label: 'tool.ai-slides',
        icon: aiSlidesToolIcon,
        onSelect() {
          createAiSlidesAtViewportCenter(editor)
        },
        onDragStart(source, info) {
          const scale = editor.getResizeScaleFactor()
          onDragFromToolbarToCreateShape(editor, info, {
            createShape: (id) =>
              createAiSlidesShape(editor, id, {
                props: {
                  w: AI_SLIDES_DEFAULT_W * scale,
                  h: AI_SLIDES_DEFAULT_H * scale
                }
              }),
            onDragEnd: (id) => editor.select(id)
          })
        },
        meta: {
          cowartTool: 'ai-slides'
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
      },
      [COWART_AGENT_LASSO_TOOL_ID]: {
        id: COWART_AGENT_LASSO_TOOL_ID,
        label: 'tool.cowart-agent-lasso',
        icon: agentLassoToolIcon,
        kbd: undefined,
        onSelect() {
          unlockGlobalToolLock(editor)
          editor.setCurrentTool(COWART_AGENT_LASSO_TOOL_ID)
        },
        meta: {
          cowartTool: 'agent-lasso'
        }
      }
    }
  }
}

const cowartComponents = {
  Toolbar: CowartToolbar,
  ImageToolbar: CowartSelectionToolbar,
  InFrontOfTheCanvas: CowartCanvasOverlay,
  StylePanel: CowartStylePanel
}

function CowartCanvasOverlay() {
  return (
    <>
      <ExcalidrawCowartChrome
        htmlIcon={aiHtmlToolIcon}
        imageIcon={aiImageToolIcon}
        onCreateHtml={createAiDraftHolderAtViewportCenter}
        onCreateImage={createAiImageHolderAtViewportCenter}
        onCreateSlides={createAiSlidesAtViewportCenter}
        onExportCanvasHtml={(editor) => exportCowartCanvas(editor, 'html')}
        onExportCanvasPptx={(editor) => exportCowartCanvas(editor, 'pptx')}
        slidesIcon={aiSlidesToolIcon}
      />
      <CowartThinkingReviewToolbar />
      <CowartAiImageGenerationPanel />
      <CowartAiDraftGenerationPanel />
      <CowartAiSlidesGenerationPanel />
      <CowartSlidesPresentationOverlay />
    </>
  )
}

function isInteractiveHtmlClick(event) {
  if (event.defaultPrevented || event.cancelBubble) return true
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return true

  const interactiveSelector = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    'video',
    'audio',
    'canvas',
    '[contenteditable="true"]',
    '[onclick]',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]'
  ].join(',')
  const target = event.target
  if (target?.closest?.(interactiveSelector)) return true

  const win = target?.ownerDocument?.defaultView
  let element = target?.nodeType === 1 ? target : target?.parentElement
  while (element && element !== target?.ownerDocument?.documentElement) {
    if (win?.getComputedStyle(element).cursor === 'pointer') return true
    element = element.parentElement
  }

  return false
}

function CowartSlidesMedia({ onUnhandledHtmlClick, shape, title }) {
  const editor = useEditor()
  const iframeClickCleanupRef = useRef(null)
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let disposed = false
    setSource(null)
    setError(null)

    async function loadSource() {
      if (isImageShape(shape)) {
        const asset = shape.props?.assetId ? editor.getAsset(shape.props.assetId) : null
        const assetSource = asset?.props?.src
        if (!asset || !assetSource) throw new Error('图片资源不可用')

        if (assetSource.startsWith(PAGE_ASSETS_ROUTE) && hasCowartWidgetBridge()) {
          const pageAsset = await readCowartPageAsset(assetSource)
          return {
            kind: 'image',
            url: `data:${pageAsset.mimeType};base64,${pageAsset.dataBase64}`
          }
        }

        if (assetSource.startsWith('data:') || /^https?:\/\//.test(assetSource)) {
          return { kind: 'image', url: assetSource }
        }

        const resolvedUrl = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
        if (!resolvedUrl) throw new Error('图片资源无法解析')
        return { kind: 'image', url: resolvedUrl }
      }

      if (isCowartHtmlDraftEmbedShape(shape)) {
        const directHtmlUrl = isCowartHtmlDraftDataUrl(shape.props.url) ? shape.props.url : null
        if (directHtmlUrl) {
          if (!hasCowartWidgetBridge()) return { kind: 'html-url', url: directHtmlUrl }
          const response = await window.fetch(directHtmlUrl)
          if (!response.ok) throw new Error(`HTML 草稿加载失败：${response.status}`)
          return {
            kind: 'html',
            htmlContent: await hydrateCowartHtmlDraftLocalImages(await response.text())
          }
        }

        const assetUrl =
          cowartHtmlDraftAssetUrlFromVirtualUrl(shape.meta?.cowartHtmlDraftAssetUrl) ||
          cowartHtmlDraftAssetUrlFromVirtualUrl(shape.props.url)
        if (!assetUrl) throw new Error('HTML 草稿资源不可用')

        if (hasCowartWidgetBridge()) {
          const pageAsset = await readCowartPageAsset(assetUrl)
          const htmlContent = await blobFromBase64(pageAsset.dataBase64, pageAsset.mimeType).text()
          return {
            kind: 'html',
            htmlContent: await hydrateCowartHtmlDraftLocalImages(htmlContent)
          }
        }

        const response = await window.fetch(assetUrl)
        if (!response.ok) throw new Error(`HTML 草稿加载失败：${response.status}`)
        return { kind: 'html', htmlContent: await response.text() }
      }

      throw new Error('不支持的 Slides 页面类型')
    }

    loadSource()
      .then((nextSource) => {
        if (!disposed) setSource(nextSource)
      })
      .catch((nextError) => {
        if (!disposed) setError(nextError instanceof Error ? nextError.message : '页面加载失败')
      })

    return () => {
      disposed = true
    }
  }, [editor, shape.id, shape.props?.assetId, shape.props?.url, shape.meta?.cowartHtmlDraftAssetUrl])

  useEffect(
    () => () => {
      iframeClickCleanupRef.current?.()
      iframeClickCleanupRef.current = null
    },
    []
  )

  function handleHtmlFrameLoad(event) {
    iframeClickCleanupRef.current?.()
    iframeClickCleanupRef.current = null
    if (!onUnhandledHtmlClick) return

    try {
      const iframeDocument = event.currentTarget.contentDocument
      const iframeWindow = iframeDocument?.defaultView
      if (!iframeDocument || !iframeWindow) return

      const pendingTimers = new Set()
      function handleHtmlClick(clickEvent) {
        const timer = iframeWindow.setTimeout(() => {
          pendingTimers.delete(timer)
          if (!isInteractiveHtmlClick(clickEvent)) onUnhandledHtmlClick()
        }, 0)
        pendingTimers.add(timer)
      }

      iframeDocument.addEventListener('click', handleHtmlClick)
      iframeClickCleanupRef.current = () => {
        iframeDocument.removeEventListener('click', handleHtmlClick)
        for (const timer of pendingTimers) iframeWindow.clearTimeout(timer)
        pendingTimers.clear()
      }
    } catch (_error) {
      // Cross-origin HTML keeps its own interactions; keyboard navigation remains available.
    }
  }

  if (source?.kind === 'image') {
    return <img alt={title} className="cowart-slides-media" draggable={false} src={source.url} />
  }

  if (source?.kind === 'html' || source?.kind === 'html-url') {
    return (
      <iframe
        className="cowart-slides-media"
        frameBorder="0"
        onLoad={handleHtmlFrameLoad}
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
        src={source.kind === 'html-url' ? source.url : undefined}
        srcDoc={source.kind === 'html' ? source.htmlContent : undefined}
        tabIndex={-1}
        title={title}
      />
    )
  }

  return <div className="cowart-slides-media-status">{error || 'Loading'}</div>
}

function CowartSlidesScaledMedia({ className = '', onUnhandledHtmlClick, shape, title }) {
  const containerRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const width = Math.max(1, Number(shape.props?.w) || 16)
  const height = Math.max(1, Number(shape.props?.h) || 9)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    function updateSize() {
      const bounds = container.getBoundingClientRect()
      setContainerSize((currentSize) => {
        if (currentSize.width === bounds.width && currentSize.height === bounds.height) {
          return currentSize
        }
        return { width: bounds.width, height: bounds.height }
      })
    }

    updateSize()
    const ResizeObserverClass = container.ownerDocument.defaultView?.ResizeObserver
    if (!ResizeObserverClass) return undefined

    const resizeObserver = new ResizeObserverClass(updateSize)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  const scale = Math.min(containerSize.width / width, containerSize.height / height)
  const scaledWidth = width * scale
  const scaledHeight = height * scale

  return (
    <span className={`cowart-slides-media-viewport ${className}`.trim()} ref={containerRef}>
      {scale > 0 && (
        <span
          className="cowart-slides-media-canvas"
          style={{
            height: `${height}px`,
            left: `${(containerSize.width - scaledWidth) / 2}px`,
            top: `${(containerSize.height - scaledHeight) / 2}px`,
            transform: `scale(${scale})`,
            width: `${width}px`
          }}
        >
          <CowartSlidesMedia
            onUnhandledHtmlClick={onUnhandledHtmlClick}
            shape={shape}
            title={title}
          />
        </span>
      )}
    </span>
  )
}

function CowartSlidesPresentationOverlay() {
  const editor = useEditor()
  const overlayRef = useRef(null)
  const [slidesShapeId, setSlidesShapeId] = useState(null)
  const [index, setIndex] = useState(0)
  const [isPresenting, setIsPresenting] = useState(false)

  const slidesShape = useValue(
    'cowart active slides presentation frame',
    () => (slidesShapeId ? editor.getShape(slidesShapeId) : null),
    [editor, slidesShapeId]
  )
  const slides = useValue(
    'cowart active slides presentation items',
    () => (slidesShapeId ? getAiSlidesItems(editor, slidesShapeId) : []),
    [editor, slidesShapeId]
  )
  const currentSlide = slides[index] || null
  const total = slides.length

  useEffect(() => {
    function handleOpen(event) {
      const nextSlidesShapeId = event.detail?.slidesShapeId
      if (!nextSlidesShapeId || !isAiSlidesShape(editor.getShape(nextSlidesShapeId))) return
      layoutAiSlides(editor, nextSlidesShapeId)
      setSlidesShapeId(nextSlidesShapeId)
      setIndex(0)
      setIsPresenting(false)
    }

    const doc = editor.getContainerDocument()
    doc.addEventListener(COWART_OPEN_SLIDES_EVENT, handleOpen)
    return () => doc.removeEventListener(COWART_OPEN_SLIDES_EVENT, handleOpen)
  }, [editor])

  useEffect(() => {
    if (index < total) return
    setIndex(Math.max(0, total - 1))
  }, [index, total])

  useEffect(() => {
    function handleFullscreenChange() {
      if (editor.getContainerDocument().fullscreenElement !== overlayRef.current) {
        setIsPresenting(false)
      }
    }

    const doc = editor.getContainerDocument()
    doc.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => doc.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [editor])

  useEffect(() => {
    if (!slidesShapeId) return undefined

    const container = editor.getContainer()
    container.classList.add('cowart-slides-mode')
    return () => container.classList.remove('cowart-slides-mode')
  }, [editor, slidesShapeId])

  const go = useCallback(
    (delta) => setIndex((value) => Math.max(0, Math.min(total - 1, value + delta))),
    [total]
  )
  const handleUnhandledHtmlClick = useCallback(() => go(1), [go])

  useEffect(() => {
    if (!slidesShapeId) return undefined

    function handleKeyDown(event) {
      const target = event.target
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (isPresenting) {
          exitPresentation()
        } else {
          closeViewer()
        }
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        go(-1)
      }
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        go(1)
      }
    }

    const doc = editor.getContainerDocument()
    doc.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => doc.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [editor, go, isPresenting, slidesShapeId])

  async function exitPresentation() {
    setIsPresenting(false)
    const doc = editor.getContainerDocument()
    if (doc.fullscreenElement === overlayRef.current) {
      try {
        await doc.exitFullscreen()
      } catch (_error) {
        // The browser may already be exiting fullscreen.
      }
    }
  }

  function closeViewer() {
    setSlidesShapeId(null)
    void exitPresentation()
  }

  async function playSlides() {
    if (!currentSlide) return
    setIsPresenting(true)
    if (!editor.getContainerDocument().fullscreenElement) {
      try {
        await overlayRef.current?.requestFullscreen({ navigationUI: 'hide' })
      } catch (_error) {
        // Keep the clean in-widget presentation view if fullscreen is unavailable.
      }
    }
  }

  function handlePresentStageClick(event) {
    if (event.target.closest('.cowart-slides-present-controls')) return
    go(1)
  }

  if (!slidesShapeId || !isAiSlidesShape(slidesShape)) return null

  const deckName = slidesShape.props?.name || AI_SLIDES_LABEL
  return (
    <section
      ref={overlayRef}
      aria-label="AI Slides 演示器"
      className={`cowart-slides-viewer${isPresenting ? ' is-presenting' : ''}`}
      onClick={stopEditorOverlayEvent}
      onDoubleClick={stopEditorOverlayEvent}
      onPointerDown={stopEditorOverlayEvent}
    >
      {isPresenting && currentSlide ? (
        <div className="cowart-slides-present-stage" onClick={handlePresentStageClick}>
          <div className="cowart-slides-present-slide">
            <CowartSlidesScaledMedia
              className="cowart-slides-present-media"
              onUnhandledHtmlClick={handleUnhandledHtmlClick}
              shape={currentSlide}
              title={`第 ${index + 1} 页`}
            />
          </div>
          <div className="cowart-slides-present-controls" onClick={stopEditorOverlayEvent}>
            <button aria-label="上一页" disabled={index === 0} onClick={() => go(-1)} type="button">
              <ChevronLeft aria-hidden="true" size={15} strokeWidth={2} />
            </button>
            <span>{index + 1} / {total}</span>
            <button aria-label="下一页" disabled={index >= total - 1} onClick={() => go(1)} type="button">
              <ChevronRight aria-hidden="true" size={15} strokeWidth={2} />
            </button>
            <button aria-label="退出播放" onClick={exitPresentation} type="button">
              <X aria-hidden="true" size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className="cowart-slides-viewer-header">
            <div className="cowart-slides-viewer-identity">
              <button
                aria-label="关闭演示页"
                className="cowart-slides-close-button"
                onClick={closeViewer}
                type="button"
              >
                <X aria-hidden="true" size={18} strokeWidth={2} />
              </button>
              <span aria-hidden="true" className="cowart-slides-header-divider" />
              <div className="cowart-slides-deck-name">{deckName}</div>
            </div>
            <nav aria-label="翻页控制" className="cowart-slides-page-nav">
              <button aria-label="上一页" disabled={index === 0 || !total} onClick={() => go(-1)} type="button">
                <ChevronLeft aria-hidden="true" size={18} strokeWidth={2} />
              </button>
              <span>{total ? `${index + 1} / ${total}` : '0 / 0'}</span>
              <button aria-label="下一页" disabled={index >= total - 1 || !total} onClick={() => go(1)} type="button">
                <ChevronRight aria-hidden="true" size={18} strokeWidth={2} />
              </button>
            </nav>
            <div className="cowart-slides-viewer-actions">
              <button disabled={!currentSlide} onClick={playSlides} type="button">
                <Play aria-hidden="true" size={15} strokeWidth={2} />
                播放
              </button>
            </div>
          </header>
          <div className="cowart-slides-viewer-body">
            <aside aria-label="Slides 页面预览" className="cowart-slides-thumbnails">
              {slides.map((slide, slideIndex) => {
                const width = Math.max(1, Number(slide.props?.w) || 16)
                const height = Math.max(1, Number(slide.props?.h) || 9)
                return (
                  <button
                    aria-label={`跳转到第 ${slideIndex + 1} 页`}
                    className={slideIndex === index ? 'is-active' : ''}
                    key={slide.id}
                    onClick={() => setIndex(slideIndex)}
                    type="button"
                  >
                    <span>{slideIndex + 1}</span>
                    <span className="cowart-slides-thumb-shell" style={{ aspectRatio: `${width} / ${height}` }}>
                      <CowartSlidesScaledMedia
                        className="cowart-slides-thumb-viewport"
                        shape={slide}
                        title={`第 ${slideIndex + 1} 页预览`}
                      />
                    </span>
                  </button>
                )
              })}
            </aside>
            <main className="cowart-slides-main-stage">
              {currentSlide ? (
                <div className="cowart-slides-current-slide">
                  <CowartSlidesScaledMedia
                    className="cowart-slides-current-media"
                    shape={currentSlide}
                    title={`第 ${index + 1} 页`}
                  />
                </div>
              ) : (
                <div className="cowart-slides-empty">把图片或 HTML 草稿拖入 AI Slides 后即可演示。</div>
              )}
            </main>
          </div>
        </>
      )}
    </section>
  )
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

  function handlePromptPaste(event) {
    const imageFiles = clipboardImageFiles(event)
    if (!imageFiles.length) return

    event.preventDefault()
    stopEditorOverlayEvent(event)

    const availableSlots = Math.max(0, AI_IMAGE_REFERENCE_MAX_FILES - referenceFiles.length)
    if (!availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
      return
    }

    setReferenceFiles((currentFiles) => [
      ...currentFiles,
      ...imageFiles.slice(0, availableSlots)
    ].slice(0, AI_IMAGE_REFERENCE_MAX_FILES))
    if (imageFiles.length > availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
    } else {
      setStatus('idle')
      setErrorMessage('')
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
          onPaste={handlePromptPaste}
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

function CowartAiDraftGenerationPanel() {
  const editor = useEditor()
  const selectedTarget = useValue(
    'selected ai draft holder generation panel target',
    () => {
      const shape = editor.getOnlySelectedShape()
      if (!isAiDraftHolderShape(shape)) return null

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
      await sendAiDraftGenerationRequest({
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

  function handlePromptPaste(event) {
    const imageFiles = clipboardImageFiles(event)
    if (!imageFiles.length) return

    event.preventDefault()
    stopEditorOverlayEvent(event)

    const availableSlots = Math.max(0, AI_IMAGE_REFERENCE_MAX_FILES - referenceFiles.length)
    if (!availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
      return
    }

    setReferenceFiles((currentFiles) => [
      ...currentFiles,
      ...imageFiles.slice(0, availableSlots)
    ].slice(0, AI_IMAGE_REFERENCE_MAX_FILES))
    if (imageFiles.length > availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
    } else {
      setStatus('idle')
      setErrorMessage('')
    }
  }

  return (
    <div className="cowart-ai-generation-overlay" aria-hidden={false}>
      <form
        aria-label="AI HTML 生成"
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
          onPaste={handlePromptPaste}
          placeholder="描述你想生成的 HTML"
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
            aria-label="发送草稿请求"
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

function CowartAiSlidesGenerationPanel() {
  const editor = useEditor()
  const selectedTarget = useValue(
    'selected empty ai slides generation panel target',
    () => {
      const shape = editor.getOnlySelectedShape()
      if (!isAiSlidesShape(shape) || getAiSlidesItems(editor, shape.id).length > 0) return null

      editor.getCamera()
      editor.getViewportScreenBounds()

      const layout = getAiImageGenerationPanelLayout(editor, shape.id)
      return layout ? { shape, layout } : null
    },
    [editor]
  )
  const fileInputRef = useRef(null)
  const customPageCountInputRef = useRef(null)
  const pageCountMenuRef = useRef(null)
  const [promptValue, setPromptValue] = useState('')
  const [referenceFiles, setReferenceFiles] = useState([])
  const [referencePreviews, setReferencePreviews] = useState([])
  const [pageCountMode, setPageCountMode] = useState('5')
  const [customPageCount, setCustomPageCount] = useState('5')
  const [isPageCountMenuOpen, setIsPageCountMenuOpen] = useState(false)
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    setStatus('idle')
    setErrorMessage('')
    setPageCountMode('5')
    setCustomPageCount('5')
    setIsPageCountMenuOpen(false)
  }, [selectedTarget?.shape.id])

  useEffect(() => {
    if (!isPageCountMenuOpen) return undefined

    function handlePointerDown(event) {
      if (!pageCountMenuRef.current?.contains(event.target)) setIsPageCountMenuOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsPageCountMenuOpen(false)
    }

    const doc = editor.getContainerDocument()
    doc.addEventListener('pointerdown', handlePointerDown, true)
    doc.addEventListener('keydown', handleKeyDown, true)
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true)
      doc.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [editor, isPageCountMenuOpen])

  useEffect(() => {
    if (pageCountMode !== 'custom') return
    customPageCountInputRef.current?.focus()
    customPageCountInputRef.current?.select()
  }, [pageCountMode])

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
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview.url))
  }, [referenceFiles])

  if (!selectedTarget) return null

  const { shape, layout } = selectedTarget
  const parsedCustomPageCount = Math.round(Number(customPageCount))
  const pageCount = pageCountMode === 'custom'
    ? clampNumber(Number.isFinite(parsedCustomPageCount) ? parsedCustomPageCount : 1, 1, 50)
    : Number(pageCountMode)
  const pageCountLabel = pageCountMode === 'custom' ? '自定义' : `${pageCountMode} 页`
  const canSend = promptValue.trim().length > 0 || referenceFiles.length > 0
  const isSending = status === 'sending'

  function addReferenceFiles(files) {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith('image/'))
    const availableSlots = Math.max(0, AI_IMAGE_REFERENCE_MAX_FILES - referenceFiles.length)
    if (!availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
      return
    }

    setReferenceFiles((currentFiles) => [
      ...currentFiles,
      ...imageFiles.slice(0, availableSlots)
    ].slice(0, AI_IMAGE_REFERENCE_MAX_FILES))
    if (imageFiles.length > availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
    } else {
      setStatus('idle')
      setErrorMessage('')
    }
  }

  function handleReferenceChange(event) {
    const selectedFiles = Array.from(event.target.files || [])
    if (selectedFiles.some((file) => !file.type.startsWith('image/'))) {
      setStatus('error')
      setErrorMessage('请选择图片文件。')
    } else {
      addReferenceFiles(selectedFiles)
    }
    event.target.value = ''
  }

  function clearReferences() {
    setReferenceFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeReferenceAt(indexToRemove) {
    setReferenceFiles((currentFiles) => currentFiles.filter((_file, index) => index !== indexToRemove))
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
      await sendAiSlidesGenerationRequest({
        slidesShape: shape,
        pageCount,
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
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') handleSubmit(event)
  }

  function handlePromptPaste(event) {
    const imageFiles = clipboardImageFiles(event)
    if (!imageFiles.length) return
    event.preventDefault()
    stopEditorOverlayEvent(event)
    addReferenceFiles(imageFiles)
  }

  return (
    <div className="cowart-ai-generation-overlay" aria-hidden={false}>
      <form
        aria-label="AI Slides 生成"
        className="cowart-ai-generation-panel cowart-ai-slides-generation-panel"
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
          aria-label="自定义 Slides prompt"
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
          onPaste={handlePromptPaste}
          placeholder="描述你想生成的 Slides，或是将图片和 HTML 放进 Slides..."
          rows={3}
          value={promptValue}
        />

        <div className="cowart-ai-generation-footer">
          <div className="cowart-ai-generation-status" aria-live="polite">
            {status === 'sending' ? '正在发送' : status === 'sent' ? '已发送' : errorMessage}
          </div>
          <div className="cowart-ai-slides-generation-actions">
            <div className="cowart-ai-slides-page-count-menu" ref={pageCountMenuRef}>
              <button
                aria-expanded={isPageCountMenuOpen}
                aria-haspopup="listbox"
                className="cowart-ai-slides-page-count-trigger"
                disabled={isSending}
                onClick={() => setIsPageCountMenuOpen((isOpen) => !isOpen)}
                type="button"
              >
                <span className="cowart-ai-slides-page-count-label">页数</span>
                <span>{pageCountLabel}</span>
                <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
              </button>
              {isPageCountMenuOpen && (
                <div aria-label="Slides 页数" className="cowart-ai-slides-page-count-popover" role="listbox">
                  {[
                    ['3', '3 页'],
                    ['5', '5 页'],
                    ['10', '10 页'],
                    ['custom', '自定义']
                  ].map(([value, label]) => (
                    <button
                      aria-selected={pageCountMode === value}
                      className="cowart-ai-slides-page-count-option"
                      key={value}
                      onClick={() => {
                        setPageCountMode(value)
                        setIsPageCountMenuOpen(false)
                      }}
                      role="option"
                      type="button"
                    >
                      <Check
                        aria-hidden="true"
                        className={pageCountMode === value ? 'is-visible' : ''}
                        size={14}
                        strokeWidth={2.25}
                      />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {pageCountMode === 'custom' && (
              <input
                ref={customPageCountInputRef}
                aria-label="自定义 Slides 页数"
                className="cowart-ai-slides-custom-page-count"
                disabled={isSending}
                inputMode="numeric"
                max="50"
                min="1"
                onChange={(event) => setCustomPageCount(event.target.value)}
                type="number"
                value={customPageCount}
              />
            )}
            <button
              aria-label="发送 Slides 生成请求"
              className="cowart-ai-generation-send"
              disabled={!canSend || isSending}
              type="submit"
            >
              <span>{isSending ? '发送中' : '发送'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function CowartStylePanel(props) {
  return (
    <DefaultStylePanel {...props}>
      <DefaultStylePanelContent />
      <CowartTypographyStyleControls />
      <CowartAiImageStyleControls />
    </DefaultStylePanel>
  )
}

function CowartTypographyStyleControls() {
  const editor = useEditor()
  const selection = useValue(
    'selected cowart typography shapes',
    () => {
      const themeFontSize = editor.getCurrentTheme().fontSize
      const shapes = editor
        .getSelectedShapeIds()
        .map((shapeId) => editor.getShape(shapeId))
        .filter(isCowartTypographyShape)

      return {
        themeFontSize,
        shapes,
        fontSizes: shapes.map((shape) => getCowartEffectiveFontSize(shape, themeFontSize))
      }
    },
    [editor]
  )
  const [inputValue, setInputValue] = useState('')

  const roundedFontSizes = selection.fontSizes.map((fontSize) => Math.round(fontSize ?? 0))
  const sharedFontSize = roundedFontSizes.every((fontSize) => fontSize === roundedFontSizes[0])
    ? roundedFontSizes[0]
    : null
  const selectionSignature = selection.shapes
    .map((shape, index) => `${shape.id}:${roundedFontSizes[index]}`)
    .join('|')
  const hasCustomFontSize = selection.shapes.some((shape) =>
    shape.type === 'text'
      ? Math.abs(Number(shape.props.scale ?? 1) - 1) > 0.001
      : getCowartFontSizeOverride(shape) !== null
  )

  useEffect(() => {
    setInputValue(sharedFontSize === null ? '' : String(sharedFontSize))
  }, [selectionSignature, sharedFontSize])

  if (selection.shapes.length === 0) return null

  function getFontSizeUpdate(shape, fontSize) {
    if (shape.type === 'text') {
      const nativeFontSize = getCowartNativeFontSize(shape, selection.themeFontSize)
      if (!nativeFontSize) return null
      return {
        id: shape.id,
        type: shape.type,
        props: { scale: fontSize / nativeFontSize }
      }
    }

    return {
      id: shape.id,
      type: shape.type,
      meta: withCowartFontSizeMeta(shape, fontSize),
      ...(shape.type === 'note' ? { props: { fontSizeAdjustment: null } } : {})
    }
  }

  function applyFontSize(value, { markHistory = true } = {}) {
    const nextFontSize = clampCowartFontSize(value)
    if (nextFontSize === null) {
      setInputValue(sharedFontSize === null ? '' : String(sharedFontSize))
      return
    }

    const updates = selection.shapes
      .map((shape) => getFontSizeUpdate(shape, nextFontSize))
      .filter(Boolean)
    if (updates.length === 0) return

    if (markHistory) editor.markHistoryStoppingPoint(`set-cowart-font-size:${nextFontSize}`)
    editor.updateShapes(updates)
    setInputValue(String(nextFontSize))
  }

  function resetFontSize() {
    editor.markHistoryStoppingPoint('reset-cowart-font-size')
    editor.updateShapes(
      selection.shapes.map((shape) => ({
        id: shape.id,
        type: shape.type,
        ...(shape.type === 'text'
          ? { props: { scale: 1 } }
          : {
              meta: withoutCowartFontSizeMeta(shape),
              ...(shape.type === 'note' ? { props: { fontSizeAdjustment: null } } : {})
            })
      }))
    )
  }

  function handleInputKeyDown(event) {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') {
      setInputValue(sharedFontSize === null ? '' : String(sharedFontSize))
      event.currentTarget.blur()
    }
  }

  const sliderValue = sharedFontSize ?? (Number(inputValue) || 24)

  return (
    <section className="cowart-typography-panel" aria-label="文字大小">
      <div className="cowart-typography-heading">
        <div>
          <strong>字号</strong>
          <span>{selection.shapes.length > 1 ? `${selection.shapes.length} 个对象` : '8–240 px'}</span>
        </div>
        <button disabled={!hasCustomFontSize} onClick={resetFontSize} type="button">
          恢复默认
        </button>
      </div>

      <div className="cowart-typography-size-row">
        <input
          aria-label="字号滑块"
          max={COWART_FONT_SIZE_MAX}
          min={COWART_FONT_SIZE_MIN}
          onChange={(event) => applyFontSize(event.target.value, { markHistory: false })}
          onKeyDown={() => editor.markHistoryStoppingPoint('adjust-cowart-font-size')}
          onPointerDown={() => editor.markHistoryStoppingPoint('adjust-cowart-font-size')}
          step="1"
          type="range"
          value={Math.min(COWART_FONT_SIZE_MAX, Math.max(COWART_FONT_SIZE_MIN, sliderValue))}
        />
        <label className="cowart-typography-number-field">
          <input
            aria-label="字号数值"
            inputMode="numeric"
            max={COWART_FONT_SIZE_MAX}
            min={COWART_FONT_SIZE_MIN}
            onBlur={(event) => applyFontSize(event.target.value)}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={sharedFontSize === null ? '混合' : undefined}
            type="number"
            value={inputValue}
          />
          <span>px</span>
        </label>
      </div>

      <div className="cowart-typography-presets" aria-label="字号预设">
        {COWART_FONT_SIZE_PRESETS.map((fontSize) => (
          <button
            key={fontSize}
            aria-pressed={sharedFontSize === fontSize}
            onClick={() => applyFontSize(fontSize)}
            type="button"
          >
            {fontSize}
          </button>
        ))}
      </div>
      <p>仅调整文字，不改变卡片边框和箭头粗细。</p>
    </section>
  )
}

function CowartAiImageStyleControls() {
  const editor = useEditor()
  const selectedAiHolderShape = useValue(
    'selected cowart ai holder shape',
    () => {
      const selectedShapeIds = editor.getSelectedShapeIds()
      if (selectedShapeIds.length !== 1) return null

      const shape = editor.getShape(selectedShapeIds[0])
      return isCowartAiHolderShape(shape) ? shape : null
    },
    [editor]
  )
  const [widthValue, setWidthValue] = useState('')
  const [heightValue, setHeightValue] = useState('')

  useEffect(() => {
    if (!selectedAiHolderShape) {
      setWidthValue('')
      setHeightValue('')
      return
    }

    setWidthValue(formatAiImageSize(selectedAiHolderShape.props.w))
    setHeightValue(formatAiImageSize(selectedAiHolderShape.props.h))
  }, [selectedAiHolderShape?.id, selectedAiHolderShape?.props.w, selectedAiHolderShape?.props.h])

  if (!selectedAiHolderShape) return null

  const activePreset = getAiImageAspectPreset(selectedAiHolderShape)
  const currentWidth = Number(selectedAiHolderShape.props.w)
  const currentHeight = Number(selectedAiHolderShape.props.h)
  const currentRatio = currentHeight ? currentWidth / currentHeight : 1
  const isAspectLocked = isAiImageAspectLocked(selectedAiHolderShape)

  function updateAiImageSize(nextWidth, nextHeight, historyMark = 'resize-ai-image-holder') {
    const w = clampAiImageSize(nextWidth)
    const h = clampAiImageSize(nextHeight)
    if (!w || !h) return

    editor.markHistoryStoppingPoint(historyMark)
    editor.updateShapes([
      {
        id: selectedAiHolderShape.id,
        type: 'frame',
        meta: {
          ...selectedAiHolderShape.meta,
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
        id: selectedAiHolderShape.id,
        type: 'frame',
        meta: {
          ...selectedAiHolderShape.meta,
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
    <div className="cowart-ai-image-style-panel" aria-label="AI 框尺寸设置">
      <section className="cowart-ai-style-section">
        <div className="cowart-ai-style-heading">
          <span>尺寸</span>
        </div>
        <div className="cowart-ai-size-row">
          <label className="cowart-ai-size-field">
            <span>W</span>
            <input
              aria-label="AI 框宽度"
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
              aria-label="AI 框高度"
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

function CowartSelectionToolbar() {
  const editor = useEditor()
  const slidesShapeId = useValue(
    'cowart selected ai slides toolbar shape id',
    () => {
      const shape = editor.getOnlySelectedShape()
      return isAiSlidesShape(shape) ? shape.id : null
    },
    [editor]
  )
  const htmlDraftShapeId = useValue(
    'cowart selected html draft toolbar shape id',
    () => {
      const shape = editor.getOnlySelectedShape()
      return isCowartHtmlDraftEmbedShape(shape) ? shape.id : null
    },
    [editor]
  )

  if (slidesShapeId) {
    return <CowartSlidesToolbar slidesShapeId={slidesShapeId} />
  }

  if (htmlDraftShapeId) {
    return <CowartHtmlDraftToolbar draftShapeId={htmlDraftShapeId} />
  }

  return <CowartImageToolbar />
}

function CowartExportMenu({ disabled = false, onExportHtml, onExportImage, targetKey }) {
  const editor = useEditor()
  const menuRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    setIsOpen(false)
    setStatus('idle')
  }, [targetKey])

  useEffect(() => {
    if (!isOpen) return undefined
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    const doc = editor.getContainerDocument()
    doc.addEventListener('pointerdown', handlePointerDown, true)
    doc.addEventListener('keydown', handleKeyDown, true)
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true)
      doc.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [editor, isOpen])

  useEffect(() => {
    if (status === 'idle' || status === 'sending') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  async function handleExport(exporter) {
    if (disabled || status === 'sending') return
    setIsOpen(false)
    setStatus('sending')
    try {
      await exporter()
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }

  const title = status === 'sending'
    ? '正在导出'
    : status === 'sent'
      ? '导出完成'
      : status === 'error'
        ? '导出失败，请重试'
        : COWART_EXPORT_LABEL

  return (
    <div className="cowart-export-menu" ref={menuRef}>
      <TldrawUiToolbarButton
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={title}
        className="cowart-export-trigger"
        data-status={status}
        data-testid={`tool.cowart-export-${targetKey}`}
        disabled={disabled || status === 'sending'}
        onClick={() => setIsOpen((open) => !open)}
        title={title}
        type="icon"
      >
        {status === 'sent' ? (
          <Check aria-hidden="true" size={16} strokeWidth={2.2} />
        ) : (
          <Download aria-hidden="true" size={16} strokeWidth={2} />
        )}
        <span className="cowart-slides-toolbar-label">{COWART_EXPORT_LABEL}</span>
        <ChevronDown aria-hidden="true" className="cowart-export-chevron" size={13} strokeWidth={2} />
      </TldrawUiToolbarButton>
      {isOpen && (
        <div aria-label="导出格式" className="cowart-ai-slides-page-count-popover cowart-export-popover" role="menu">
          <button
            className="cowart-ai-slides-page-count-option"
            onClick={() => handleExport(onExportImage)}
            role="menuitem"
            type="button"
          >
            <ImageIcon aria-hidden="true" className="is-visible" size={14} strokeWidth={2} />
            <span>{COWART_EXPORT_IMAGE_LABEL}</span>
          </button>
          <button
            className="cowart-ai-slides-page-count-option"
            onClick={() => handleExport(onExportHtml)}
            role="menuitem"
            type="button"
          >
            <FileCode aria-hidden="true" className="is-visible" size={14} strokeWidth={2} />
            <span>{COWART_EXPORT_HTML_LABEL}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function CowartSlidesToolbar({ slidesShapeId }) {
  const editor = useEditor()
  const showToolbar = useValue(
    'cowart show ai slides toolbar',
    () => editor.isInAny('select.idle', 'select.pointing_shape'),
    [editor]
  )
  const getSelectionBounds = useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds()
    if (!fullBounds) return undefined
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, 0)
  }, [editor])
  const hasContent = useValue(
    'cowart selected ai slides has content',
    () => getAiSlidesItems(editor, slidesShapeId).length > 0,
    [editor, slidesShapeId]
  )

  if (!showToolbar) return null

  function openSlidesViewer() {
    editor.getContainerDocument().dispatchEvent(
      new CustomEvent(COWART_OPEN_SLIDES_EVENT, {
        detail: { slidesShapeId }
      })
    )
  }

  return (
    <TldrawUiContextualToolbar
      className="tlui-media__toolbar cowart-slides-toolbar"
      getSelectionBounds={getSelectionBounds}
      label="AI Slides 工具栏"
    >
      <CowartExportMenu
        disabled={!hasContent}
        onExportHtml={() => exportCowartSlides(editor, slidesShapeId, 'html')}
        onExportImage={() => exportCowartSlides(editor, slidesShapeId, 'image')}
        targetKey={`slides-${slidesShapeId}`}
      />
      <TldrawUiToolbarButton
        aria-label={AI_SLIDES_PRESENT_LABEL}
        className="cowart-slides-present-button"
        data-testid="tool.cowart-slides-present"
        onClick={openSlidesViewer}
        title={AI_SLIDES_PRESENT_LABEL}
        type="icon"
      >
        <Play aria-hidden="true" className="cowart-slides-play-icon" size={15} strokeWidth={2} />
        <span className="cowart-slides-toolbar-label">{AI_SLIDES_PRESENT_LABEL}</span>
      </TldrawUiToolbarButton>
      {hasContent && <CowartSlidesAnnotationEditButton slidesShapeId={slidesShapeId} />}
    </TldrawUiContextualToolbar>
  )
}

function CowartSlidesAnnotationEditButton({ slidesShapeId }) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')

  useEffect(() => setStatus('idle'), [slidesShapeId])

  useEffect(() => {
    if (status === 'idle' || status === 'sending') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  async function handleClick() {
    if (status === 'sending') return
    setStatus('sending')
    try {
      await sendAiSlidesAnnotationEditRequest(editor, slidesShapeId)
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }

  const label = HTML_DRAFT_ANNOTATION_EDIT_LABEL
  const title =
    status === 'sending'
      ? `${label}中`
      : status === 'sent'
        ? `${label}已发送`
        : status === 'error'
          ? `${label}失败，请重试`
          : label
  const icon = status === 'sent' ? 'check' : status === 'error' ? 'warning-triangle' : 'tool-highlight'

  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-slides-annotation-button"
      data-status={status}
      data-testid="tool.cowart-slides-annotation-edit"
      disabled={status === 'sending'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      <TldrawUiButtonIcon icon={icon} small />
      <span className="cowart-slides-toolbar-label">{label}</span>
    </TldrawUiToolbarButton>
  )
}

function CowartHtmlDraftToolbar({ draftShapeId }) {
  const editor = useEditor()
  const showToolbar = useValue(
    'cowart show html draft toolbar',
    () => editor.isInAny('select.idle', 'select.pointing_shape', 'select.editing_shape'),
    [editor]
  )
  const isLocked = useValue(
    'cowart html draft toolbar locked',
    () => editor.getShape(draftShapeId)?.isLocked === true,
    [editor, draftShapeId]
  )
  const isDomEditing = useValue(
    'cowart html draft dom editing',
    () => editor.getEditingShapeId() === draftShapeId,
    [editor, draftShapeId]
  )
  const getSelectionBounds = useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds()
    if (!fullBounds) return undefined
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, 0)
  }, [editor])

  if (!showToolbar || isLocked) return null

  return (
    <TldrawUiContextualToolbar
      className="tlui-media__toolbar tlui-image__toolbar cowart-html-draft__toolbar"
      getSelectionBounds={getSelectionBounds}
      label="AI HTML 工具栏"
    >
      {!isDomEditing && (
        <CowartExportMenu
          onExportHtml={() => exportCowartHtmlDraft(editor, draftShapeId, 'html')}
          onExportImage={() => exportCowartHtmlDraft(editor, draftShapeId, 'image')}
          targetKey={`html-${draftShapeId}`}
        />
      )}
      <CowartHtmlDraftDomEditButton draftShapeId={draftShapeId} isEditing={isDomEditing} />
      {!isDomEditing && (
        <>
          <CowartHtmlDraftToolbarButton
            action="edit"
            draftShapeId={draftShapeId}
            icon="tool-highlight"
            label={HTML_DRAFT_ANNOTATION_EDIT_LABEL}
            showLabel
          />
          <CowartHtmlDraftToolbarButton
            action="image"
            draftShapeId={draftShapeId}
            icon="tool-media"
            iconElement={aiImageToolIcon}
            label={HTML_DRAFT_ANNOTATION_IMAGE_LABEL}
            showLabel
          />
        </>
      )}
    </TldrawUiContextualToolbar>
  )
}

function CowartHtmlDraftDomEditButton({ draftShapeId, isEditing }) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')
  const label = isEditing ? HTML_DRAFT_DOM_EDIT_DONE_LABEL : HTML_DRAFT_DOM_EDIT_LABEL

  useEffect(() => {
    setStatus('idle')
  }, [draftShapeId, isEditing])

  async function handleClick() {
    if (status === 'saving') return
    if (!isEditing) {
      editor.setEditingShape(draftShapeId)
      editor.setCurrentTool('select.editing_shape')
      window.requestAnimationFrame(() => cowartHtmlDraftIframes.get(draftShapeId)?.focus())
      return
    }

    setStatus('saving')
    try {
      await cowartHtmlDraftDomEditSessions.get(draftShapeId)?.flush()
      editor.setEditingShape(null)
      editor.setCurrentTool('select')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }

  const title =
    status === 'saving'
      ? '正在保存网页内容'
      : status === 'error'
        ? '网页内容保存失败，请重试'
        : label

  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-html-draft-toolbar-button"
      data-action="dom-edit"
      data-compact="false"
      data-status={status}
      data-testid="tool.cowart-html-draft-dom-edit"
      disabled={status === 'saving'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      <TldrawUiButtonIcon icon={isEditing ? 'check' : 'tool-text'} small />
      <span className="cowart-html-draft-toolbar-label">{label}</span>
    </TldrawUiToolbarButton>
  )
}

function CowartHtmlDraftToolbarButton({
  action,
  draftShapeId,
  icon,
  iconElement,
  label,
  showLabel = false
}) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    setStatus('idle')
  }, [action, draftShapeId])

  useEffect(() => {
    if (status === 'idle' || status === 'sending') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  async function handleClick() {
    if (status === 'sending') return

    setStatus('sending')
    try {
      await sendHtmlDraftAnnotationRequest(editor, draftShapeId, action)
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }

  const title =
    status === 'sending'
      ? `${label}中`
      : status === 'sent'
        ? `${label}已完成`
        : status === 'error'
          ? `${label}失败，请重试`
          : label
  const statusIcon = status === 'sent' ? 'check' : status === 'error' ? 'warning-triangle' : icon

  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-html-draft-toolbar-button"
      data-action={action}
      data-compact={showLabel ? 'false' : 'true'}
      data-status={status}
      data-testid={`tool.cowart-html-draft-${action}`}
      disabled={status === 'sending'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      {status === 'idle' && iconElement ? (
        iconElement
      ) : (
        <TldrawUiButtonIcon icon={statusIcon} small />
      )}
      {showLabel && <span className="cowart-html-draft-toolbar-label">{label}</span>}
    </TldrawUiToolbarButton>
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
      {!isInCropTool && (
        <>
          <CowartAnnotationEditToolbarButton imageShapeId={imageShapeId} />
          <CowartAnnotationHtmlToolbarButton imageShapeId={imageShapeId} />
        </>
      )}
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

function CowartAnnotationHtmlToolbarButton({ imageShapeId }) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    setStatus('idle')
  }, [imageShapeId])

  useEffect(() => {
    if (status === 'idle' || status === 'sending') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  async function handleClick() {
    if (status === 'sending') return

    setStatus('sending')
    try {
      await sendAnnotationHtmlRequest(editor, imageShapeId)
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }

  const title =
    status === 'sending'
      ? '正在提交 Html 生成请求'
      : status === 'sent'
        ? '已提交 Html 生成请求'
        : status === 'error'
          ? '提交失败，请重试'
          : ANNOTATION_HTML_TOOL_LABEL

  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-annotation-edit-toolbar-button cowart-annotation-html-toolbar-button"
      data-status={status}
      data-testid="tool.cowart-annotation-html"
      disabled={status === 'sending'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      {status === 'sent' || status === 'error' ? (
        <TldrawUiButtonIcon
          icon={status === 'sent' ? 'check' : 'warning-triangle'}
          small
        />
      ) : (
        aiHtmlToolIcon
      )}
      <span className="cowart-annotation-edit-toolbar-label">{ANNOTATION_HTML_TOOL_LABEL}</span>
    </TldrawUiToolbarButton>
  )
}

function CowartCustomToolButton({ className, icon, label, toolId }) {
  const editor = useEditor()
  const isSelected = useValue(
    `is ${toolId} selected`,
    () => editor.getCurrentToolId() === toolId,
    [editor, toolId]
  )

  return (
    <button
      aria-label={label}
      aria-pressed={isSelected ? 'true' : 'false'}
      className={`tlui-button tlui-button__tool ${className}`}
      data-testid={`tools.${toolId}`}
      data-value={toolId}
      draggable={false}
      onClick={() => {
        unlockGlobalToolLock(editor)
        editor.setCurrentTool(toolId)
      }}
      onTouchStart={(event) => {
        event.preventDefault()
        unlockGlobalToolLock(editor)
        editor.setCurrentTool(toolId)
      }}
      title={label}
      type="button"
    >
      {icon}
    </button>
  )
}

function CowartAnnotationToolbarItem() {
  return (
    <CowartCustomToolButton
      className="cowart-annotation-toolbar-button"
      icon={annotationToolIcon}
      label={ANNOTATION_TOOL_LABEL}
      toolId={ANNOTATION_TOOL_ID}
    />
  )
}

function CowartAgentLassoToolbarItem() {
  return (
    <CowartCustomToolButton
      className="cowart-agent-lasso-toolbar-button"
      icon={agentLassoToolIcon}
      label={COWART_AGENT_LASSO_TOOL_LABEL}
      toolId={COWART_AGENT_LASSO_TOOL_ID}
    />
  )
}

function CowartToolbarDivider() {
  return <div aria-orientation="vertical" className="cowart-toolbar-divider" role="separator" />
}

function CowartToolLockButton() {
  const editor = useEditor()
  const isLocked = useValue(
    'is tool locked',
    () => editor.getInstanceState().isToolLocked,
    [editor]
  )

  return (
    <button
      aria-label="保持当前工具 — Q"
      aria-pressed={isLocked ? 'true' : 'false'}
      className="tlui-button tlui-button__tool cowart-tool-lock-button"
      data-testid="tools.lock"
      onClick={() => editor.updateInstanceState({ isToolLocked: !isLocked })}
      title="保持当前工具 — Q"
      type="button"
    >
      <LockKeyhole aria-hidden="true" size={19} strokeWidth={1.8} />
    </button>
  )
}

function CowartToolbar(props) {
  return (
    <DefaultToolbar {...props} maxItems={15} maxSizePx={710} minItems={15} minSizePx={710}>
      <CowartToolLockButton />
      <HandToolbarItem />
      <SelectToolbarItem />
      <RectangleToolbarItem />
      <DiamondToolbarItem />
      <EllipseToolbarItem />
      <ArrowToolbarItem />
      <LineToolbarItem />
      <DrawToolbarItem />
      <TextToolbarItem />
      <AssetToolbarItem />
      <EraserToolbarItem />
      <CowartToolbarDivider />
      <CowartAgentLassoToolbarItem />
      <CowartAnnotationToolbarItem />
      <NoteToolbarItem />
      <FrameToolbarItem />
      <HighlightToolbarItem />
      <LaserToolbarItem />
      <TriangleToolbarItem />
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
    </DefaultToolbar>
  )
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
    trackCanvasOpened()
    window.__cowartEditor = editor
    window.__cowartSelection = () => getCowartSelection(editor)
    window.__cowartViewState = () => getCowartViewState(editor)
    editor.setStyleForNextShapes(DefaultColorStyle, 'black')
    editor.setStyleForNextShapes(DefaultDashStyle, 'draw')
    editor.setStyleForNextShapes(DefaultFillStyle, 'none')
    editor.setStyleForNextShapes(DefaultFontStyle, 'draw')
    editor.setStyleForNextShapes(DefaultSizeStyle, 's')
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
      const viewStateSnapshot = getCowartViewState(editor)
      const nextViewState = JSON.stringify(viewStateSnapshot)
      if (nextViewState === lastSyncedViewState) return
      lastSyncedViewState = nextViewState

      if (isViewStateSaving) {
        hasPendingViewState = true
        return
      }

      isViewStateSaving = true
      try {
        await saveCowartViewState({
          ...viewStateSnapshot,
          updatedAt: new Date().toISOString()
        })
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

    let slidesLayoutTimer = null
    let isLayingOutSlides = false
    function scheduleSlidesLayout() {
      if (isLayingOutSlides || editor.inputs.getIsDragging()) return
      window.clearTimeout(slidesLayoutTimer)
      slidesLayoutTimer = window.setTimeout(() => {
        if (isLayingOutSlides || editor.inputs.getIsDragging()) return
        isLayingOutSlides = true
        try {
          editor.run(
            () => {
              normalizeAiDraftHolderLabels(editor)
              adoptGeneratedAiSlidesItems(editor)
              layoutAllAiSlides(editor)
            },
            { history: 'ignore' }
          )
        } finally {
          isLayingOutSlides = false
        }
      }, 0)
    }
    function handleSlidesPointerUp(event) {
      if (event.name === 'pointer_up') scheduleSlidesLayout()
    }
    editor.on('event', handleSlidesPointerUp)
    const disposeSlidesBeforeCreateHandler = editor.sideEffects.registerBeforeCreateHandler(
      'shape',
      (shape, source) => preparePastedItemForAiSlides(editor, shape, source)
    )
    const disposeSlidesOperationHandler = editor.sideEffects.registerOperationCompleteHandler(() => {
      if (movePastedItemsIntoAiSlides(editor)) return
      scheduleSlidesLayout()
    })
    editor.timers.setTimeout(scheduleSlidesLayout, 100)

    const containerDocument = editor.getContainerDocument()
    function handleCowartCopy(event) {
      copySelectedCowartContent(editor, event)
    }
    containerDocument.addEventListener('copy', handleCowartCopy, { capture: true })

    let saveTimer = null
    let isSaving = false
    let hasPendingSave = false
    let hasUnsavedChanges = false
    let documentChangeVersion = 0
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
      const savingVersion = documentChangeVersion
      const acknowledgedDeletesInSave = new Set(acknowledgedImageShapeDeletes)
      try {
        const saveResult = await saveCowartCanvasSnapshot(editor.store.getStoreSnapshot(), {
          protectImageRecords: true,
          acknowledgedImageShapeDeletes: Array.from(acknowledgedImageShapeDeletes)
        })
        if (saveResult?.ok === false) {
          throw new Error(saveResult.message || 'Yogurt AI refused to save the canvas snapshot.')
        }
        for (const imageShapeId of acknowledgedDeletesInSave) {
          acknowledgedImageShapeDeletes.delete(imageShapeId)
        }
        hasUnsavedChanges = documentChangeVersion !== savingVersion
      } catch (error) {
        console.error(error)
      } finally {
        isSaving = false
        if (hasPendingSave || hasUnsavedChanges) {
          hasPendingSave = false
          scheduleSave()
        }
      }
    }

    function scheduleSave() {
      documentChangeVersion += 1
      hasUnsavedChanges = true
      window.clearTimeout(saveTimer)
      window.clearTimeout(slidesLayoutTimer)
      if (isSaving) hasPendingSave = true
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
      editor.off('event', handleSlidesPointerUp)
      containerDocument.removeEventListener('copy', handleCowartCopy, { capture: true })
      disposeSlidesBeforeCreateHandler()
      disposeSlidesOperationHandler()
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
    <main className="cowart-canvas" aria-label="Yogurt AI infinite canvas">
      <SkippedRecordsNotice records={skippedRecords} />
      <Tldraw
        snapshot={snapshot ?? undefined}
        assetUrls={cowartAssetUrls}
        assets={cowartTldrawAssetStore}
        inferDarkMode
        onMount={handleMount}
        options={cowartTldrawOptions}
        overrides={cowartUiOverrides}
        components={cowartComponents}
        shapeUtils={cowartShapeUtils}
        themes={cowartTldrawThemes}
        tools={[CowartAnnotationTool, CowartAgentLassoTool]}
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
