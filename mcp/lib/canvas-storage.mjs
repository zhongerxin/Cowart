import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, isAbsolute, relative, resolve, sep } from "node:path";

const PAGE_ID_PREFIX = "page:";
const GLOBAL_ASSETS_ROUTE = "/assets/";
const PAGE_ASSETS_ROUTE = "/page-assets/";
const CANVAS_FILE_NAME = "cowart-canvas.json";
const HTML_DRAFT_URL_ORIGIN = "http://cowart.local";
const canvasTransactions = new AsyncLocalStorage();
const canvasQueues = new Map();
const LOCK_WAIT_MS = 30_000;

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}

async function liveCanvasLockParticipants(lockDir) {
  const participants = [];
  for (const name of await readdir(lockDir)) {
    if (!/^\d+-[a-f0-9-]+\.json$/.test(name)) continue;
    const filePath = join(lockDir, name);
    let owner;
    try { owner = JSON.parse(await readFile(filePath, "utf8")); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!processIsAlive(owner.pid)) {
      // Participant names are unique and never reused. Removing an exited
      // participant cannot unlink a newly acquired lock from another process.
      await rm(filePath, { force: true });
      continue;
    }
    participants.push({ ...owner, name });
  }
  return participants;
}

async function acquireCanvasFileLock(canvasDir) {
  const lockDir = join(canvasDir, ".cowart-canvas-lock");
  await mkdir(lockDir, { recursive: true });
  if (!isSafeChildPath(canvasDir, await realpath(lockDir))) {
    throw new Error("Unsafe Cowart canvas lock directory.");
  }
  const name = `${process.pid}-${randomUUID()}.json`;
  const participantPath = join(lockDir, name);
  const started = Date.now();
  try {
    // Lamport's bakery ordering: atomically announce choosing before reading
    // ticket numbers. A joining process then either waits for this choice or
    // observes the published number and takes a later ticket. Atomic JSON
    // publication leaves no ownerless lock if the process exits mid-write.
    await writeJsonAtomic(participantPath, { pid: process.pid, ticket: null });
    const participants = await liveCanvasLockParticipants(lockDir);
    const ticket = 1 + participants.reduce((maximum, owner) => Math.max(maximum, owner.ticket || 0), 0);
    await writeJsonAtomic(participantPath, { pid: process.pid, ticket });
    for (;;) {
      const waiting = (await liveCanvasLockParticipants(lockDir)).some((owner) =>
        owner.name !== name && (owner.ticket === null || owner.ticket < ticket || (owner.ticket === ticket && owner.name < name)),
      );
      if (!waiting) return async () => { await rm(participantPath, { force: true }); };
      if (Date.now() - started >= LOCK_WAIT_MS) {
        throw new Error("Cowart canvas is busy in another process. Please retry after that operation finishes.");
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  } catch (error) {
    await rm(participantPath, { force: true });
    throw error;
  }
}

// Every read/modify/write operation uses the same canonical canvas key and
// file lock, including separate MCP processes and full-snapshot widget saves.
export async function withCowartCanvasTransaction(args, operation) {
  await mkdir(resolveCanvasDir(args), { recursive: true });
  const canvasDir = await realpath(resolveCanvasDir(args));
  if (canvasTransactions.getStore()?.has(canvasDir)) return operation();
  const previous = canvasQueues.get(canvasDir) || Promise.resolve();
  let finish;
  const queued = new Promise((resolveQueue) => { finish = resolveQueue; });
  const tail = previous.then(() => queued);
  canvasQueues.set(canvasDir, tail);
  await previous;
  try {
    const release = await acquireCanvasFileLock(canvasDir);
    try {
      return await canvasTransactions.run(new Set([...(canvasTransactions.getStore() || []), canvasDir]), operation);
    } finally { await release(); }
  } finally {
    finish();
    if (canvasQueues.get(canvasDir) === tail) canvasQueues.delete(canvasDir);
  }
}

const mimeTypes = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".htm", "text/html"],
  [".html", "text/html"],
]);

export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function pathResolve(value) {
  return resolve(String(value));
}

export function resolveCowartPaths(args = {}) {
  const explicitProjectDir = nonEmptyString(args.projectDir);
  const explicitCanvasDir = nonEmptyString(args.canvasDir);
  const envProjectDir = nonEmptyString(process.env.COWART_PROJECT_DIR);
  const envCanvasDir = nonEmptyString(process.env.COWART_CANVAS_DIR);

  const projectDir = pathResolve(explicitProjectDir || envProjectDir || process.cwd());
  const canvasDir = explicitCanvasDir
    ? pathResolve(explicitCanvasDir)
    : envCanvasDir
      ? pathResolve(envCanvasDir)
      : join(projectDir, "canvas");

  return { projectDir, canvasDir };
}

export function resolveCanvasDir(args = {}) {
  return resolveCowartPaths(args).canvasDir;
}

export function resolveSelectionFile(args = {}) {
  return join(resolveCanvasDir(args), "cowart-selection.json");
}

export function resolveViewStateFile(args = {}) {
  return join(resolveCanvasDir(args), "cowart-view-state.json");
}

export function pageDirName(pageId) {
  return encodeURIComponent(String(pageId).replace(PAGE_ID_PREFIX, ""));
}

export function pageAssetUrl(pageId, fileName) {
  return `${PAGE_ASSETS_ROUTE}${pageDirName(pageId)}/${encodeURIComponent(fileName)}`;
}

function canvasFile(args = {}) {
  return join(resolveCanvasDir(args), CANVAS_FILE_NAME);
}

function canvasPagesDir(args = {}) {
  return join(resolveCanvasDir(args), "pages");
}

function canvasAssetsDir(args = {}) {
  return join(resolveCanvasDir(args), "assets");
}

function pagesManifestFile(args = {}) {
  return join(canvasPagesDir(args), "manifest.json");
}

function pageFilePath(args, pageId) {
  return join(canvasPagesDir(args), pageDirName(pageId), CANVAS_FILE_NAME);
}

function pageAssetsDir(args, pageId) {
  return join(canvasPagesDir(args), pageDirName(pageId), "assets");
}

function isCanvasSnapshot(value) {
  return value && typeof value === "object" && value.store && value.schema;
}

function isSelectionState(value) {
  return value && typeof value === "object" && Array.isArray(value.selectedShapes);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isViewState(value) {
  return (
    value &&
    typeof value === "object" &&
    value.version === 1 &&
    (value.currentPageId === null || typeof value.currentPageId === "string") &&
    value.camera &&
    typeof value.camera === "object" &&
    isFiniteNumber(value.camera.x) &&
    isFiniteNumber(value.camera.y) &&
    isFiniteNumber(value.camera.z)
  );
}

function isSafeChildPath(parent, child) {
  const pathToChild = relative(parent, child);
  return Boolean(pathToChild && !isAbsolute(pathToChild) && pathToChild !== ".." && !pathToChild.startsWith(`..${sep}`));
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultViewState() {
  return {
    version: 1,
    currentPageId: null,
    camera: { x: 0, y: 0, z: 1 },
    updatedAt: null,
  };
}

function getPageRecords(snapshot) {
  return Object.values(snapshot.store)
    .filter((record) => record?.typeName === "page")
    .sort((a, b) => String(a.index ?? "").localeCompare(String(b.index ?? "")));
}

function getAssetIdsForShapes(shapes) {
  return new Set(
    shapes
      .map((shape) => shape?.props?.assetId)
      .filter((assetId) => typeof assetId === "string"),
  );
}

function getShapeRecordsForPage(snapshot, pageId) {
  const shapesByParent = new Map();
  for (const record of Object.values(snapshot.store)) {
    if (record?.typeName !== "shape") continue;
    const siblings = shapesByParent.get(record.parentId) ?? [];
    siblings.push(record);
    shapesByParent.set(record.parentId, siblings);
  }

  const shapes = [];
  const queue = [...(shapesByParent.get(pageId) ?? [])];
  while (queue.length > 0) {
    const shape = queue.shift();
    shapes.push(shape);
    queue.push(...(shapesByParent.get(shape.id) ?? []));
  }
  return shapes;
}

function isBindingForShapes(record, shapeIds) {
  if (record?.typeName !== "binding") return false;
  const fromId = record.fromId ?? record.props?.fromId;
  const toId = record.toId ?? record.props?.toId;
  return shapeIds.has(fromId) || shapeIds.has(toId);
}

function snapshotForPage(snapshot, page) {
  const pageId = page.id;
  const pageShapes = getShapeRecordsForPage(snapshot, pageId);
  const shapeIds = new Set(pageShapes.map((shape) => shape.id));
  const assetIds = getAssetIdsForShapes(pageShapes);
  const store = {};

  for (const record of Object.values(snapshot.store)) {
    if (!record?.id) continue;
    if (record.typeName === "page") {
      if (record.id === pageId) store[record.id] = record;
      continue;
    }
    if (record.typeName === "shape") {
      if (shapeIds.has(record.id)) store[record.id] = record;
      continue;
    }
    if (record.typeName === "asset") {
      if (assetIds.has(record.id)) store[record.id] = record;
      continue;
    }
    if (record.typeName === "binding") {
      if (isBindingForShapes(record, shapeIds)) store[record.id] = record;
      continue;
    }
    store[record.id] = record;
  }

  return {
    schema: snapshot.schema,
    store,
  };
}

function extensionFromMimeType(mimeType) {
  switch (mimeType) {
    case "image/apng":
      return ".apng";
    case "image/avif":
      return ".avif";
    case "image/gif":
      return ".gif";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/svg+xml":
      return ".svg";
    case "image/webp":
      return ".webp";
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    case "text/html":
      return ".html";
    default:
      return ".bin";
  }
}

function sanitizeAssetFileName(name, fallbackName, mimeType) {
  const rawName = basename(String(name || fallbackName || "asset"));
  const extension = extname(rawName) || extensionFromMimeType(mimeType);
  const baseName = rawName
    .slice(0, rawName.length - extname(rawName).length)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${baseName || "asset"}${extension}`;
}

async function uniqueAssetFilePath(dir, requestedName) {
  const safeName = sanitizeAssetFileName(requestedName, "asset", null);
  const extension = extname(safeName);
  const baseName = safeName.slice(0, safeName.length - extension.length);
  let fileName = safeName;
  let counter = 2;

  while (true) {
    const filePath = join(dir, fileName);
    try {
      await stat(filePath);
      fileName = `${baseName}-v${counter}${extension}`;
      counter += 1;
    } catch (error) {
      if (error?.code === "ENOENT") return { fileName, filePath };
      throw error;
    }
  }
}

function parseDataUrl(src) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(src);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const encoded = match[2];
  const isBase64 = /^data:[^,]*;base64,/i.test(src);
  const buffer = isBase64 ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded));
  return { buffer, mimeType };
}

async function localAssetFilePathFromUrl(src, args = {}) {
  if (typeof src !== "string") return null;
  let assetDir;
  let fileParts;
  try {
    if (src.startsWith(PAGE_ASSETS_ROUTE)) {
      const parts = src.slice(PAGE_ASSETS_ROUTE.length).split("/");
      const pageName = decodeURIComponent(parts.shift() ?? "");
      if (!pageName || pageName === "." || pageName === ".." || /\0/.test(pageName)) return null;
      // pageDirName stores the URI-encoded page name on disk. Decode the URL
      // exactly once, then reconstruct that canonical directory component.
      // Slashes in a legitimate page ID remain literal %2F in the directory;
      // they never become filesystem separators.
      assetDir = join(canvasPagesDir(args), pageDirName(`page:${pageName}`), "assets");
      fileParts = parts.map(decodeURIComponent);
    } else if (src.startsWith(GLOBAL_ASSETS_ROUTE)) {
      assetDir = canvasAssetsDir(args);
      fileParts = src.slice(GLOBAL_ASSETS_ROUTE.length).split("/").map(decodeURIComponent);
    } else return null;
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  if (!fileParts.length || fileParts.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part))) return null;
  const filePath = resolve(assetDir, ...fileParts);
  const canvasDir = resolveCanvasDir(args);
  if (!isSafeChildPath(canvasDir, assetDir) || !isSafeChildPath(assetDir, filePath)) return null;
  try {
    const [realCanvasDir, realAssetDir, realFilePath] = await Promise.all([
      realpath(canvasDir), realpath(assetDir), realpath(filePath),
    ]);
    if (!isSafeChildPath(realCanvasDir, realAssetDir) || !isSafeChildPath(realAssetDir, realFilePath)) return null;
    return realFilePath;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "ELOOP") return null;
    throw error;
  }
}

function stringSet(value) {
  return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
}

function getImageShapeRefs(snapshot) {
  if (!isCanvasSnapshot(snapshot)) return [];

  const refs = [];
  for (const page of getPageRecords(snapshot)) {
    for (const shape of getShapeRecordsForPage(snapshot, page.id)) {
      if (shape?.typeName !== "shape" || shape.type !== "image") continue;

      const assetId = typeof shape.props?.assetId === "string" ? shape.props.assetId : null;
      const asset = assetId ? snapshot.store[assetId] : null;
      refs.push({
        pageId: page.id,
        shapeId: shape.id,
        assetId,
        assetSrc: typeof asset?.props?.src === "string" ? asset.props.src : null,
        assetName: typeof asset?.props?.name === "string" ? asset.props.name : null,
      });
    }
  }
  return refs;
}

async function hasRecoverableImagePayload(args, imageRef) {
  if (typeof imageRef.assetSrc !== "string") return false;
  if (imageRef.assetSrc.startsWith("data:")) return true;

  const filePath = await localAssetFilePathFromUrl(imageRef.assetSrc, args);
  if (!filePath) return false;

  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function getUnacknowledgedImageLosses(args, previousSnapshot, nextSnapshot) {
  if (!args.protectImageRecords) return [];

  const acknowledgedDeletes = stringSet(args.acknowledgedImageShapeDeletes);
  const nextImageShapeIds = new Set(getImageShapeRefs(nextSnapshot).map((ref) => ref.shapeId));
  const losses = [];

  for (const imageRef of getImageShapeRefs(previousSnapshot)) {
    if (nextImageShapeIds.has(imageRef.shapeId)) continue;
    if (acknowledgedDeletes.has(imageRef.shapeId)) continue;
    if (!(await hasRecoverableImagePayload(args, imageRef))) continue;
    losses.push(imageRef);
  }

  return losses;
}

async function localizePageAsset(args, asset, pageId) {
  const src = asset?.props?.src;
  if (!src || typeof src !== "string" || /^https?:\/\//.test(src)) return asset;

  const currentPagePrefix = `${PAGE_ASSETS_ROUTE}${pageDirName(pageId)}/`;
  if (src.startsWith(currentPagePrefix)) return asset;

  const localizedAsset = cloneJson(asset);
  const dataUrl = src.startsWith("data:") ? parseDataUrl(src) : null;
  const sourceFilePath = dataUrl ? null : await localAssetFilePathFromUrl(src, args);
  if (!dataUrl && !sourceFilePath) return localizedAsset;

  const fileName = sanitizeAssetFileName(
    dataUrl ? null : localizedAsset.props.name,
    sourceFilePath ? basename(sourceFilePath) : localizedAsset.id.replace(":", "-"),
    dataUrl?.mimeType ?? localizedAsset.props.mimeType,
  );
  const destinationDir = pageAssetsDir(args, pageId);
  const destinationPath = join(destinationDir, fileName);

  await mkdir(destinationDir, { recursive: true });
  if (dataUrl) {
    await writeFile(destinationPath, dataUrl.buffer);
    localizedAsset.props.mimeType = localizedAsset.props.mimeType ?? dataUrl.mimeType;
    localizedAsset.props.fileSize = dataUrl.buffer.length;
  } else if (resolve(sourceFilePath) !== resolve(destinationPath)) {
    await copyFile(sourceFilePath, destinationPath);
    localizedAsset.props.fileSize = (await stat(destinationPath)).size;
  }

  localizedAsset.props.name = fileName;
  localizedAsset.props.src = pageAssetUrl(pageId, fileName);
  return localizedAsset;
}

async function localizePageAssets(args, pageSnapshot, pageId) {
  const entries = await Promise.all(
    Object.entries(pageSnapshot.store).map(async ([id, record]) => {
      if (record?.typeName !== "asset") return [id, record];
      return [id, await localizePageAsset(args, record, pageId)];
    }),
  );
  return {
    ...pageSnapshot,
    store: Object.fromEntries(entries),
  };
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readPageSnapshots(args = {}) {
  let manifest = null;
  try {
    manifest = await readJsonFile(pagesManifestFile(args));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (manifest) {
    if (!Array.isArray(manifest.pages)) throw new Error(`Invalid pages manifest in ${pagesManifestFile(args)}`);
    const snapshots = [];
    for (const page of manifest.pages) {
      const filePath = pageFilePath(args, page.id);
      const snapshot = await readJsonFile(filePath);
      if (!isCanvasSnapshot(snapshot)) {
        throw new Error(`Invalid canvas snapshot in ${filePath}`);
      }
      snapshots.push({ filePath, snapshot });
    }
    return snapshots;
  }

  let entries;
  try {
    entries = await readdir(canvasPagesDir(args), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = join(canvasPagesDir(args), entry.name, CANVAS_FILE_NAME);
    try {
      const snapshot = await readJsonFile(filePath);
      if (isCanvasSnapshot(snapshot)) snapshots.push({ filePath, snapshot });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return snapshots;
}

async function loadStoredCanvasSnapshot(args = {}) {
  const pageSnapshots = await readPageSnapshots(args);
  if (pageSnapshots.length > 0) {
    const [{ snapshot: firstSnapshot }] = pageSnapshots;
    const mergedSnapshot = {
      schema: firstSnapshot.schema,
      store: {},
    };

    for (const { snapshot } of pageSnapshots) {
      Object.assign(mergedSnapshot.store, snapshot.store);
    }
    return {
      snapshot: mergedSnapshot,
      path: canvasPagesDir(args),
      storage: "per-page",
    };
  }

  try {
    return {
      snapshot: await readJsonFile(canvasFile(args)),
      path: canvasFile(args),
      storage: "legacy-single-file",
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { snapshot: null, path: canvasPagesDir(args), storage: "empty" };
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tempFile, filePath);
}

async function saveStoredCanvasSnapshot(args, snapshot) {
  const pages = getPageRecords(snapshot);
  if (pages.length === 0) {
    await writeJsonAtomic(canvasFile(args), snapshot);
    return { storage: "legacy-single-file", paths: [canvasFile(args)] };
  }

  let previousManifest = null;
  try {
    previousManifest = await readJsonFile(pagesManifestFile(args));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const paths = [];
  for (const page of pages) {
    const filePath = pageFilePath(args, page.id);
    const pageSnapshot = await localizePageAssets(args, snapshotForPage(snapshot, page), page.id);
    await writeJsonAtomic(filePath, pageSnapshot);
    paths.push(filePath);
  }

  const manifest = {
    version: 1,
    source: "cowart",
    pages: pages.map((page) => ({
      id: page.id,
      name: page.name,
      index: page.index,
      path: relative(resolveCanvasDir(args), pageFilePath(args, page.id)),
    })),
  };
  await writeJsonAtomic(pagesManifestFile(args), manifest);

  const currentPageIds = new Set(pages.map((page) => page.id));
  for (const previousPage of previousManifest?.pages ?? []) {
    if (!nonEmptyString(previousPage?.id) || currentPageIds.has(previousPage.id)) continue;
    await rm(dirname(pageFilePath(args, previousPage.id)), { recursive: true, force: true });
  }

  return { storage: "per-page", paths };
}

async function hydrateSnapshotAssets(args, snapshot) {
  if (!snapshot) return { snapshot, hydratedAssets: [] };

  const hydrated = cloneJson(snapshot);
  const hydratedAssets = [];

  for (const record of Object.values(hydrated.store)) {
    if (record?.typeName !== "asset" || !["image", "video"].includes(record.type)) continue;
    const src = record.props?.src;
    if (typeof src !== "string" || src.startsWith("data:") || /^https?:\/\//.test(src)) continue;

    const filePath = await localAssetFilePathFromUrl(src, args);
    if (!filePath) continue;

    try {
      const buffer = await readFile(filePath);
      const mimeType = record.props.mimeType || mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream";
      record.props.src = `data:${mimeType};base64,${buffer.toString("base64")}`;
      record.props.mimeType = mimeType;
      record.props.fileSize = record.props.fileSize ?? buffer.length;
      hydratedAssets.push({ assetId: record.id, source: src, filePath });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return { snapshot: hydrated, hydratedAssets };
}

// Older drafts duplicate their saved HTML (and often embedded images) as a
// data URL in every full-document response. Replace that transport copy only
// when the safe local file contains exactly the same bytes. Reading never
// rewrites the user's canvas; a subsequent normal save can persist this URL.
async function compactFileBackedHtmlDrafts(args, snapshot) {
  if (!snapshot) return snapshot;
  let compacted = snapshot;
  for (const record of Object.values(snapshot.store)) {
    if (record?.typeName !== "shape" || record.type !== "embed") continue;
    const src = record.props?.url;
    const assetUrl = record.meta?.cowartHtmlDraftAssetUrl;
    if (!/^data:text\/html(?:;[^,]*)?,/i.test(String(src || "")) || typeof assetUrl !== "string") continue;
    try {
      const filePath = await localAssetFilePathFromUrl(assetUrl, args);
      if (!filePath || !/\.html?$/i.test(filePath)) continue;
      const inline = parseDataUrl(src);
      if (!inline || !(await readFile(filePath)).equals(inline.buffer)) continue;
      if (compacted === snapshot) compacted = { ...snapshot, store: { ...snapshot.store } };
      compacted.store[record.id] = {
        ...record,
        meta: { ...record.meta, cowartHtmlDraftContentHash: createHash("sha256").update(inline.buffer).digest("hex") },
        props: { ...record.props, url: `${HTML_DRAFT_URL_ORIGIN}${assetUrl}` },
      };
    } catch (_error) {
      // Missing, inaccessible, changed or malformed files retain their complete
      // inline fallback. Compaction must never discard the only valid content.
    }
  }
  return compacted;
}

export async function writeCowartPageAsset(args = {}, options = {}) {
  const pageId = nonEmptyString(options.pageId);
  if (!pageId) throw new Error("pageId is required to save a Cowart page asset.");

  const dataUrl = nonEmptyString(options.dataUrl);
  const dataBase64 = nonEmptyString(options.dataBase64);
  let parsed = null;
  if (dataUrl) {
    parsed = parseDataUrl(dataUrl);
  } else if (dataBase64) {
    parsed = {
      buffer: Buffer.from(dataBase64, "base64"),
      mimeType: nonEmptyString(options.mimeType) || "application/octet-stream",
    };
  }
  if (!parsed?.buffer?.length) {
    throw new Error("Expected a non-empty dataUrl or dataBase64 image payload.");
  }

  const mimeType = nonEmptyString(options.mimeType) || parsed.mimeType || "application/octet-stream";
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Cowart page assets only accept image payloads. Received ${mimeType}.`);
  }

  const canvasDir = resolveCanvasDir(args);
  const destinationDir = pageAssetsDir(args, pageId);
  if (!isSafeChildPath(canvasDir, destinationDir)) {
    throw new Error(`Unsafe Cowart page assets directory: ${destinationDir}`);
  }

  const requestedName = sanitizeAssetFileName(
    options.fileName,
    `reference-${Date.now()}`,
    mimeType,
  );
  const { fileName, filePath } = await uniqueAssetFilePath(destinationDir, requestedName);
  await mkdir(destinationDir, { recursive: true });
  await writeFile(filePath, parsed.buffer);

  return {
    ok: true,
    canvasDir,
    pageId,
    fileName,
    assetPath: filePath,
    assetUrl: pageAssetUrl(pageId, fileName),
    mimeType,
    fileSize: parsed.buffer.length,
  };
}

export async function readCowartPageAsset(args = {}, options = {}) {
  const assetUrl = nonEmptyString(options.assetUrl);
  if (!assetUrl) throw new Error("assetUrl is required to read a Cowart page asset.");
  if (!assetUrl.startsWith(PAGE_ASSETS_ROUTE) && !assetUrl.startsWith(GLOBAL_ASSETS_ROUTE)) {
    throw new Error(`Unsupported Cowart asset URL: ${assetUrl}`);
  }

  const filePath = await localAssetFilePathFromUrl(assetUrl, args);
  if (!filePath) throw new Error(`Unsafe Cowart asset URL: ${assetUrl}`);

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Cowart asset is not a file: ${assetUrl}`);

  const mimeType = mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream";
  if (!mimeType.startsWith("image/") && !["video/mp4", "video/webm", "video/quicktime", "text/html"].includes(mimeType)) {
    throw new Error(`Cowart page assets only expose image, supported video or HTML payloads. Received ${mimeType}.`);
  }

  const buffer = await readFile(filePath);
  return {
    ok: true,
    canvasDir: resolveCanvasDir(args),
    assetUrl,
    assetPath: filePath,
    mimeType,
    fileSize: fileStat.size,
    dataBase64: buffer.toString("base64"),
  };
}

export async function readCowartCanvasState(args = {}, options = {}) {
  try {
    await realpath(resolveCanvasDir(args));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    // A read of an unopened project stays read-only. Linearize this empty
    // result before any writer creates the directory, rather than reading a
    // potentially half-written document after that creation.
    return canvasStateFromStoredSnapshot(args, {
      snapshot: null, path: canvasPagesDir(args), storage: "empty",
    }, options);
  }
  return withCowartCanvasTransaction(args, () => readCowartCanvasStateInTransaction(args, options));
}

async function readCowartCanvasStateInTransaction(args, options) {
  const loaded = await loadStoredCanvasSnapshot(args);
  return canvasStateFromStoredSnapshot(args, loaded, options);
}

async function canvasStateFromStoredSnapshot(args, loaded, { hydrateAssets = false } = {}) {
  const { projectDir, canvasDir } = resolveCowartPaths(args);
  const compacted = await compactFileBackedHtmlDrafts(args, loaded.snapshot);
  const revision = canvasRevision(compacted);
  const hydrated = hydrateAssets
    ? await hydrateSnapshotAssets(args, compacted)
    : { snapshot: compacted, hydratedAssets: [] };
  const { viewState, viewStateFile } = await readCowartViewState(args);

  return {
    version: 1,
    projectDir,
    canvasDir,
    revision,
    snapshot: hydrated.snapshot,
    path: loaded.path,
    storage: loaded.storage,
    viewState,
    viewStateFile,
    selectionFile: resolveSelectionFile(args),
    hydratedAssets: hydrated.hydratedAssets,
  };
}

function canvasRevision(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export async function saveCowartCanvasSnapshot(args = {}, snapshot) {
  return withCowartCanvasTransaction(args, () => saveCowartCanvasSnapshotInTransaction(args, snapshot));
}

async function saveCowartCanvasSnapshotInTransaction(args = {}, snapshot) {
  const { sanitizeCanvasSnapshotForTldraw } = await import("../../src/canvasSnapshot.js");
  const sanitized = sanitizeCanvasSnapshotForTldraw(snapshot);
  if (!sanitized.snapshot) {
    return {
      ok: false,
      storage: "invalid",
      paths: [],
      skippedRecords: sanitized.skippedRecords,
    };
  }

  const previous = await loadStoredCanvasSnapshot(args);
  const previousRevision = canvasRevision(await compactFileBackedHtmlDrafts(args, previous.snapshot));
  if (args.expectedRevision !== undefined && args.expectedRevision !== previousRevision) {
    return {
      ok: false,
      storage: "revision-conflict",
      paths: [],
      revision: previousRevision,
      message: "Cowart canvas changed since this snapshot was loaded. The current canvas was preserved; reload before saving.",
    };
  }
  const imageLosses = await getUnacknowledgedImageLosses(args, previous.snapshot, sanitized.snapshot);
  if (imageLosses.length > 0) {
    return {
      ok: false,
      storage: "blocked-destructive-image-loss",
      paths: [],
      skippedRecords: sanitized.skippedRecords,
      blockedImageLosses: imageLosses,
      message: `Cowart refused to save because ${imageLosses.length} existing image shape(s) disappeared without a user delete confirmation.`,
    };
  }

  const compacted = await compactFileBackedHtmlDrafts(args, sanitized.snapshot);
  const result = await saveStoredCanvasSnapshot(args, compacted);
  const persisted = await loadStoredCanvasSnapshot(args);
  return {
    ok: true,
    ...result,
    revision: canvasRevision(await compactFileBackedHtmlDrafts(args, persisted.snapshot)),
    skippedRecords: sanitized.skippedRecords,
  };
}

export async function readCowartSelectionState(args = {}) {
  const selectionFile = resolveSelectionFile(args);
  try {
    const selection = await readJsonFile(selectionFile);
    if (!isSelectionState(selection)) {
      throw new Error(`Invalid selection state in ${selectionFile}`);
    }
    return { selection, selectionFile };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        selection: { selectedShapes: [], updatedAt: null },
        selectionFile,
      };
    }
    throw error;
  }
}

export async function writeCowartSelectionState(args = {}, selection) {
  if (!isSelectionState(selection)) {
    throw new Error("Expected a Cowart selection state.");
  }
  const selectionFile = resolveSelectionFile(args);
  const payload = {
    ...selection,
    updatedAt: selection.updatedAt ?? new Date().toISOString(),
  };
  await writeJsonAtomic(selectionFile, payload);
  return { ok: true, path: selectionFile, selection: payload };
}

export async function readCowartViewState(args = {}) {
  const viewStateFile = resolveViewStateFile(args);
  try {
    const viewState = await readJsonFile(viewStateFile);
    return { viewState: isViewState(viewState) ? viewState : defaultViewState(), viewStateFile };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { viewState: defaultViewState(), viewStateFile };
    }
    throw error;
  }
}

export async function writeCowartViewState(args = {}, viewState) {
  if (!isViewState(viewState)) {
    throw new Error("Expected a Cowart view state.");
  }
  const viewStateFile = resolveViewStateFile(args);
  const payload = {
    ...viewState,
    updatedAt: viewState.updatedAt ?? new Date().toISOString(),
  };
  await writeJsonAtomic(viewStateFile, payload);
  return { ok: true, path: viewStateFile, viewState: payload };
}
