const MIN_CARD_WIDTH = 180;
const MAX_CARD_WIDTH = 560;
const MIN_CARD_HEIGHT = 96;
const MAX_CARD_HEIGHT = 460;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function textUnits(value) {
  let units = 0;
  for (const character of String(value || "")) {
    if (character === "\n") continue;
    units += /[\u2e80-\u9fff\uf900-\ufaff]/u.test(character) ? 1 : 0.56;
  }
  return units;
}

function estimatedLines(value, unitsPerLine) {
  if (!value) return 0;
  return String(value)
    .split(/\r?\n/u)
    .reduce((total, line) => total + Math.max(1, Math.ceil(textUnits(line) / unitsPerLine)), 0);
}

export function estimateThinkingCardSize({ title = "", body = "", w, h } = {}) {
  const hasBody = Boolean(String(body).trim());
  const titleWidth = 72 + textUnits(title) * 19;
  const bodyWidth = 300 + Math.sqrt(Math.max(1, textUnits(body))) * 12;
  const width = clamp(
    Number.isFinite(w) ? w : hasBody ? bodyWidth : titleWidth,
    MIN_CARD_WIDTH,
    MAX_CARD_WIDTH,
  );

  if (Number.isFinite(h)) {
    return { w: width, h: clamp(h, 80, 2_000) };
  }

  if (!hasBody) return { w: width, h: MIN_CARD_HEIGHT };

  const contentWidth = Math.max(120, width - 48);
  const unitsPerLine = Math.max(8, contentWidth / 18);
  const titleLines = estimatedLines(title, unitsPerLine);
  const bodyLines = estimatedLines(body, unitsPerLine);
  const height = 40 + titleLines * 27 + bodyLines * 25 + (title && body ? 18 : 0);
  return { w: width, h: clamp(height, 128, MAX_CARD_HEIGHT) };
}

export function layoutThinkingGraph({
  nodes,
  edges,
  originX = 0,
  originY = 0,
  horizontalGap = 72,
  verticalGap = 104,
} = {}) {
  const validNodes = Array.isArray(nodes)
    ? nodes.filter((node) => node?.id && Number.isFinite(node.w) && Number.isFinite(node.h))
    : [];
  if (validNodes.length === 0) return new Map();

  const nodeIds = new Set(validNodes.map((node) => node.id));
  const outgoing = new Map(validNodes.map((node) => [node.id, []]));
  const indegree = new Map(validNodes.map((node) => [node.id, 0]));

  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!nodeIds.has(edge?.from) || !nodeIds.has(edge?.to) || edge.from === edge.to) continue;
    if (outgoing.get(edge.from).includes(edge.to)) continue;
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }

  const level = new Map(validNodes.map((node) => [node.id, 0]));
  const remainingIndegree = new Map(indegree);
  const queue = validNodes.filter((node) => remainingIndegree.get(node.id) === 0).map((node) => node.id);
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of outgoing.get(current)) {
      level.set(child, Math.max(level.get(child), level.get(current) + 1));
      remainingIndegree.set(child, remainingIndegree.get(child) - 1);
      if (remainingIndegree.get(child) === 0) queue.push(child);
    }
  }

  for (const node of validNodes) {
    if (!visited.has(node.id)) level.set(node.id, 0);
  }

  const rows = new Map();
  for (const node of validNodes) {
    const row = rows.get(level.get(node.id)) ?? [];
    row.push(node);
    rows.set(level.get(node.id), row);
  }

  const orderedRows = [...rows.entries()].sort(([first], [second]) => first - second);
  const rowWidths = orderedRows.map(([, row]) =>
    row.reduce((total, node) => total + node.w, 0) + horizontalGap * Math.max(0, row.length - 1),
  );
  const graphWidth = Math.max(...rowWidths);
  const positions = new Map();
  let y = originY;

  orderedRows.forEach(([, row], rowIndex) => {
    let x = originX + (graphWidth - rowWidths[rowIndex]) / 2;
    const rowHeight = Math.max(...row.map((node) => node.h));
    for (const node of row) {
      positions.set(node.id, { x, y: y + (rowHeight - node.h) / 2 });
      x += node.w + horizontalGap;
    }
    y += rowHeight + verticalGap;
  });

  return positions;
}
