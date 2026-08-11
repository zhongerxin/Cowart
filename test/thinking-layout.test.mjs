import assert from "node:assert/strict";
import test from "node:test";

import { createTLSchema } from "@tldraw/tlschema";

import { applyThinkingOperationsToSnapshot } from "../mcp/lib/thinking-canvas.mjs";
import { estimateThinkingCardSize, layoutThinkingGraph } from "../mcp/lib/thinking-layout.mjs";

function emptySnapshot() {
  return {
    schema: createTLSchema().serialize(),
    store: {
      "page:test": {
        id: "page:test",
        typeName: "page",
        name: "Test",
        index: "a0",
        meta: {},
      },
    },
  };
}

test("sizes concise concepts and detailed cards to their content", () => {
  const concept = estimateThinkingCardSize({ title: "470 AI 助手" });
  const detail = estimateThinkingCardSize({
    title: "可视化",
    body: "识别选中的积木与逻辑块，并将变量、函数和场景物件组织成可读结构。",
  });

  assert.equal(concept.h, 96);
  assert.ok(concept.w >= 180 && concept.w < detail.w);
  assert.ok(detail.h > concept.h);
  assert.ok(detail.w <= 560);
});

test("lays a connected graph out from top to bottom", () => {
  const positions = layoutThinkingGraph({
    nodes: [
      { id: "root", w: 220, h: 96 },
      { id: "left", w: 220, h: 96 },
      { id: "right", w: 220, h: 96 },
      { id: "detail", w: 440, h: 160 },
    ],
    edges: [
      { from: "root", to: "left" },
      { from: "root", to: "right" },
      { from: "left", to: "detail" },
    ],
  });

  assert.ok(positions.get("root").y < positions.get("left").y);
  assert.equal(positions.get("left").y, positions.get("right").y);
  assert.notEqual(positions.get("left").x, positions.get("right").x);
  assert.ok(positions.get("left").y < positions.get("detail").y);
});

test("creates a thin, transparent, connected Excalidraw-style diagram", () => {
  const result = applyThinkingOperationsToSnapshot({
    snapshot: emptySnapshot(),
    pageId: "page:test",
    operations: [
      { type: "create_card", key: "root", title: "470 AI 助手" },
      { type: "create_card", key: "scene", title: "场景编辑" },
      { type: "create_card", key: "visual", title: "可视化" },
      {
        type: "create_card",
        key: "detail",
        title: "可视化细节",
        body: "识别关联装置、场景物件与变量字段，并保持结构清晰。",
      },
      { type: "create_relation", from: "root", to: "scene" },
      { type: "create_relation", from: "root", to: "visual" },
      { type: "create_relation", from: "visual", to: "detail" },
    ],
  });

  const root = result.snapshot.store[result.references.root];
  const scene = result.snapshot.store[result.references.scene];
  const visual = result.snapshot.store[result.references.visual];
  const detail = result.snapshot.store[result.references.detail];
  const arrows = Object.values(result.snapshot.store).filter(
    (record) => record.typeName === "shape" && record.type === "arrow",
  );

  for (const card of [root, scene, visual, detail]) {
    assert.equal(card.props.geo, "cowart-card");
    assert.equal(card.props.size, "s");
    assert.equal(card.props.fill, "none");
    assert.equal(card.props.font, "draw");
    assert.equal(card.props.color, "black");
  }
  assert.equal(root.props.align, "middle");
  assert.equal(detail.props.align, "start");
  assert.ok(root.y < scene.y);
  assert.equal(scene.y, visual.y);
  assert.ok(visual.y < detail.y);
  assert.notEqual(scene.x, visual.x);
  assert.equal(arrows.length, 3);
  for (const arrow of arrows) {
    assert.equal(arrow.props.size, "s");
    assert.equal(arrow.props.color, "black");
    assert.equal(arrow.props.font, "draw");
    assert.equal(arrow.props.richText.content[0].content, undefined);
  }
});
