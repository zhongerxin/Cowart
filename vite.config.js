import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { randomUUID } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

const projectDir = resolve(process.env.COWART_PROJECT_DIR ?? process.cwd())
const cowartAppVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version
const canvasDir = resolve(process.env.COWART_CANVAS_DIR ?? join(projectDir, 'canvas'))
const canvasFile = join(canvasDir, 'cowart-canvas.json')
const selectionFile = join(canvasDir, 'cowart-selection.json')
const viewStateFile = join(canvasDir, 'cowart-view-state.json')
const canvasPagesDir = join(canvasDir, 'pages')
const canvasAssetsDir = join(canvasDir, 'assets')
const pagesManifestFile = join(canvasPagesDir, 'manifest.json')
const canvasFileName = 'cowart-canvas.json'
const pageIdPrefix = 'page:'
const globalAssetsRoute = '/assets/'
const pageAssetsRoute = '/page-assets/'
const canvasEventClients = new Set()
let canvasEventVersion = 0
let canvasSnapshotSanitizerPromise = null

const mimeTypes = new Map([
  ['.apng', 'image/apng'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8']
])

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

function sendCanvasEvent(res, payload) {
  res.write(`event: canvas-changed\n`)
  res.write(`id: ${payload.version}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function broadcastCanvasChanged(result) {
  const payload = {
    version: ++canvasEventVersion,
    updatedAt: new Date().toISOString(),
    storage: result.storage,
    paths: result.paths
  }

  for (const client of canvasEventClients) {
    if (client.destroyed) {
      canvasEventClients.delete(client)
      continue
    }

    try {
      sendCanvasEvent(client, payload)
    } catch {
      canvasEventClients.delete(client)
    }
  }
}

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 50 * 1024 * 1024) {
        rejectBody(new Error('Canvas payload is too large.'))
        req.destroy()
      }
    })
    req.on('end', () => resolveBody(body))
    req.on('error', rejectBody)
  })
}

function isCanvasSnapshot(value) {
  return value && typeof value === 'object' && value.store && value.schema
}

async function sanitizeCanvasSnapshotForServer(snapshot) {
  canvasSnapshotSanitizerPromise ??= import('./src/canvasSnapshot.js')
  const { sanitizeCanvasSnapshotForTldraw } = await canvasSnapshotSanitizerPromise
  return sanitizeCanvasSnapshotForTldraw(snapshot)
}

function isSelectionState(value) {
  return value && typeof value === 'object' && Array.isArray(value.selectedShapes)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isViewState(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.version === 1 &&
    (value.currentPageId === null || typeof value.currentPageId === 'string') &&
    value.camera &&
    typeof value.camera === 'object' &&
    isFiniteNumber(value.camera.x) &&
    isFiniteNumber(value.camera.y) &&
    isFiniteNumber(value.camera.z)
  )
}

function isSafeChildPath(parent, child) {
  const pathToChild = relative(parent, child)
  return pathToChild && !pathToChild.startsWith('..') && !pathToChild.includes(`..${sep}`)
}

function pageDirName(pageId) {
  return encodeURIComponent(pageId.replace(pageIdPrefix, ''))
}

function pageFilePath(pageId) {
  return join(canvasPagesDir, pageDirName(pageId), canvasFileName)
}

function pageAssetsDir(pageId) {
  return join(canvasPagesDir, pageDirName(pageId), 'assets')
}

function pageAssetUrl(pageId, fileName) {
  return `${pageAssetsRoute}${pageDirName(pageId)}/${encodeURIComponent(fileName)}`
}

function getPageRecords(snapshot) {
  return Object.values(snapshot.store)
    .filter((record) => record?.typeName === 'page')
    .sort((a, b) => String(a.index ?? '').localeCompare(String(b.index ?? '')))
}

function getAssetIdsForShapes(shapes) {
  return new Set(
    shapes
      .map((shape) => shape?.props?.assetId)
      .filter((assetId) => typeof assetId === 'string')
  )
}

function getShapeRecordsForPage(snapshot, pageId) {
  const shapesByParent = new Map()
  for (const record of Object.values(snapshot.store)) {
    if (record?.typeName !== 'shape') continue
    const siblings = shapesByParent.get(record.parentId) ?? []
    siblings.push(record)
    shapesByParent.set(record.parentId, siblings)
  }

  const shapes = []
  const queue = [...(shapesByParent.get(pageId) ?? [])]
  while (queue.length > 0) {
    const shape = queue.shift()
    shapes.push(shape)
    queue.push(...(shapesByParent.get(shape.id) ?? []))
  }
  return shapes
}

function isBindingForShapes(record, shapeIds) {
  if (record?.typeName !== 'binding') return false
  const fromId = record.fromId ?? record.props?.fromId
  const toId = record.toId ?? record.props?.toId
  return shapeIds.has(fromId) || shapeIds.has(toId)
}

function snapshotForPage(snapshot, page) {
  const pageId = page.id
  const pageShapes = getShapeRecordsForPage(snapshot, pageId)
  const shapeIds = new Set(pageShapes.map((shape) => shape.id))
  const assetIds = getAssetIdsForShapes(pageShapes)
  const store = {}

  for (const record of Object.values(snapshot.store)) {
    if (!record?.id) continue
    if (record.typeName === 'page') {
      if (record.id === pageId) store[record.id] = record
      continue
    }
    if (record.typeName === 'shape') {
      if (shapeIds.has(record.id)) store[record.id] = record
      continue
    }
    if (record.typeName === 'asset') {
      if (assetIds.has(record.id)) store[record.id] = record
      continue
    }
    if (record.typeName === 'binding') {
      if (isBindingForShapes(record, shapeIds)) store[record.id] = record
      continue
    }
    store[record.id] = record
  }

  return {
    schema: snapshot.schema,
    store
  }
}

function extensionFromMimeType(mimeType) {
  switch (mimeType) {
    case 'image/apng':
      return '.apng'
    case 'image/avif':
      return '.avif'
    case 'image/gif':
      return '.gif'
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/svg+xml':
      return '.svg'
    case 'image/webp':
      return '.webp'
    case 'text/html':
      return '.html'
    default:
      return '.bin'
  }
}

function sanitizeAssetFileName(name, fallbackName, mimeType) {
  const rawName = basename(String(name || fallbackName || 'asset'))
  const extension = extname(rawName) || extensionFromMimeType(mimeType)
  const baseName = rawName
    .slice(0, rawName.length - extname(rawName).length)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${baseName || 'asset'}${extension}`
}

function parseDataUrl(src) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(src)
  if (!match) return null
  const mimeType = match[1] || 'application/octet-stream'
  const encoded = match[2]
  const isBase64 = /^data:[^,]*;base64,/i.test(src)
  const buffer = isBase64 ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded))
  return { buffer, mimeType }
}

function htmlDraftDataUrl(htmlContent) {
  return `data:text/html;base64,${Buffer.from(String(htmlContent || ''), 'utf8').toString('base64')}`
}

function localAssetFilePathFromUrl(src) {
  let route = null
  let baseDir = null
  if (src.startsWith(globalAssetsRoute)) {
    route = globalAssetsRoute
    baseDir = canvasAssetsDir
  } else if (src.startsWith(pageAssetsRoute)) {
    const parts = src.slice(pageAssetsRoute.length).split('/')
    const pageDir = decodeURIComponent(parts.shift() ?? '')
    if (!pageDir || parts.length === 0) return null
    const filePath = resolve(join(canvasPagesDir, pageDir, 'assets'), ...parts.map(decodeURIComponent))
    return isSafeChildPath(join(canvasPagesDir, pageDir, 'assets'), filePath) ? filePath : null
  } else {
    return null
  }

  const requestedPath = decodeURIComponent(src.slice(route.length))
  const filePath = resolve(baseDir, requestedPath)
  return isSafeChildPath(baseDir, filePath) ? filePath : null
}

async function localizePageAsset(asset, pageId) {
  const src = asset?.props?.src
  if (!src || typeof src !== 'string' || /^https?:\/\//.test(src)) return asset

  const currentPagePrefix = `${pageAssetsRoute}${pageDirName(pageId)}/`
  if (src.startsWith(currentPagePrefix)) return asset

  const localizedAsset = structuredClone(asset)
  const dataUrl = src.startsWith('data:') ? parseDataUrl(src) : null
  const sourceFilePath = dataUrl ? null : localAssetFilePathFromUrl(src)
  if (!dataUrl && !sourceFilePath) return localizedAsset

  const fileName = sanitizeAssetFileName(
    dataUrl ? null : localizedAsset.props.name,
    sourceFilePath ? basename(sourceFilePath) : localizedAsset.id.replace(':', '-'),
    dataUrl?.mimeType ?? localizedAsset.props.mimeType
  )
  const destinationDir = pageAssetsDir(pageId)
  const destinationPath = join(destinationDir, fileName)

  await mkdir(destinationDir, { recursive: true })
  if (dataUrl) {
    await writeFile(destinationPath, dataUrl.buffer)
    localizedAsset.props.mimeType = localizedAsset.props.mimeType ?? dataUrl.mimeType
    localizedAsset.props.fileSize = dataUrl.buffer.length
  } else if (resolve(sourceFilePath) !== resolve(destinationPath)) {
    await copyFile(sourceFilePath, destinationPath)
    localizedAsset.props.fileSize = (await stat(destinationPath)).size
  }

  localizedAsset.props.name = fileName
  localizedAsset.props.src = pageAssetUrl(pageId, fileName)
  return localizedAsset
}

function isHtmlDraftShapeRecord(record) {
  return record?.typeName === 'shape' && record.type === 'embed' && record.meta?.cowartHtmlDraft === true
}

function pageIdForShape(store, shape) {
  let record = shape
  const visited = new Set()
  while (record && !visited.has(record.id)) {
    visited.add(record.id)
    if (record.typeName === 'page') return record.id
    record = store[record.parentId]
  }
  return null
}

async function uniquePageAssetTarget(pageId, requestedName) {
  const directory = pageAssetsDir(pageId)
  const safeName = sanitizeAssetFileName(requestedName, 'html-draft.html', 'text/html')
  const extension = extname(safeName)
  const baseName = safeName.slice(0, safeName.length - extension.length)
  let fileName = safeName
  let counter = 2

  while (true) {
    const filePath = join(directory, fileName)
    try {
      await stat(filePath)
      fileName = `${baseName}-v${counter}${extension}`
      counter += 1
    } catch (error) {
      if (error.code === 'ENOENT') return { fileName, filePath }
      throw error
    }
  }
}

async function updateHtmlDraftSnapshot(snapshot, { draftShapeId, htmlContent }) {
  const shape = snapshot.store[draftShapeId]
  if (!isHtmlDraftShapeRecord(shape)) throw new Error(`HTML draft shape not found: ${draftShapeId}`)
  if (typeof htmlContent !== 'string' || !htmlContent.trim()) throw new Error('HTML draft content is empty.')

  const pageId = pageIdForShape(snapshot.store, shape)
  if (!pageId) throw new Error(`Could not determine page for HTML draft: ${draftShapeId}`)

  const existingAssetUrl = shape.meta?.cowartHtmlDraftAssetUrl
  const expectedPrefix = `${pageAssetsRoute}${pageDirName(pageId)}/`
  const sharedAsset =
    typeof existingAssetUrl === 'string' &&
    Object.values(snapshot.store).some(
      (record) =>
        record?.id !== draftShapeId &&
        isHtmlDraftShapeRecord(record) &&
        record.meta?.cowartHtmlDraftAssetUrl === existingAssetUrl
    )

  let assetUrl = existingAssetUrl
  let assetPath = typeof existingAssetUrl === 'string' ? localAssetFilePathFromUrl(existingAssetUrl) : null
  if (!assetPath || !existingAssetUrl.startsWith(expectedPrefix) || sharedAsset) {
    let requestedName = `${draftShapeId.replace(/[^a-zA-Z0-9_-]+/g, '-')}.html`
    if (typeof existingAssetUrl === 'string' && existingAssetUrl.startsWith(expectedPrefix)) {
      try {
        requestedName = decodeURIComponent(existingAssetUrl.slice(expectedPrefix.length))
      } catch (_error) {
        // Fall back to the shape-based file name.
      }
    }
    const target = await uniquePageAssetTarget(pageId, requestedName)
    assetPath = target.filePath
    assetUrl = pageAssetUrl(pageId, target.fileName)
  }

  await mkdir(dirname(assetPath), { recursive: true })
  await writeFile(assetPath, htmlContent)
  snapshot.store[draftShapeId] = {
    ...shape,
    meta: {
      ...shape.meta,
      cowartHtmlDraft: true,
      cowartHtmlDraftAssetUrl: assetUrl
    },
    props: {
      ...shape.props,
      url: htmlDraftDataUrl(htmlContent)
    }
  }

  return { assetPath, assetUrl, forkedSharedHtmlDraftAsset: sharedAsset, pageId, shapeId: draftShapeId }
}

async function persistHtmlDraftAsset(record, pageId) {
  if (
    record?.typeName !== 'shape' ||
    record.type !== 'embed' ||
    record.meta?.cowartHtmlDraft !== true ||
    typeof record.props?.url !== 'string'
  ) {
    return record
  }

  const assetUrl = record.meta?.cowartHtmlDraftAssetUrl
  const expectedPrefix = `${pageAssetsRoute}${pageDirName(pageId)}/`
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith(expectedPrefix)) return record

  const parsed = record.props.url.startsWith('data:') ? parseDataUrl(record.props.url) : null
  if (!parsed || parsed.mimeType !== 'text/html') return record

  const assetPath = localAssetFilePathFromUrl(assetUrl)
  if (!assetPath) return record
  await mkdir(dirname(assetPath), { recursive: true })
  await writeFile(assetPath, parsed.buffer)
  return record
}

async function localizePageAssets(pageSnapshot, pageId) {
  const entries = await Promise.all(
    Object.entries(pageSnapshot.store).map(async ([id, record]) => {
      if (record?.typeName === 'asset') return [id, await localizePageAsset(record, pageId)]
      return [id, await persistHtmlDraftAsset(record, pageId)]
    })
  )
  return {
    ...pageSnapshot,
    store: Object.fromEntries(entries)
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function readPageSnapshots() {
  let entries
  try {
    entries = await readdir(canvasPagesDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }

  const snapshots = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const filePath = join(canvasPagesDir, entry.name, canvasFileName)
    try {
      const snapshot = await readJsonFile(filePath)
      if (isCanvasSnapshot(snapshot)) snapshots.push({ filePath, snapshot })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return snapshots
}

async function loadCanvasSnapshot() {
  const pageSnapshots = await readPageSnapshots()
  if (pageSnapshots.length > 0) {
    const [{ snapshot: firstSnapshot }] = pageSnapshots
    const mergedSnapshot = {
      schema: firstSnapshot.schema,
      store: {}
    }

    for (const { snapshot } of pageSnapshots) {
      Object.assign(mergedSnapshot.store, snapshot.store)
    }
    return {
      snapshot: mergedSnapshot,
      path: canvasPagesDir,
      storage: 'per-page'
    }
  }

  try {
    return {
      snapshot: await readJsonFile(canvasFile),
      path: canvasFile,
      storage: 'legacy-single-file'
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { snapshot: null, path: canvasPagesDir, storage: 'empty' }
    }
    throw error
  }
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`)
  await rename(tempFile, filePath)
}

async function saveCanvasSnapshot(snapshot) {
  const pages = getPageRecords(snapshot)
  if (pages.length === 0) {
    await writeJsonAtomic(canvasFile, snapshot)
    return { storage: 'legacy-single-file', paths: [canvasFile] }
  }

  const paths = []
  for (const page of pages) {
    const filePath = pageFilePath(page.id)
    const pageSnapshot = await localizePageAssets(snapshotForPage(snapshot, page), page.id)
    await writeJsonAtomic(filePath, pageSnapshot)
    paths.push(filePath)
  }

  const manifest = {
    version: 1,
    source: 'cowart',
    pages: pages.map((page) => ({
      id: page.id,
      name: page.name,
      index: page.index,
      path: relative(canvasDir, pageFilePath(page.id))
    }))
  }
  await writeJsonAtomic(pagesManifestFile, manifest)

  return { storage: 'per-page', paths }
}

async function serveCanvasAsset(req, res, next) {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (!url.pathname.startsWith(globalAssetsRoute) && !url.pathname.startsWith(pageAssetsRoute)) {
    next()
    return
  }

  const filePath = localAssetFilePathFromUrl(url.pathname)
  if (!filePath) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', mimeTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream')
    res.setHeader('content-length', String(fileStat.size))
    res.setHeader('cache-control', 'no-cache')
    createReadStream(filePath).pipe(res)
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    next(error)
  }
}

function canvasStoragePlugin() {
  return {
    name: 'cowart-canvas-storage',
    configureServer(server) {
      server.middlewares.use(serveCanvasAsset)

      server.middlewares.use('/api/html-draft', async (req, res) => {
        try {
          if (req.method !== 'PUT') {
            res.statusCode = 405
            res.setHeader('allow', 'PUT')
            res.end()
            return
          }

          const body = JSON.parse(await readRequestBody(req))
          const loaded = await loadCanvasSnapshot()
          if (!loaded.snapshot) {
            sendJson(res, 404, { error: 'No Cowart canvas snapshot exists.' })
            return
          }

          const updatedDraft = await updateHtmlDraftSnapshot(loaded.snapshot, body)
          const result = await saveCanvasSnapshot(loaded.snapshot)
          broadcastCanvasChanged(result)
          sendJson(res, 200, { ok: true, ...updatedDraft, ...result })
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/canvas-events', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream')
        res.setHeader('cache-control', 'no-cache, no-transform')
        res.setHeader('connection', 'keep-alive')
        res.setHeader('x-accel-buffering', 'no')
        res.write(`: connected\n\n`)

        canvasEventClients.add(res)
        const heartbeat = setInterval(() => {
          res.write(`: heartbeat ${Date.now()}\n\n`)
        }, 25000)

        req.on('close', () => {
          clearInterval(heartbeat)
          canvasEventClients.delete(res)
        })
      })

      server.middlewares.use('/api/selection', async (req, res) => {
        try {
          if (req.method === 'GET') {
            try {
              sendJson(res, 200, {
                selection: await readJsonFile(selectionFile),
                path: selectionFile
              })
            } catch (error) {
              if (error.code === 'ENOENT') {
                sendJson(res, 200, {
                  selection: { selectedShapes: [], updatedAt: null },
                  path: selectionFile
                })
                return
              }
              throw error
            }
            return
          }

          if (req.method === 'PUT') {
            const body = await readRequestBody(req)
            const selection = JSON.parse(body)
            if (!isSelectionState(selection)) {
              sendJson(res, 400, { error: 'Expected a Cowart selection state.' })
              return
            }

            await writeJsonAtomic(selectionFile, selection)
            sendJson(res, 200, { ok: true, path: selectionFile })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/view-state', async (req, res) => {
        try {
          if (req.method === 'GET') {
            try {
              sendJson(res, 200, {
                viewState: await readJsonFile(viewStateFile),
                path: viewStateFile
              })
            } catch (error) {
              if (error.code === 'ENOENT') {
                sendJson(res, 200, {
                  viewState: {
                    version: 1,
                    currentPageId: null,
                    camera: { x: 0, y: 0, z: 1 },
                    updatedAt: null
                  },
                  path: viewStateFile
                })
                return
              }
              throw error
            }
            return
          }

          if (req.method === 'PUT') {
            const body = await readRequestBody(req)
            const viewState = JSON.parse(body)
            if (!isViewState(viewState)) {
              sendJson(res, 400, { error: 'Expected a Cowart view state.' })
              return
            }

            await writeJsonAtomic(viewStateFile, viewState)
            sendJson(res, 200, { ok: true, path: viewStateFile })
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })

      server.middlewares.use('/api/canvas', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const result = await loadCanvasSnapshot()
            sendJson(res, 200, result)
            return
          }

          if (req.method === 'PUT') {
            const body = await readRequestBody(req)
            const snapshot = JSON.parse(body)
            if (!isCanvasSnapshot(snapshot)) {
              sendJson(res, 400, { error: 'Expected a tldraw store snapshot.' })
              return
            }

            const sanitized = await sanitizeCanvasSnapshotForServer(snapshot)
            if (!sanitized.snapshot) {
              sendJson(res, 400, {
                error: 'Invalid tldraw store snapshot.',
                skippedRecords: sanitized.skippedRecords
              })
              return
            }

            const result = await saveCanvasSnapshot(sanitized.snapshot)
            sendJson(res, 200, { ok: true, ...result, skippedRecords: sanitized.skippedRecords })
            broadcastCanvasChanged(result)
            return
          }

          res.statusCode = 405
          res.setHeader('allow', 'GET, PUT')
          res.end()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), canvasStoragePlugin()],
  define: {
    __COWART_WIDGET_BUILD__: JSON.stringify(process.env.COWART_WIDGET_BUILD === '1'),
    __COWART_APP_VERSION__: JSON.stringify(cowartAppVersion),
    'process.env.NODE_ENV': JSON.stringify('development')
  },
  build: {
    modulePreload: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 43217,
    watch: {
      ignored: ['**/screenshots/**']
    }
  }
})
