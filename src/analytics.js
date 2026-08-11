const DEFAULT_MEASUREMENT_ID = 'G-SJYHV19YZ9'
const DEFAULT_APP_VERSION =
  typeof __COWART_APP_VERSION__ !== 'undefined' ? __COWART_APP_VERSION__ : 'unknown'
const GOOGLE_TAG_SCRIPT_ID = 'cowart-google-analytics'
const COWART_PAGE_LOCATION = 'https://www.jiqiren.ai/cowart-widget'
const COWART_PAGE_TITLE = 'Yogurt AI Widget'
const ANALYTICS_EVENT_TIMEOUT_MS = 1200
const ANALYTICS_TOOL_NAME = 'track_cowart_analytics_event'
const ANALYTICS_CLIENT_ID_STORAGE_KEY = 'cowart.analytics.client_id'
const GA4_CLIENT_ID_PATTERN = /^\d+\.\d+$/

const AI_TYPES = new Set(['image', 'html', 'slides'])
const PROMPT_TYPES = new Set([
  'ai_image',
  'ai_html',
  'ai_slides',
  'annotation_edit',
  'annotation_html',
  'slides_annotation_edit',
  'html_annotation_edit',
  'html_annotation_image',
  'other'
])

function isDebugMode(windowObject) {
  if (import.meta.env?.DEV) return true
  try {
    return new URLSearchParams(windowObject?.location?.search || '').get('cowart_analytics_debug') === '1'
  } catch (_error) {
    return false
  }
}

function defaultAnalyticsStorage() {
  return 'granted'
}

function analyticsSource(windowObject) {
  return windowObject?.cowartMcp || windowObject?.openai ? 'codex_widget' : 'browser_fallback'
}

function normalizedAiType(aiType) {
  return AI_TYPES.has(aiType) ? aiType : 'image'
}

function normalizedPromptType(promptType) {
  return PROMPT_TYPES.has(promptType) ? promptType : 'other'
}

function normalizedPageCount(pageCount) {
  const count = Math.round(Number(pageCount))
  return Number.isFinite(count) ? Math.min(Math.max(count, 1), 100) : undefined
}

function analyticsToolCaller(windowObject) {
  if (typeof windowObject?.cowartMcp?.callServerTool === 'function') {
    return (argumentsObject) => windowObject.cowartMcp.callServerTool({
      name: ANALYTICS_TOOL_NAME,
      arguments: argumentsObject
    })
  }
  if (typeof windowObject?.openai?.callTool === 'function') {
    return (argumentsObject) => windowObject.openai.callTool(ANALYTICS_TOOL_NAME, argumentsObject)
  }
  return null
}

function anonymousClientId(windowObject) {
  try {
    const stored = windowObject.localStorage?.getItem(ANALYTICS_CLIENT_ID_STORAGE_KEY)
    if (GA4_CLIENT_ID_PATTERN.test(stored || '')) return stored
  } catch (_error) {
    // Continue with a session-scoped anonymous id when storage is unavailable.
  }

  let randomPart = Math.floor(Math.random() * 2_147_483_647) || 1
  try {
    if (typeof windowObject.crypto?.getRandomValues === 'function') {
      const values = new Uint32Array(1)
      windowObject.crypto.getRandomValues(values)
      randomPart = values[0] || 1
    }
  } catch (_error) {
    // Math.random is sufficient for an anonymous analytics identifier fallback.
  }
  const generated = `${randomPart}.${Math.floor(Date.now() / 1000)}`
  try {
    windowObject.localStorage?.setItem(ANALYTICS_CLIENT_ID_STORAGE_KEY, generated)
  } catch (_error) {
    // A stable id is helpful but not required for event delivery.
  }
  return generated
}

function analyticsToolResult(result) {
  return result?.structuredContent || result || {}
}

export function createCowartAnalytics({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  measurementId = DEFAULT_MEASUREMENT_ID,
  appVersion = DEFAULT_APP_VERSION,
  debugMode = isDebugMode(windowObject),
  analyticsStorage = defaultAnalyticsStorage()
} = {}) {
  let initialized = false
  let canvasOpenedTracked = false
  let clientId

  function initialize() {
    if (initialized) return true
    if (!windowObject || !documentObject?.head || !measurementId) return false

    const dataLayer = windowObject.dataLayer = windowObject.dataLayer || []
    const gtag = windowObject.gtag = windowObject.gtag || function cowartGtag() {
      dataLayer.push(arguments)
    }

    gtag('consent', 'default', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: analyticsStorage === 'denied' ? 'denied' : 'granted',
      functionality_storage: 'granted',
      personalization_storage: 'granted',
      security_storage: 'granted'
    })
    gtag('js', new Date())
    gtag('config', measurementId, {
      send_page_view: false,
      page_location: COWART_PAGE_LOCATION,
      page_referrer: '',
      page_title: COWART_PAGE_TITLE,
      allow_google_signals: true,
      allow_ad_personalization_signals: true,
      cookie_flags: 'SameSite=None;Secure',
      cookie_update: true,
      ...(debugMode ? { debug_mode: true } : {})
    })

    if (!documentObject.getElementById?.(GOOGLE_TAG_SCRIPT_ID)) {
      const script = documentObject.createElement('script')
      script.id = GOOGLE_TAG_SCRIPT_ID
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
      script.referrerPolicy = 'no-referrer'
      script.onerror = () => {
        console.warn('Cowart analytics could not load the Google tag.')
      }
      documentObject.head.append(script)
    }

    initialized = true
    return true
  }

  function queueGoogleTagEvent(
    eventName,
    parameters = {},
    { eventCallback, eventTimeout = ANALYTICS_EVENT_TIMEOUT_MS } = {}
  ) {
    try {
      if (!initialize()) return false

      windowObject.gtag('event', eventName, {
        send_to: measurementId,
        app_version: appVersion,
        app_surface: 'codex_widget',
        source: analyticsSource(windowObject),
        page_location: COWART_PAGE_LOCATION,
        page_referrer: '',
        page_title: COWART_PAGE_TITLE,
        ...parameters,
        ...(typeof eventCallback === 'function'
          ? { event_callback: eventCallback, event_timeout: eventTimeout }
          : {}),
        ...(debugMode ? { debug_mode: true } : {})
      })
      return true
    } catch (error) {
      console.warn('Cowart analytics event could not be queued.', error)
      return false
    }
  }

  function trackEvent(
    eventName,
    parameters = {},
    { eventCallback, eventTimeout = ANALYTICS_EVENT_TIMEOUT_MS } = {}
  ) {
    const callAnalyticsTool = analyticsToolCaller(windowObject)
    if (!callAnalyticsTool) {
      return queueGoogleTagEvent(eventName, parameters, { eventCallback, eventTimeout })
    }

    clientId ||= anonymousClientId(windowObject)
    Promise.resolve(callAnalyticsTool({
      clientId,
      eventName,
      appVersion,
      parameters
    })).then((result) => {
      const delivery = analyticsToolResult(result)
      if (delivery.delivered === true) {
        eventCallback?.()
        return
      }
      queueGoogleTagEvent(eventName, parameters, { eventCallback, eventTimeout })
    }).catch((error) => {
      console.warn('Cowart MCP analytics delivery failed; trying the Google tag fallback.', error)
      queueGoogleTagEvent(eventName, parameters, { eventCallback, eventTimeout })
    })
    return true
  }

  return {
    measurementId,

    trackCanvasOpened() {
      if (canvasOpenedTracked) return false
      canvasOpenedTracked = true
      return trackEvent('canvas_opened')
    },

    trackAnnotationCreated() {
      return trackEvent('annotation_created', {
        annotation_type: 'arrow'
      })
    },

    trackAiGenerationRequested({
      aiType,
      hasReference = false,
      pageCount,
      eventCallback,
      eventTimeout
    } = {}) {
      const normalizedCount = normalizedPageCount(pageCount)
      return trackEvent(
        'ai_generation_requested',
        {
          ai_type: normalizedAiType(aiType),
          has_reference: hasReference ? 'yes' : 'no',
          ...(normalizedCount === undefined ? {} : { page_count: normalizedCount })
        },
        { eventCallback, eventTimeout }
      )
    },

    trackWidgetPromptSent({ promptType, hasReference = false, eventCallback, eventTimeout } = {}) {
      return trackEvent(
        'widget_prompt_sent',
        {
          prompt_type: normalizedPromptType(promptType),
          has_reference: hasReference ? 'yes' : 'no'
        },
        { eventCallback, eventTimeout }
      )
    }
  }
}

let defaultAnalytics

function cowartAnalytics() {
  defaultAnalytics ??= createCowartAnalytics()
  return defaultAnalytics
}

export function trackCanvasOpened() {
  return cowartAnalytics().trackCanvasOpened()
}

export function trackAnnotationCreated() {
  return cowartAnalytics().trackAnnotationCreated()
}

export function trackAiGenerationRequested(parameters) {
  return cowartAnalytics().trackAiGenerationRequested(parameters)
}

export function trackWidgetPromptSent(parameters) {
  return cowartAnalytics().trackWidgetPromptSent(parameters)
}

function waitForAnalyticsDispatch(dispatch, timeoutMs = ANALYTICS_EVENT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let completed = false
    const complete = () => {
      if (completed) return
      completed = true
      globalThis.clearTimeout(fallbackTimer)
      resolve()
    }
    const fallbackTimer = globalThis.setTimeout(complete, timeoutMs + 100)

    try {
      const queued = dispatch({ eventCallback: complete, eventTimeout: timeoutMs })
      if (queued === false) complete()
    } catch (_error) {
      complete()
    }
  })
}

export async function sendTrackedWidgetMessage(
  sendMessage,
  message,
  analyticsContext = {},
  {
    onWidgetPromptSent = trackWidgetPromptSent,
    onAiGenerationRequested = trackAiGenerationRequested
  } = {}
) {
  // The host bridge can synchronously suspend or replace the widget. Let the
  // Google tag process the queued event first, then hand control to Codex.
  await waitForAnalyticsDispatch(({ eventCallback, eventTimeout }) => {
    const promptQueued = onWidgetPromptSent({
      promptType: analyticsContext.promptType,
      hasReference: analyticsContext.hasReference,
      ...(analyticsContext.aiType ? {} : { eventCallback, eventTimeout })
    })
    if (!analyticsContext.aiType) return promptQueued

    return onAiGenerationRequested({
      aiType: analyticsContext.aiType,
      hasReference: analyticsContext.hasReference,
      pageCount: analyticsContext.pageCount,
      eventCallback,
      eventTimeout
    })
  })

  return await sendMessage(message)
}
