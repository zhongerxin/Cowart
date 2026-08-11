import { sendTrackedWidgetMessage } from './analytics.js'

export function imageContentFromDataUrl(dataUrl, meta = {}) {
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) throw new Error('The exported canvas region is not a valid image data URL.')
  return {
    type: 'image',
    data: match[2],
    mimeType: match[1],
    _meta: meta
  }
}

export function followUpSender(windowObject = globalThis.window) {
  let sendMessage = null
  if (typeof windowObject?.cowartMcp?.sendFollowUpMessage === 'function') {
    sendMessage = (message) => windowObject.cowartMcp.sendFollowUpMessage(message)
  } else if (typeof windowObject?.openai?.sendFollowUpMessage === 'function') {
    sendMessage = (message) => windowObject.openai.sendFollowUpMessage(message)
  }
  if (!sendMessage) return null

  return (message, analyticsContext = {}) =>
    sendTrackedWidgetMessage(sendMessage, message, analyticsContext)
}

function hostCapabilities(windowObject = globalThis.window) {
  try {
    return (
      windowObject?.cowartMcp?.getHostCapabilities?.() ||
      windowObject?.openai?.hostCapabilities ||
      globalThis.__COWART_MCP_APP__?.getHostCapabilities?.() ||
      null
    )
  } catch (_error) {
    return null
  }
}

export function supportsMessageImages(windowObject = globalThis.window) {
  return Boolean(hostCapabilities(windowObject)?.message?.image)
}
