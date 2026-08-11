import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { Store } from "@tldraw/store";
import { createTLSchema, toRichText } from "@tldraw/tlschema";
import { generateKeyBetween } from "fractional-indexing";

import { COWART_CARD_GEO } from "../../src/cowartGeoTypes.js";
import {
  readCowartCanvasState,
  readCowartSelectionState,
  resolveCanvasDir,
  resolveCowartPaths,
  saveCowartCanvasSnapshot,
} from "./canvas-storage.mjs";
import { estimateThinkingCardSize, layoutThinkingGraph } from "./thinking-layout.mjs";

const PAGE_PREFIX = "page:";
const SHAPE_PREFIX = "shape:";
const BINDING_PREFIX = "binding:";
const HISTORY_VERSION = 1;
const HISTORY_LIMIT = 20;
const MATERIAL_SIZE_LIMIT = 200 * 1024 * 1024;
const DEFAULT_CARD_WIDTH = 320;
const DEFAULT_CARD_HEIGHT = 200;
const DEFAULT_GAP = 48;
const MAX_CONTEXT_SHAPES = 250;
const MAX_CONTEXT_TEXT = 4_000;
const EMPTY_PAGE_ID = "page:cowart-thinking";

const THINKING_ROLES = new Set([
  "material",
  "idea",
  "evidence",
  "question",
  "insight",
  "assumption",
  "decision",
  "summary",
  "counterpoint",
]);

const CARD_COLORS = new Set([
  "black",
  "blue",
  "green",
  "grey",
  "light-blue",
  "light-green",
  "light-red",
  "light-violet",
  "orange",
  "red",
  "violet",
  "white",
  "yellow",
]);

const ROLE_COLORS = {
  material: "light-blue",
  idea: "light-violet",
  evidence: "light-green",
  question: "yellow",
  insight: "violet",
  assumption: "orange",
  decision: "green",
  summary: "blue",
  counterpoint: "light-red",
};

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ensureThinkingSnapshot(snapshot) {
  if (snapshot?.store && snapshot?.schema) return snapshot;
  return {
    schema: createTLSchema().serialize(),
    store: {
      [EMPTY_PAGE_ID]: {
        id: EMPTY_PAGE_ID,
        typeName: "page",
        name: "Thinking Canvas",
        index: "a0",
        meta: {},
      },
    },
  };
}

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boundedString(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

function safeRole(value, fallback = "idea") {
  return THINKING_ROLES.has(value) ? value : fallback;
}

function safeColor(value, role = "idea") {
  return CARD_COLORS.has(value) ? value : ROLE_COLORS[role] ?? "light-violet";
}

function diagramColor(value) {
  return CARD_COLORS.has(value) ? value : "black";
}

function safeIdPart(value, fallback = "item") {
  const normalized = String(value || fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

function uniqueId(store, prefix, seed) {
  const safeSeed = safeIdPart(seed);
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const suffix = attempt === 0 ? randomUUID().slice(0, 8) : `${attempt}-${randomUUID().slice(0, 6)}`;
    const id = `${prefix}${safeSeed}-${suffix}`;
    if (!store[id]) return id;
  }
  throw new Error(`Unable to allocate a unique ${prefix} id.`);
}

function isSafeChildPath(parent, child) {
  const pathToChild = relative(parent, child);
  return Boolean(pathToChild) && !pathToChild.startsWith("..") && !pathToChild.includes(`..${sep}`);
}

function plainTextFromRichText(richText) {
  const paragraphs = [];
  for (const block of richText?.content ?? []) {
    let text = "";
    const visit = (node) => {
      if (typeof node?.text === "string") text += node.text;
      for (const child of node?.content ?? []) visit(child);
    };
    visit(block);
    paragraphs.push(text);
  }
  return paragraphs.join("\n").trim();
}

function textForShape(shape) {
  if (!shape) return "";
  if (typeof shape.meta?.cowartThinkingBody === "string") {
    return shape.meta.cowartThinkingBody.trim();
  }
  if (shape.props?.richText) return plainTextFromRichText(shape.props.richText);
  if (typeof shape.props?.text === "string") return shape.props.text.trim();
  if (typeof shape.props?.name === "string") return shape.props.name.trim();
  if (typeof shape.props?.altText === "string") return shape.props.altText.trim();
  return "";
}

function localBounds(shape) {
  if (shape?.type === "arrow") {
    const start = shape.props?.start ?? { x: 0, y: 0 };
    const end = shape.props?.end ?? { x: 0, y: 0 };
    const minX = Math.min(finiteNumber(start.x, 0), finiteNumber(end.x, 0));
    const minY = Math.min(finiteNumber(start.y, 0), finiteNumber(end.y, 0));
    return {
      x: finiteNumber(shape.x, 0) + minX,
      y: finiteNumber(shape.y, 0) + minY,
      w: Math.max(1, Math.abs(finiteNumber(end.x, 0) - finiteNumber(start.x, 0))),
      h: Math.max(1, Math.abs(finiteNumber(end.y, 0) - finiteNumber(start.y, 0))),
    };
  }

  const scale = Math.max(0.01, finiteNumber(shape?.props?.scale, 1));
  return {
    x: finiteNumber(shape?.x, 0),
    y: finiteNumber(shape?.y, 0),
    w: Math.max(1, finiteNumber(shape?.props?.w, shape?.type === "text" ? 160 : DEFAULT_CARD_WIDTH) * scale),
    h: Math.max(1, (finiteNumber(shape?.props?.h, shape?.type === "text" ? 40 : DEFAULT_CARD_HEIGHT) + finiteNumber(shape?.props?.growY, 0)) * scale),
  };
}

function pageBounds(store, shape) {
  const bounds = localBounds(shape);
  let parentId = shape?.parentId;
  const visited = new Set([shape?.id]);
  while (typeof parentId === "string" && parentId.startsWith(SHAPE_PREFIX) && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = store[parentId];
    if (!parent) break;
    bounds.x += finiteNumber(parent.x, 0);
    bounds.y += finiteNumber(parent.y, 0);
    parentId = parent.parentId;
  }
  return bounds;
}

function unionBounds(boundsList) {
  if (boundsList.length === 0) return null;
  const minX = Math.min(...boundsList.map((bounds) => bounds.x));
  const minY = Math.min(...boundsList.map((bounds) => bounds.y));
  const maxX = Math.max(...boundsList.map((bounds) => bounds.x + bounds.w));
  const maxY = Math.max(...boundsList.map((bounds) => bounds.y + bounds.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function expandedBounds(bounds, padding) {
  if (!bounds) return null;
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  };
}

function boundsIntersect(first, second) {
  if (!first || !second) return false;
  return !(
    first.x + first.w < second.x ||
    second.x + second.w < first.x ||
    first.y + first.h < second.y ||
    second.y + second.h < first.y
  );
}

function pageIdForShape(store, shape) {
  let parentId = shape?.parentId;
  const visited = new Set([shape?.id]);
  while (typeof parentId === "string" && !visited.has(parentId)) {
    if (parentId.startsWith(PAGE_PREFIX)) return parentId;
    visited.add(parentId);
    parentId = store[parentId]?.parentId;
  }
  return null;
}

function pageShapes(store, pageId) {
  return Object.values(store).filter(
    (record) => record?.typeName === "shape" && pageIdForShape(store, record) === pageId,
  );
}

function firstPageId(snapshot) {
  return Object.values(snapshot?.store ?? {})
    .filter((record) => record?.typeName === "page")
    .sort((a, b) => String(a.index ?? "").localeCompare(String(b.index ?? "")))[0]?.id ?? null;
}

function resolvePageId(snapshot, requestedPageId, viewState) {
  const store = snapshot?.store ?? {};
  const candidates = [requestedPageId, viewState?.currentPageId, firstPageId(snapshot)];
  const pageId = candidates.find((candidate) => typeof candidate === "string" && store[candidate]?.typeName === "page");
  if (!pageId) throw new Error("Yogurt AI canvas has no usable page.");
  return pageId;
}

function selectedShapeIds(selection) {
  return new Set(
    (selection?.selectedShapes ?? [])
      .map((shape) => shape?.id)
      .filter((id) => typeof id === "string"),
  );
}

function isAnnotationShape(shape) {
  if (!shape) return false;
  if (shape.meta?.cowartAnnotationArrow === true || shape.meta?.cowartAnnotationText === true) return true;
  if (!["arrow", "draw", "highlight", "text"].includes(shape.type)) return false;
  return ["red", "orange", "yellow"].includes(shape.props?.color) ||
    ["red", "orange", "yellow"].includes(shape.props?.labelColor);
}

function inferShapeRole(shape) {
  if (THINKING_ROLES.has(shape?.meta?.cowartThinkingRole)) return shape.meta.cowartThinkingRole;
  if (isAnnotationShape(shape)) return "annotation";
  if (shape?.meta?.cowartThinkingMaterial === true) return "material";
  if (shape?.meta?.cowartHtmlDraft === true || shape?.meta?.cowartAiDraftHolder === true) return "visual";
  if (shape?.type === "image") return "image";
  if (shape?.type === "arrow") return "relation";
  return "canvas-object";
}

function compactSource(meta) {
  const source = meta?.cowartThinkingSource;
  if (!source || typeof source !== "object") return null;
  return {
    kind: boundedString(source.kind, 32) || null,
    fileName: boundedString(source.fileName, 240) || null,
    localPath: boundedString(source.localPath, 2_000) || null,
    originalPath: boundedString(source.originalPath, 2_000) || null,
    excerpt: boundedString(source.excerpt, 1_500) || null,
    fileSize: finiteNumber(source.fileSize, null),
  };
}

function shapeContext(store, shape, selected, maxTextLength) {
  const asset = shape?.props?.assetId ? store[shape.props.assetId] : null;
  return {
    id: shape.id,
    type: shape.type,
    role: inferShapeRole(shape),
    selected,
    bounds: pageBounds(store, shape),
    title: boundedString(shape.meta?.cowartThinkingTitle, 300) || null,
    text: boundedString(textForShape(shape), maxTextLength) || null,
    source: compactSource(shape.meta),
    sourceRefs: Array.isArray(shape.meta?.cowartThinkingSourceRefs)
      ? shape.meta.cowartThinkingSourceRefs.filter((value) => typeof value === "string").slice(0, 50)
      : [],
    relation: shape.meta?.cowartThinkingRelation === true
      ? {
          fromId: shape.meta.cowartThinkingFromShapeId ?? null,
          toId: shape.meta.cowartThinkingToShapeId ?? null,
          kind: shape.meta.cowartThinkingRelationKind ?? "relates-to",
        }
      : null,
    asset: asset
      ? {
          id: asset.id,
          type: asset.type,
          name: asset.props?.name ?? null,
          src: asset.props?.src ?? null,
          mimeType: asset.props?.mimeType ?? null,
        }
      : null,
    generatedByAgent: shape.meta?.cowartThinkingGenerated === true,
  };
}

export function snapshotRevision(snapshot) {
  const content = JSON.stringify(snapshot?.store ?? {});
  return createHash("sha256").update(content).digest("hex").slice(0, 20);
}

export function summarizeThinkingContext({
  snapshot,
  selection = { selectedShapes: [] },
  viewState = null,
  pageId: requestedPageId,
  scope = "page",
  includeAnnotations = true,
  maxShapes = MAX_CONTEXT_SHAPES,
  maxTextLength = MAX_CONTEXT_TEXT,
} = {}) {
  if (!snapshot?.store || !snapshot?.schema) throw new Error("Expected a valid Yogurt AI snapshot.");
  const store = snapshot.store;
  const pageId = resolvePageId(snapshot, requestedPageId, viewState);
  const selectedIds = selectedShapeIds(selection);
  const allShapes = pageShapes(store, pageId);
  const selectedRelationIds = new Set();
  const selectedBounds = unionBounds(
    allShapes
      .filter((shape) => selectedIds.has(shape.id))
      .map((shape) => pageBounds(store, shape)),
  );
  const annotationRegion = expandedBounds(selectedBounds, 160);

  if (scope === "selection" && selectedIds.size > 0) {
    for (const shape of allShapes) {
      if (
        shape.meta?.cowartThinkingRelation === true &&
        (selectedIds.has(shape.meta?.cowartThinkingFromShapeId) || selectedIds.has(shape.meta?.cowartThinkingToShapeId))
      ) {
        selectedRelationIds.add(shape.id);
      }
    }
  }

  const filtered = allShapes.filter((shape) => {
    if (!includeAnnotations && isAnnotationShape(shape)) return false;
    if (scope !== "selection" || selectedIds.size === 0) return true;
    return (
      selectedIds.has(shape.id) ||
      selectedRelationIds.has(shape.id) ||
      (includeAnnotations && isAnnotationShape(shape) && boundsIntersect(pageBounds(store, shape), annotationRegion))
    );
  });

  const limited = filtered.slice(0, Math.max(1, Math.min(maxShapes, MAX_CONTEXT_SHAPES)));
  return {
    version: 1,
    revision: snapshotRevision(snapshot),
    pageId,
    scope: scope === "selection" && selectedIds.size > 0 ? "selection" : "page",
    selection: Array.from(selectedIds),
    shapes: limited.map((shape) =>
      shapeContext(store, shape, selectedIds.has(shape.id), Math.max(200, Math.min(maxTextLength, MAX_CONTEXT_TEXT))),
    ),
    truncated: filtered.length > limited.length,
    omittedShapeCount: Math.max(0, filtered.length - limited.length),
  };
}

function lastShapeIndex(store, parentId) {
  const indexes = Object.values(store)
    .filter((record) => record?.typeName === "shape" && record.parentId === parentId && typeof record.index === "string")
    .map((record) => record.index)
    .sort();
  return indexes.at(-1) ?? null;
}

function nextIndex(store, parentId) {
  return generateKeyBetween(lastShapeIndex(store, parentId), null);
}

function formatCardText(title, body) {
  return [title, body].filter(Boolean).join("\n\n");
}

function cardPosition(store, pageId, operation, width, height, createdCount) {
  if (Number.isFinite(operation.x) && Number.isFinite(operation.y)) {
    return { x: operation.x, y: operation.y };
  }

  const anchor = typeof operation.anchorId === "string" ? store[operation.anchorId] : null;
  if (anchor?.typeName === "shape") {
    const bounds = pageBounds(store, anchor);
    const gap = Math.max(0, finiteNumber(operation.gap, DEFAULT_GAP));
    const placement = ["right", "left", "below", "above"].includes(operation.placement)
      ? operation.placement
      : "right";
    if (placement === "left") return { x: bounds.x - width - gap, y: bounds.y };
    if (placement === "below") return { x: bounds.x, y: bounds.y + bounds.h + gap };
    if (placement === "above") return { x: bounds.x, y: bounds.y - height - gap };
    return { x: bounds.x + bounds.w + gap, y: bounds.y };
  }

  const shapes = pageShapes(store, pageId).filter((shape) => shape.type !== "arrow");
  const rightEdge = shapes.reduce((max, shape) => {
    const bounds = pageBounds(store, shape);
    return Math.max(max, bounds.x + bounds.w);
  }, 0);
  return {
    x: rightEdge + DEFAULT_GAP + (createdCount % 2) * (width + DEFAULT_GAP),
    y: Math.floor(createdCount / 2) * (height + DEFAULT_GAP),
  };
}

function createCardRecord(store, pageId, operation, createdCount) {
  const role = safeRole(operation.role);
  const title = boundedString(operation.title, 300, role);
  const body = boundedString(operation.body, 12_000);
  if (!title && !body) throw new Error("create_card requires a title or body.");
  const dimensions = estimateThinkingCardSize({ title, body, w: operation.w, h: operation.h });
  const width = dimensions.w;
  const height = dimensions.h;
  const position = cardPosition(store, pageId, operation, width, height, createdCount);
  const id = uniqueId(store, SHAPE_PREFIX, operation.key || title || role);
  const timestamp = new Date().toISOString();
  const source = operation.source && typeof operation.source === "object" ? cloneJson(operation.source) : null;

  return {
    id,
    typeName: "shape",
    type: "geo",
    x: position.x,
    y: position.y,
    rotation: 0,
    index: nextIndex(store, pageId),
    parentId: pageId,
    isLocked: false,
    opacity: 1,
    props: {
      geo: COWART_CARD_GEO,
      dash: "draw",
      url: boundedString(operation.url, 2_000),
      w: width,
      h: height,
      growY: 0,
      scale: 1,
      labelColor: "black",
      color: diagramColor(operation.color),
      fill: "none",
      size: "s",
      font: "draw",
      align: body ? "start" : "middle",
      verticalAlign: body ? "start" : "middle",
      richText: toRichText(formatCardText(title, body)),
    },
    meta: {
      cowartThinkingCard: true,
      cowartThinkingGenerated: operation.generated !== false,
      cowartThinkingMaterial: role === "material",
      cowartThinkingRole: role,
      cowartThinkingTitle: title,
      cowartThinkingBody: body,
      cowartThinkingSource: source,
      cowartThinkingSourceRefs: Array.isArray(operation.sourceRefs)
        ? operation.sourceRefs.filter((value) => typeof value === "string").slice(0, 50)
        : [],
      cowartThinkingCreatedAt: timestamp,
      cowartThinkingUpdatedAt: timestamp,
    },
  };
}

function resolveShapeReference(store, references, value, label) {
  const id = references.get(value) ?? value;
  const shape = typeof id === "string" ? store[id] : null;
  if (!shape || shape.typeName !== "shape") throw new Error(`${label} does not reference a canvas shape: ${value}`);
  return shape;
}

function assertManagedOrExplicitEdit(shape, allowUserAuthoredEdits, operationType) {
  const managed = shape.meta?.cowartThinkingCard === true || shape.meta?.cowartThinkingGenerated === true;
  if (!managed && !allowUserAuthoredEdits) {
    throw new Error(`Refusing to ${operationType} user-authored shape ${shape.id} without allowUserAuthoredEdits.`);
  }
}

function updateThinkingCard(store, operation, allowUserAuthoredEdits) {
  const shape = resolveShapeReference(store, new Map(), operation.id, "update_card.id");
  const isThinkingCard = shape.meta?.cowartThinkingCard === true;
  if (!isThinkingCard && !allowUserAuthoredEdits) {
    throw new Error(`Refusing to edit user-authored shape ${shape.id} without allowUserAuthoredEdits.`);
  }
  if (!shape.props?.richText) throw new Error(`Shape ${shape.id} does not contain editable rich text.`);

  const role = safeRole(operation.role, shape.meta?.cowartThinkingRole ?? "idea");
  const title = operation.title === undefined
    ? boundedString(shape.meta?.cowartThinkingTitle, 300)
    : boundedString(operation.title, 300);
  const body = operation.body === undefined
    ? boundedString(shape.meta?.cowartThinkingBody ?? textForShape(shape), 12_000)
    : boundedString(operation.body, 12_000);
  const updated = {
    ...shape,
    props: {
      ...shape.props,
      color: operation.color === undefined ? shape.props.color : safeColor(operation.color, role),
      richText: toRichText(formatCardText(title, body)),
    },
    meta: {
      ...shape.meta,
      cowartThinkingRole: role,
      cowartThinkingTitle: title,
      cowartThinkingBody: body,
      cowartThinkingUpdatedAt: new Date().toISOString(),
    },
  };
  store[shape.id] = updated;
  return updated;
}

function createRelationRecords(store, operation, references) {
  const from = resolveShapeReference(store, references, operation.from, "create_relation.from");
  const to = resolveShapeReference(store, references, operation.to, "create_relation.to");
  if (from.id === to.id) throw new Error("create_relation requires two different shapes.");
  const fromBounds = pageBounds(store, from);
  const toBounds = pageBounds(store, to);
  const fromCenter = { x: fromBounds.x + fromBounds.w / 2, y: fromBounds.y + fromBounds.h / 2 };
  const toCenter = { x: toBounds.x + toBounds.w / 2, y: toBounds.y + toBounds.h / 2 };
  const arrowId = uniqueId(store, SHAPE_PREFIX, operation.key || "relation");
  const relationKind = boundedString(operation.kind, 80, "relates-to");
  const label = boundedString(operation.label, 300);
  const pageId = pageIdForShape(store, from);
  if (!pageId || pageId !== pageIdForShape(store, to)) {
    throw new Error("create_relation shapes must be on the same page.");
  }

  const arrow = {
    id: arrowId,
    typeName: "shape",
    type: "arrow",
    x: fromCenter.x,
    y: fromCenter.y,
    rotation: 0,
    index: nextIndex(store, pageId),
    parentId: pageId,
    isLocked: false,
    opacity: 1,
    props: {
      kind: "arc",
      elbowMidPoint: 0.5,
      dash: operation.dash === "dashed" ? "dashed" : "draw",
      size: "s",
      fill: "none",
      color: diagramColor(operation.color),
      labelColor: "black",
      bend: 0,
      start: { x: 0, y: 0 },
      end: { x: toCenter.x - fromCenter.x, y: toCenter.y - fromCenter.y },
      arrowheadStart: "none",
      arrowheadEnd: "arrow",
      richText: toRichText(label),
      labelPosition: 0.5,
      font: "draw",
      scale: 1,
    },
    meta: {
      cowartThinkingGenerated: true,
      cowartThinkingRelation: true,
      cowartThinkingRelationKind: relationKind,
      cowartThinkingFromShapeId: from.id,
      cowartThinkingToShapeId: to.id,
      cowartThinkingCreatedAt: new Date().toISOString(),
    },
  };
  store[arrowId] = arrow;

  for (const [terminal, target] of [["start", from], ["end", to]]) {
    const bindingId = uniqueId(store, BINDING_PREFIX, `${arrowId}-${terminal}`);
    store[bindingId] = {
      id: bindingId,
      typeName: "binding",
      type: "arrow",
      fromId: arrowId,
      toId: target.id,
      props: {
        terminal,
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
        snap: "none",
      },
      meta: { cowartThinkingGenerated: true },
    };
  }
  return arrow;
}

function layoutCreatedThinkingGraph(store, pageId, createdCards, createdRelations) {
  if (createdCards.length < 2 || createdRelations.length === 0) return;
  if (
    createdCards.some(({ operation }) =>
      Boolean(
        operation.anchorId || Number.isFinite(operation.x) || Number.isFinite(operation.y),
      ),
    )
  ) {
    return;
  }

  const createdIds = new Set(createdCards.map(({ id }) => id));
  const nodes = createdCards.map(({ id }) => {
    const shape = store[id];
    return { id, w: shape.props.w, h: shape.props.h };
  });
  const edges = createdRelations
    .map((id) => store[id])
    .filter(Boolean)
    .map((arrow) => ({
      from: arrow.meta?.cowartThinkingFromShapeId,
      to: arrow.meta?.cowartThinkingToShapeId,
    }))
    .filter((edge) => createdIds.has(edge.from) && createdIds.has(edge.to));
  if (edges.length === 0) return;

  const existingBounds = unionBounds(
    pageShapes(store, pageId)
      .filter((shape) => shape.type !== "arrow" && !createdIds.has(shape.id))
      .map((shape) => pageBounds(store, shape)),
  );
  const positions = layoutThinkingGraph({
    nodes,
    edges,
    originX: existingBounds ? existingBounds.x + existingBounds.w + DEFAULT_GAP * 2 : 0,
    originY: existingBounds?.y ?? 0,
  });

  for (const [id, position] of positions) {
    store[id].x = position.x;
    store[id].y = position.y;
  }

  for (const relationId of createdRelations) {
    const arrow = store[relationId];
    const from = store[arrow?.meta?.cowartThinkingFromShapeId];
    const to = store[arrow?.meta?.cowartThinkingToShapeId];
    if (!arrow || !from || !to) continue;
    const fromBounds = pageBounds(store, from);
    const toBounds = pageBounds(store, to);
    const fromCenter = { x: fromBounds.x + fromBounds.w / 2, y: fromBounds.y + fromBounds.h / 2 };
    const toCenter = { x: toBounds.x + toBounds.w / 2, y: toBounds.y + toBounds.h / 2 };
    arrow.x = fromCenter.x;
    arrow.y = fromCenter.y;
    arrow.props.start = { x: 0, y: 0 };
    arrow.props.end = { x: toCenter.x - fromCenter.x, y: toCenter.y - fromCenter.y };
  }
}

function descendantShapeIds(store, rootId) {
  const result = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of Object.values(store)) {
      if (record?.typeName === "shape" && result.has(record.parentId) && !result.has(record.id)) {
        result.add(record.id);
        changed = true;
      }
    }
  }
  return result;
}

function deleteGeneratedShape(store, operation, references) {
  const shape = resolveShapeReference(store, references, operation.id, "delete_shape.id");
  if (shape.meta?.cowartThinkingGenerated !== true) {
    throw new Error(`Refusing to delete non-agent shape ${shape.id}.`);
  }
  const shapeIds = descendantShapeIds(store, shape.id);
  for (const record of Object.values(store)) {
    if (
      shapeIds.has(record.id) ||
      (record?.typeName === "binding" && (shapeIds.has(record.fromId) || shapeIds.has(record.toId)))
    ) {
      delete store[record.id];
    }
  }
  return Array.from(shapeIds);
}

function validateOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("At least one thinking operation is required.");
  }
  if (operations.length > 100) throw new Error("A thinking operation batch is limited to 100 operations.");
  const supported = new Set([
    "create_card",
    "update_card",
    "move_shape",
    "resize_shape",
    "create_relation",
    "delete_shape",
  ]);
  for (const operation of operations) {
    if (!operation || typeof operation !== "object" || !supported.has(operation.type)) {
      throw new Error(`Unsupported thinking operation: ${operation?.type ?? "missing type"}`);
    }
  }
}

export function applyThinkingOperationsToSnapshot({
  snapshot,
  viewState = null,
  pageId: requestedPageId,
  operations,
  allowUserAuthoredEdits = false,
} = {}) {
  if (!snapshot?.store || !snapshot?.schema) throw new Error("Expected a valid Yogurt AI snapshot.");
  validateOperations(operations);
  const nextSnapshot = cloneJson(snapshot);
  const store = nextSnapshot.store;
  const pageId = resolvePageId(nextSnapshot, requestedPageId, viewState);
  const references = new Map();
  const changes = [];
  const createdCards = [];
  const createdRelations = [];
  let createdCount = 0;

  for (const operation of operations) {
    if (operation.type === "create_card") {
      const card = createCardRecord(store, pageId, operation, createdCount);
      store[card.id] = card;
      if (typeof operation.key === "string" && operation.key.trim()) references.set(operation.key, card.id);
      createdCards.push({ id: card.id, operation });
      changes.push({ type: operation.type, id: card.id, key: operation.key ?? null });
      createdCount += 1;
      continue;
    }

    if (operation.type === "update_card") {
      const updated = updateThinkingCard(store, operation, allowUserAuthoredEdits);
      changes.push({ type: operation.type, id: updated.id });
      continue;
    }

    if (operation.type === "move_shape") {
      const shape = resolveShapeReference(store, references, operation.id, "move_shape.id");
      assertManagedOrExplicitEdit(shape, allowUserAuthoredEdits, "move");
      shape.x = finiteNumber(operation.x, shape.x);
      shape.y = finiteNumber(operation.y, shape.y);
      changes.push({ type: operation.type, id: shape.id, x: shape.x, y: shape.y });
      continue;
    }

    if (operation.type === "resize_shape") {
      const shape = resolveShapeReference(store, references, operation.id, "resize_shape.id");
      assertManagedOrExplicitEdit(shape, allowUserAuthoredEdits, "resize");
      if (!("w" in (shape.props ?? {})) || !("h" in (shape.props ?? {}))) {
        throw new Error(`Shape ${shape.id} cannot be resized with width and height.`);
      }
      shape.props.w = Math.max(16, Math.min(8_192, finiteNumber(operation.w, shape.props.w)));
      shape.props.h = Math.max(16, Math.min(8_192, finiteNumber(operation.h, shape.props.h)));
      changes.push({ type: operation.type, id: shape.id, w: shape.props.w, h: shape.props.h });
      continue;
    }

    if (operation.type === "create_relation") {
      const arrow = createRelationRecords(store, operation, references);
      if (typeof operation.key === "string" && operation.key.trim()) references.set(operation.key, arrow.id);
      createdRelations.push(arrow.id);
      changes.push({ type: operation.type, id: arrow.id, key: operation.key ?? null });
      continue;
    }

    if (operation.type === "delete_shape") {
      const deletedIds = deleteGeneratedShape(store, operation, references);
      changes.push({ type: operation.type, id: operation.id, deletedIds });
    }
  }

  layoutCreatedThinkingGraph(store, pageId, createdCards, createdRelations);

  return {
    snapshot: nextSnapshot,
    pageId,
    changes,
    references: Object.fromEntries(references),
    revision: snapshotRevision(nextSnapshot),
  };
}

function validateSnapshot(snapshot) {
  try {
    const validationStore = new Store({
      schema: createTLSchema(),
      props: { defaultName: "Yogurt AI" },
    });
    validationStore.loadStoreSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    throw new Error(`Thinking operations produced an invalid canvas snapshot: ${error.message}`, { cause: error });
  }
}

function historyDirectory(args) {
  return join(resolveCanvasDir(args), "thinking-history");
}

function historyFile(args, operationId) {
  return join(historyDirectory(args), `${safeIdPart(operationId, "operation")}.json`);
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function pruneHistory(args) {
  const directory = historyDirectory(args);
  let files;
  try {
    files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const fileName of files.slice(HISTORY_LIMIT)) {
    await rm(join(directory, fileName), { force: true });
  }
}

export async function getThinkingContext(args = {}, options = {}) {
  const [state, selectionState] = await Promise.all([
    readCowartCanvasState(args, { hydrateAssets: false }),
    readCowartSelectionState(args),
  ]);
  return {
    ...summarizeThinkingContext({
      snapshot: ensureThinkingSnapshot(state.snapshot),
      selection: selectionState.selection,
      viewState: state.viewState,
      pageId: options.pageId,
      scope: options.scope,
      includeAnnotations: options.includeAnnotations,
      maxShapes: options.maxShapes,
      maxTextLength: options.maxTextLength,
    }),
    projectDir: state.projectDir,
    canvasDir: state.canvasDir,
  };
}

export async function applyThinkingOperations(args = {}, options = {}) {
  const state = await readCowartCanvasState(args, { hydrateAssets: false });
  const currentSnapshot = ensureThinkingSnapshot(state.snapshot);
  const currentRevision = snapshotRevision(currentSnapshot);
  if (options.baseRevision && options.baseRevision !== currentRevision) {
    throw new Error(`Canvas revision changed from ${options.baseRevision} to ${currentRevision}; inspect again before applying.`);
  }

  const result = applyThinkingOperationsToSnapshot({
    snapshot: currentSnapshot,
    viewState: state.viewState,
    pageId: options.pageId,
    operations: options.operations,
    allowUserAuthoredEdits: options.allowUserAuthoredEdits === true,
  });
  result.snapshot = await validateSnapshot(result.snapshot);
  result.revision = snapshotRevision(result.snapshot);

  if (options.dryRun === true) {
    return {
      ok: true,
      applied: false,
      baseRevision: currentRevision,
      resultRevision: result.revision,
      pageId: result.pageId,
      changes: result.changes,
      references: result.references,
    };
  }

  const operationId = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 8)}`;
  const history = {
    version: HISTORY_VERSION,
    operationId,
    createdAt: new Date().toISOString(),
    reason: boundedString(options.reason, 2_000, "Canvas thinking edit"),
    explanation: boundedString(options.explanation, 8_000),
    baseRevision: currentRevision,
    resultRevision: result.revision,
    pageId: result.pageId,
    changes: result.changes,
    beforeSnapshot: currentSnapshot,
  };
  const persistedHistoryPath = historyFile(args, operationId);
  await writeJsonAtomic(persistedHistoryPath, history);

  let saveResult;
  try {
    saveResult = await saveCowartCanvasSnapshot(args, result.snapshot);
    if (!saveResult.ok) {
      throw new Error(saveResult.message || "Yogurt AI refused to persist the thinking operation batch.");
    }
  } catch (error) {
    await rm(persistedHistoryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await pruneHistory(args);

  return {
    ok: true,
    applied: true,
    operationId,
    baseRevision: currentRevision,
    resultRevision: result.revision,
    pageId: result.pageId,
    changes: result.changes,
    references: result.references,
    explanation: history.explanation,
    storage: saveResult.storage,
  };
}

async function readHistoryEntries(args) {
  const directory = historyDirectory(args);
  let entries;
  try {
    entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const histories = [];
  for (const fileName of entries) {
    try {
      histories.push({ filePath: join(directory, fileName), value: JSON.parse(await readFile(join(directory, fileName), "utf8")) });
    } catch (_error) {
      // Ignore malformed history entries; they cannot be safely used for undo.
    }
  }
  return histories;
}

export async function undoThinkingOperation(args = {}, options = {}) {
  const histories = await readHistoryEntries(args);
  const candidate = histories.find(({ value }) =>
    !value.undoneAt && (!options.operationId || value.operationId === options.operationId),
  );
  if (!candidate) throw new Error(options.operationId ? `Unknown or already undone operation ${options.operationId}.` : "No thinking operation is available to undo.");

  const state = await readCowartCanvasState(args, { hydrateAssets: false });
  const currentRevision = snapshotRevision(state.snapshot);
  if (currentRevision !== candidate.value.resultRevision) {
    throw new Error(
      `Refusing stale undo: canvas revision is ${currentRevision}, but operation ${candidate.value.operationId} produced ${candidate.value.resultRevision}.`,
    );
  }

  const beforeSnapshot = await validateSnapshot(candidate.value.beforeSnapshot);
  const saveResult = await saveCowartCanvasSnapshot(args, beforeSnapshot);
  if (!saveResult.ok) throw new Error(saveResult.message || "Yogurt AI refused to persist the undo snapshot.");

  const updatedHistory = {
    ...candidate.value,
    undoneAt: new Date().toISOString(),
    undoRevision: snapshotRevision(beforeSnapshot),
  };
  await writeJsonAtomic(candidate.filePath, updatedHistory);
  return {
    ok: true,
    operationId: candidate.value.operationId,
    revision: updatedHistory.undoRevision,
    restoredChangeCount: candidate.value.changes?.length ?? 0,
    storage: saveResult.storage,
  };
}

function sanitizedMaterialName(fileName) {
  const ext = extname(fileName).slice(0, 16);
  const stem = basename(fileName, ext)
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "material";
  return `${stem}${ext}`;
}

async function uniqueMaterialPath(directory, requestedName) {
  const safeName = sanitizedMaterialName(requestedName);
  const extension = extname(safeName);
  const stem = basename(safeName, extension);
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const name = attempt === 0 ? safeName : `${stem}-${attempt}${extension}`;
    const filePath = join(directory, name);
    try {
      await stat(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return { fileName: name, filePath };
      throw error;
    }
  }
  throw new Error(`Unable to allocate material path for ${safeName}.`);
}

export async function importThinkingMaterial(args = {}, options = {}) {
  const sourcePath = resolve(String(options.sourcePath || ""));
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) throw new Error(`Thinking material is not a file: ${sourcePath}`);
  if (sourceStat.size > MATERIAL_SIZE_LIMIT) throw new Error("Thinking material exceeds the 200 MB MVP limit.");

  const { projectDir, canvasDir } = resolveCowartPaths(args);
  if (!options.allowExternalSource && sourcePath !== projectDir && !isSafeChildPath(projectDir, sourcePath)) {
    throw new Error("Material must be inside the active project unless allowExternalSource is explicitly enabled.");
  }

  let localPath = sourcePath;
  let copied = false;
  if (options.copySource !== false) {
    const directory = join(canvasDir, "materials");
    if (!isSafeChildPath(canvasDir, directory)) throw new Error(`Unsafe material directory: ${directory}`);
    const destination = await uniqueMaterialPath(directory, options.fileName || basename(sourcePath));
    if (options.dryRun !== true) {
      await mkdir(directory, { recursive: true });
      await copyFile(sourcePath, destination.filePath);
      copied = true;
    }
    localPath = destination.filePath;
  }

  const source = {
    kind: boundedString(options.kind, 32, extname(sourcePath).slice(1).toLowerCase() || "file"),
    fileName: boundedString(options.fileName, 240, basename(sourcePath)),
    originalPath: sourcePath,
    localPath,
    excerpt: boundedString(options.excerpt, 3_000),
    fileSize: sourceStat.size,
  };

  try {
    const result = await applyThinkingOperations(args, {
      baseRevision: options.baseRevision,
      pageId: options.pageId,
      dryRun: options.dryRun,
      reason: options.reason || `Import material ${source.fileName}`,
      explanation: options.explanation || "Attached source material as a provenance-preserving canvas card.",
      operations: [
        {
          type: "create_card",
          key: "material",
          role: "material",
          generated: false,
          title: options.title || source.fileName,
          body: options.summary || source.excerpt || "Source material",
          color: options.color || "light-blue",
          x: options.x,
          y: options.y,
          w: options.w ?? 360,
          h: options.h ?? 220,
          source,
        },
      ],
    });
    return { ...result, source, copied: options.dryRun === true ? false : copied };
  } catch (error) {
    if (copied && isSafeChildPath(canvasDir, localPath)) await rm(localPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
