import { useEffect, useRef, useState } from 'react'
import { FileCode, LoaderCircle, Presentation } from 'lucide-react'
import { useEditor, useToasts } from 'tldraw'
import {
  getExcalidrawKeyboardAction,
  isEditableKeyboardTarget
} from './excalidrawInteraction.js'

const PRODUCT_NAME = 'Yogurt AI'

function clickToolbarTool(toolId) {
  const candidates = document.querySelectorAll(
    `[data-testid="tools.${toolId}"], [data-value="${toolId}"]`
  )
  const button = Array.from(candidates).find(
    (candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled
  )
  button?.click()
  return Boolean(button)
}

function ExcalidrawShortcutBridge({ onCreateHtml, onCreateImage, onCreateSlides }) {
  const editor = useEditor()

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.defaultPrevented || event.repeat || isEditableKeyboardTarget(event.target)) return
      const action = getExcalidrawKeyboardAction(event)
      if (!action) return

      if (action === 'toggle-tool-lock') {
        editor.updateInstanceState({
          isToolLocked: !editor.getInstanceState().isToolLocked
        })
      } else if (action === 'cowart-ai-image') {
        onCreateImage(editor)
      } else if (action === 'cowart-ai-html') {
        onCreateHtml(editor)
      } else if (action === 'cowart-ai-slides') {
        onCreateSlides(editor)
      } else if (!clickToolbarTool(action)) {
        editor.setCurrentTool(action)
      }

      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [editor, onCreateHtml, onCreateImage, onCreateSlides])

  return null
}

function CowartAiMenu({ brandIcon, items }) {
  const menuRef = useRef(null)
  const { addToast } = useToasts()
  const [isOpen, setIsOpen] = useState(false)
  const [activeItemId, setActiveItemId] = useState(null)

  useEffect(() => {
    if (!isOpen) return undefined

    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false)
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen])

  async function handleSelect(item) {
    if (activeItemId) return
    setIsOpen(false)
    if (!item.successTitle) {
      item.onSelect()
      return
    }

    setActiveItemId(item.id)
    try {
      const result = await item.onSelect()
      addToast({
        title: item.successTitle,
        description: item.successDescription?.(result) || result?.filePath || result?.fileName,
        severity: 'success'
      })
    } catch (error) {
      console.error(error)
      addToast({
        title: '画布整合导出失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        severity: 'error'
      })
    } finally {
      setActiveItemId(null)
    }
  }

  return (
    <div className="cowart-excalidraw-ai-menu" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-busy={Boolean(activeItemId)}
        className="cowart-excalidraw-ai-trigger"
        disabled={Boolean(activeItemId)}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <span className="cowart-excalidraw-ai-trigger-icon">
          {activeItemId ? <LoaderCircle aria-hidden="true" className="cowart-spin" /> : brandIcon}
        </span>
        <span>{activeItemId ? '正在整合画布' : PRODUCT_NAME}</span>
      </button>
      {isOpen && (
        <div aria-label={PRODUCT_NAME} className="cowart-excalidraw-ai-popover" role="menu">
          <div className="cowart-excalidraw-ai-popover-heading">
            <strong>{PRODUCT_NAME}</strong>
            <span>在画布中创建、整理和导出内容</span>
          </div>
          {items.map((item) => (
            <button
              className="cowart-excalidraw-ai-option"
              data-action={item.id}
              data-divider={item.divider || undefined}
              key={item.id}
              onClick={() => handleSelect(item)}
              role="menuitem"
              type="button"
            >
              <span className="cowart-excalidraw-ai-option-icon">{item.icon}</span>
              <span className="cowart-excalidraw-ai-option-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              {item.shortcut ? (
                <kbd>{item.shortcut}</kbd>
              ) : (
                <span className="cowart-excalidraw-ai-option-badge">{item.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ExcalidrawCowartChrome({
  htmlIcon,
  imageIcon,
  onCreateHtml,
  onCreateImage,
  onCreateSlides,
  onExportCanvasHtml,
  onExportCanvasPptx,
  slidesIcon
}) {
  const editor = useEditor()

  const items = [
    {
      id: 'image',
      label: 'AI 图片',
      description: '创建图片生成区域',
      icon: imageIcon,
      shortcut: '⇧ I',
      onSelect: () => onCreateImage(editor)
    },
    {
      id: 'html',
      label: 'AI HTML',
      description: '创建可编辑网页草稿',
      icon: htmlIcon,
      shortcut: '⇧ H',
      onSelect: () => onCreateHtml(editor)
    },
    {
      id: 'slides',
      label: 'AI Slides',
      description: '创建演示文稿画框',
      icon: slidesIcon,
      shortcut: '⇧ S',
      onSelect: () => onCreateSlides(editor)
    },
    {
      id: 'export-html',
      label: '整合为 HTML',
      description: '导出可缩放全景与内容目录',
      icon: <FileCode aria-hidden="true" />,
      badge: 'HTML',
      divider: true,
      onSelect: () => onExportCanvasHtml(editor),
      successTitle: '画布 HTML 已导出',
      successDescription: (result) => result?.filePath || `${result?.itemCount || 0} 项内容已整合。`
    },
    {
      id: 'export-pptx',
      label: '整合为 PowerPoint',
      description: '生成全景页与可编辑内容页',
      icon: <Presentation aria-hidden="true" />,
      badge: 'PPTX',
      onSelect: () => onExportCanvasPptx(editor),
      successTitle: '画布 PowerPoint 已导出',
      successDescription: (result) => result?.filePath || `${result?.slideCount || 1} 页 PPTX 已生成。`
    }
  ]

  return (
    <>
      <ExcalidrawShortcutBridge
        onCreateHtml={onCreateHtml}
        onCreateImage={onCreateImage}
        onCreateSlides={onCreateSlides}
      />
      <CowartAiMenu brandIcon={imageIcon} items={items} />
    </>
  )
}
