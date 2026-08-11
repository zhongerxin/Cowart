import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Store } from "@tldraw/store";
import { createTLSchema, toRichText } from "@tldraw/tlschema";

import {
  applyThinkingOperations,
  applyThinkingOperationsToSnapshot,
  getThinkingContext,
  importThinkingMaterial,
  snapshotRevision,
  summarizeThinkingContext,
  undoThinkingOperation,
} from "../mcp/lib/thinking-canvas.mjs";

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

function validateSnapshot(snapshot) {
  const store = new Store({ schema: createTLSchema(), props: { defaultName: "Test" } });
  store.loadStoreSnapshot(snapshot);
  return store;
}

test("creates source-aware cards and bound relations from local references", () => {
  const initial = emptySnapshot();
  const result = applyThinkingOperationsToSnapshot({
    snapshot: initial,
    pageId: "page:test",
    operations: [
      {
        type: "create_card",
        key: "source",
        role: "material",
        generated: false,
        title: "Interview notes",
        body: "Users cannot see why a recommendation was made.",
        source: {
          fileName: "interview.md",
          localPath: "C:/project/canvas/materials/interview.md",
          excerpt: "Why did it choose this?",
        },
      },
      {
        type: "create_card",
        key: "insight",
        role: "insight",
        title: "Expose reasoning provenance",
        body: "Keep conclusions visibly connected to evidence.",
        anchorId: "source",
      },
      {
        type: "create_relation",
        key: "supports",
        from: "source",
        to: "insight",
        kind: "supports",
        label: "supports",
      },
    ],
  });

  validateSnapshot(result.snapshot);
  assert.equal(result.changes.length, 3);
  assert.match(result.references.source, /^shape:/);
  assert.match(result.references.insight, /^shape:/);
  assert.match(result.references.supports, /^shape:/);

  const relation = result.snapshot.store[result.references.supports];
  const bindings = Object.values(result.snapshot.store).filter(
    (record) => record.typeName === "binding" && record.fromId === relation.id,
  );
  assert.equal(bindings.length, 2);
  assert.deepEqual(new Set(bindings.map((binding) => binding.props.terminal)), new Set(["start", "end"]));
});

test("compact context keeps source provenance separate from synthesis", () => {
  const result = applyThinkingOperationsToSnapshot({
    snapshot: emptySnapshot(),
    operations: [
      {
        type: "create_card",
        key: "material",
        role: "material",
        generated: false,
        title: "Strategy.pdf",
        body: "Source summary",
        source: {
          kind: "pdf",
          fileName: "Strategy.pdf",
          localPath: "C:/project/canvas/materials/Strategy.pdf",
          excerpt: "Retention is the leading risk.",
          fileSize: 1234,
        },
      },
      {
        type: "create_card",
        key: "idea",
        role: "idea",
        title: "Retention intervention",
        body: "Test a guided activation path.",
        sourceRefs: ["Strategy.pdf#p12"],
      },
    ],
  });
  const materialId = result.references.material;
  const context = summarizeThinkingContext({
    snapshot: result.snapshot,
    selection: { selectedShapes: [{ id: materialId }] },
    scope: "selection",
  });

  assert.equal(context.scope, "selection");
  assert.equal(context.shapes.length, 1);
  assert.equal(context.shapes[0].role, "material");
  assert.equal(context.shapes[0].source.fileName, "Strategy.pdf");
  assert.equal(context.shapes[0].source.excerpt, "Retention is the leading risk.");
  assert.equal(context.shapes[0].text, "Source summary");

  const pageContext = summarizeThinkingContext({ snapshot: result.snapshot, scope: "page" });
  const synthesis = pageContext.shapes.find(({ id }) => id === result.references.idea);
  assert.deepEqual(synthesis.sourceRefs, ["Strategy.pdf#p12"]);
});

test("selection context includes nearby annotations but excludes unrelated page marks", () => {
  const created = applyThinkingOperationsToSnapshot({
    snapshot: emptySnapshot(),
    operations: [{ type: "create_card", key: "selected", title: "Selected idea", x: 0, y: 0 }],
  });
  const snapshot = structuredClone(created.snapshot);
  const annotation = (id, x) => ({
    id,
    typeName: "shape",
    type: "text",
    parentId: "page:test",
    index: x < 1_000 ? "a2" : "a3",
    x,
    y: 20,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    props: { color: "red", w: 80, scale: 1, richText: toRichText("review") },
    meta: {},
  });
  snapshot.store["shape:near-annotation"] = annotation("shape:near-annotation", 340);
  snapshot.store["shape:far-annotation"] = annotation("shape:far-annotation", 5_000);

  const context = summarizeThinkingContext({
    snapshot,
    selection: { selectedShapes: [{ id: created.references.selected }] },
    scope: "selection",
  });
  const contextIds = new Set(context.shapes.map(({ id }) => id));
  assert.equal(contextIds.has("shape:near-annotation"), true);
  assert.equal(contextIds.has("shape:far-annotation"), false);
});

test("refuses silent edits and deletes of user-authored content", () => {
  const created = applyThinkingOperationsToSnapshot({
    snapshot: emptySnapshot(),
    operations: [
      {
        type: "create_card",
        key: "material",
        role: "material",
        generated: false,
        title: "Original material",
      },
    ],
  });
  const materialId = created.references.material;

  assert.throws(
    () =>
      applyThinkingOperationsToSnapshot({
        snapshot: created.snapshot,
        operations: [{ type: "delete_shape", id: materialId }],
      }),
    /Refusing to delete non-agent shape/,
  );

  const manualSnapshot = structuredClone(created.snapshot);
  delete manualSnapshot.store[materialId].meta.cowartThinkingCard;
  delete manualSnapshot.store[materialId].meta.cowartThinkingGenerated;
  assert.throws(
    () =>
      applyThinkingOperationsToSnapshot({
        snapshot: manualSnapshot,
        operations: [{ type: "update_card", id: materialId, body: "Changed" }],
      }),
    /allowUserAuthoredEdits/,
  );
  assert.throws(
    () =>
      applyThinkingOperationsToSnapshot({
        snapshot: manualSnapshot,
        operations: [{ type: "move_shape", id: materialId, x: 200, y: 100 }],
      }),
    /allowUserAuthoredEdits/,
  );
  assert.throws(
    () =>
      applyThinkingOperationsToSnapshot({
        snapshot: manualSnapshot,
        operations: [{ type: "resize_shape", id: materialId, w: 500, h: 240 }],
      }),
    /allowUserAuthoredEdits/,
  );
});

test("allows explicit user-authored text edits and guarded agent deletes", () => {
  const created = applyThinkingOperationsToSnapshot({
    snapshot: emptySnapshot(),
    operations: [{ type: "create_card", key: "idea", role: "idea", title: "Draft idea" }],
  });
  const ideaId = created.references.idea;
  const manualSnapshot = structuredClone(created.snapshot);
  delete manualSnapshot.store[ideaId].meta.cowartThinkingCard;

  const updated = applyThinkingOperationsToSnapshot({
    snapshot: manualSnapshot,
    allowUserAuthoredEdits: true,
    operations: [{ type: "update_card", id: ideaId, title: "Reframed idea", body: "New body" }],
  });
  assert.equal(updated.snapshot.store[ideaId].meta.cowartThinkingTitle, "Reframed idea");

  const deleted = applyThinkingOperationsToSnapshot({
    snapshot: updated.snapshot,
    operations: [{ type: "delete_shape", id: ideaId }],
  });
  assert.equal(deleted.snapshot.store[ideaId], undefined);
  validateSnapshot(deleted.snapshot);
});

test("snapshot revisions change only when canvas records change", () => {
  const initial = emptySnapshot();
  const cloned = structuredClone(initial);
  assert.equal(snapshotRevision(initial), snapshotRevision(cloned));

  const created = applyThinkingOperationsToSnapshot({
    snapshot: initial,
    operations: [{ type: "create_card", role: "question", title: "What is missing?" }],
  });
  assert.notEqual(snapshotRevision(initial), snapshotRevision(created.snapshot));
});

test("persistent operation previews, applies, and undoes without overwriting later work", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cowart-thinking-test-"));
  try {
    const initial = await getThinkingContext({ projectDir }, { scope: "page" });
    const options = {
      baseRevision: initial.revision,
      operations: [{ type: "create_card", role: "question", title: "What should change?" }],
      reason: "Test reversible thinking operation",
      explanation: "Adds one question card.",
    };

    const preview = await applyThinkingOperations({ projectDir }, { ...options, dryRun: true });
    assert.equal(preview.applied, false);
    assert.equal((await getThinkingContext({ projectDir }, { scope: "page" })).revision, initial.revision);

    const applied = await applyThinkingOperations({ projectDir }, options);
    assert.equal(applied.applied, true);
    assert.notEqual(applied.resultRevision, initial.revision);
    assert.equal((await getThinkingContext({ projectDir }, { scope: "page" })).shapes.length, 1);

    await assert.rejects(
      applyThinkingOperations({ projectDir }, options),
      /Canvas revision changed/,
    );

    const later = await applyThinkingOperations(
      { projectDir },
      {
        baseRevision: applied.resultRevision,
        operations: [{ type: "create_card", role: "insight", title: "Later canvas work" }],
      },
    );
    await assert.rejects(
      undoThinkingOperation({ projectDir }, { operationId: applied.operationId }),
      /Refusing stale undo/,
    );
    await undoThinkingOperation({ projectDir }, { operationId: later.operationId });

    const undone = await undoThinkingOperation({ projectDir }, { operationId: applied.operationId });
    assert.equal(undone.revision, initial.revision);
    assert.equal((await getThinkingContext({ projectDir }, { scope: "page" })).shapes.length, 0);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("material import copies the source and exposes provenance in compact context", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "cowart-material-test-"));
  try {
    const sourcePath = path.join(projectDir, "interview-notes.md");
    await writeFile(sourcePath, "Users want to see evidence beside each conclusion.\n", "utf8");
    const initial = await getThinkingContext({ projectDir }, { scope: "page" });
    const imported = await importThinkingMaterial(
      { projectDir },
      {
        sourcePath,
        baseRevision: initial.revision,
        excerpt: "Users want to see evidence beside each conclusion.",
        summary: "Research note about visible provenance.",
      },
    );

    assert.equal(imported.applied, true);
    assert.equal(imported.copied, true);
    assert.equal(await readFile(imported.source.localPath, "utf8"), await readFile(sourcePath, "utf8"));

    const context = await getThinkingContext({ projectDir }, { scope: "page" });
    assert.equal(context.shapes.length, 1);
    assert.equal(context.shapes[0].role, "material");
    assert.equal(context.shapes[0].source.originalPath, sourcePath);
    assert.equal(context.shapes[0].source.localPath, imported.source.localPath);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
