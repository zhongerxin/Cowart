import { Box, TldrawUiContextualToolbar, useEditor, useToasts, useValue } from 'tldraw'
import { AlertTriangle, Check, Info, LoaderCircle, Send, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  collectSelectionAnnotationShapeIds,
  expandBox,
  getAnnotationExportPixelRatio
} from './annotationContext.js'
import {
  COWART_AGENT_LASSO_COMPLETE_EVENT,
  COWART_AGENT_LASSO_EMPTY_EVENT
} from './agentLasso.js'
import { saveCowartReferenceImage, saveCowartSelectionState } from './cowartClient.js'
import { getCowartSelectionSnapshot } from './selectionContext.js'
import { buildThinkingReviewPrompt } from './thinkingReviewPrompt.js'
import {
  followUpSender,
  imageContentFromDataUrl,
  supportsMessageImages
} from './widgetMessaging.js'

const EXPORT_PADDING = 32
const STATUS_RESET_MS = 2400
const FOLLOW_UP_UNAVAILABLE_CODE = 'COWART_FOLLOW_UP_UNAVAILABLE'

function screenshotFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `thinking-review-${timestamp}.png`
}

async function submitThinkingReview(editor, selectedIds, userInstruction) {
  await saveCowartSelectionState({
    ...getCowartSelectionSnapshot(editor),
    updatedAt: new Date().toISOString()
  })

  const sender = followUpSender()
  if (!sender) {
    const error = new Error('AI 圈选提交需要在 Codex 原生 Yogurt AI 画布中使用。')
    error.code = FOLLOW_UP_UNAVAILABLE_CODE
    throw error
  }

  const includedIds = collectSelectionAnnotationShapeIds(editor, selectedIds)
  const rawBounds = editor.getShapesPageBounds(includedIds)
  if (!rawBounds) throw new Error('Unable to calculate the annotated selection bounds.')
  const exportBounds = expandBox(rawBounds, EXPORT_PADDING)
  const exportResult = await editor.toImageDataUrl(includedIds, {
    bounds: exportBounds,
    background: true,
    darkMode: false,
    format: 'png',
    padding: 0,
    pixelRatio: getAnnotationExportPixelRatio(exportBounds)
  })
  const screenshotAsset = await saveCowartReferenceImage({
    anchorShapeId: selectedIds[0],
    fileName: screenshotFileName(),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const prompt = buildThinkingReviewPrompt({
    selectedIds,
    includedIds,
    screenshotAsset,
    userInstruction,
    width: exportResult.width,
    height: exportResult.height
  })
  const content = [{ type: 'text', text: prompt }]
  if (supportsMessageImages()) {
    content.push(
      imageContentFromDataUrl(exportResult.url, {
        cowartThinkingReview: true,
        cowartSelectedShapeIds: selectedIds,
        cowartIncludedShapeIds: includedIds,
        cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
        cowartUserInstruction: userInstruction
      })
    )
  }
  return sender({ prompt, content }, { promptType: 'other', hasReference: true })
}

function SendStatusIcon({ status }) {
  if (status === 'sending') return <LoaderCircle aria-hidden="true" className="cowart-spin" size={17} />
  if (status === 'sent') return <Check aria-hidden="true" size={17} />
  if (status === 'preview') return <Info aria-hidden="true" size={17} />
  if (status === 'error') return <AlertTriangle aria-hidden="true" size={17} />
  return <Send aria-hidden="true" size={17} />
}

export function CowartThinkingReviewToolbar() {
  const editor = useEditor()
  const { addToast } = useToasts()
  const inputRef = useRef(null)
  const selectedIds = useValue(
    'cowart thinking review selection',
    () => editor.getSelectedShapeIds(),
    [editor]
  )
  const showToolbar = useValue(
    'cowart thinking review toolbar visible',
    () =>
      editor.getSelectedShapeIds().length > 0 &&
      editor.isInAny('select.idle', 'select.pointing_shape'),
    [editor]
  )
  const [instruction, setInstruction] = useState('')
  const [status, setStatus] = useState('idle')
  const selectionKey = selectedIds.join('|')
  const isAgentConnected = Boolean(followUpSender())

  useEffect(() => {
    setInstruction('')
    setStatus('idle')
  }, [selectionKey])

  useEffect(() => {
    const containerDocument = editor.getContainerDocument()
    function handleAgentLassoComplete() {
      setInstruction('')
      setStatus('idle')
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
    function handleAgentLassoEmpty() {
      addToast({
        title: '圈选区域内没有内容',
        description: '请把要处理的卡片、连线或图片圈进来。',
        severity: 'info'
      })
    }

    containerDocument.addEventListener(
      COWART_AGENT_LASSO_COMPLETE_EVENT,
      handleAgentLassoComplete
    )
    containerDocument.addEventListener(COWART_AGENT_LASSO_EMPTY_EVENT, handleAgentLassoEmpty)
    return () => {
      containerDocument.removeEventListener(
        COWART_AGENT_LASSO_COMPLETE_EVENT,
        handleAgentLassoComplete
      )
      containerDocument.removeEventListener(COWART_AGENT_LASSO_EMPTY_EVENT, handleAgentLassoEmpty)
    }
  }, [addToast, editor])

  useEffect(() => {
    if (status === 'idle' || status === 'sending') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  const getSelectionBounds = useCallback(() => {
    const bounds = editor.getSelectionScreenBounds()
    if (!bounds) return undefined
    return new Box(bounds.x, bounds.y + bounds.height + 60, bounds.width, 0)
  }, [editor])

  if (!showToolbar) return null

  async function handleSubmit(event) {
    event?.preventDefault()
    const request = instruction.trim()
    if (!request || status === 'sending') return

    setStatus('sending')
    try {
      await submitThinkingReview(editor, selectedIds, request)
      setStatus('sent')
    } catch (error) {
      if (error?.code === FOLLOW_UP_UNAVAILABLE_CODE) {
        let copied = false
        try {
          await navigator.clipboard?.writeText(`请根据当前 Yogurt AI 选区执行：${request}`)
          copied = true
        } catch (_clipboardError) {
          // Selection persistence is still useful when clipboard access is unavailable.
        }
        setStatus('preview')
        addToast({
          title: '当前是本地预览',
          description: copied
            ? '选区已保留，指令已复制。请在 Codex 原生 Yogurt AI 画布中发送。'
            : '选区已保留。AI 提交需要在 Codex 原生 Yogurt AI 画布中完成。',
          severity: 'info'
        })
        return
      }
      console.error(error)
      setStatus('error')
      addToast({
        title: '发送失败',
        description: error?.message || '请稍后重试。',
        severity: 'error'
      })
    }
  }

  const statusLabel =
    status === 'sending'
      ? '正在发送给 Agent'
      : status === 'sent'
        ? '已发送给 Agent'
        : status === 'preview'
          ? '本地预览：请在 Codex 原生画布中发送'
        : status === 'error'
          ? '发送失败，请重试'
          : isAgentConnected
            ? '发送给 Agent'
            : '本地预览：保留选区并复制指令'

  return (
    <TldrawUiContextualToolbar
      className="cowart-thinking-review-toolbar"
      getSelectionBounds={getSelectionBounds}
      label="AI 圈选指令"
    >
      <form
        className="cowart-thinking-review-composer"
        data-status={status}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="cowart-thinking-review-scope" title={`已选择 ${selectedIds.length} 个对象`}>
          <Sparkles aria-hidden="true" size={16} />
          <span>{selectedIds.length} 项</span>
        </div>
        <input
          ref={inputRef}
          aria-label="告诉 Agent 如何修改圈选内容"
          autoComplete="off"
          className="cowart-thinking-review-input"
          disabled={status === 'sending'}
          maxLength={1200}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder={
            isAgentConnected
              ? '告诉 Agent 如何修改圈选内容…'
              : '本地预览：输入后保留选区并复制指令'
          }
          value={instruction}
        />
        <button
          aria-label={statusLabel}
          className="cowart-thinking-review-send"
          data-status={status}
          disabled={!instruction.trim() || status === 'sending'}
          title={statusLabel}
          type="submit"
        >
          <SendStatusIcon status={status} />
        </button>
      </form>
    </TldrawUiContextualToolbar>
  )
}
