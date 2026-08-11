import { z } from "zod";

import {
  applyThinkingOperations,
  getThinkingContext,
  importThinkingMaterial,
  undoThinkingOperation,
} from "./thinking-canvas.mjs";

export const THINKING_TOOL_NAMES = {
  getContext: "get_cowart_thinking_context",
  importMaterial: "import_cowart_material",
  applyOperations: "apply_cowart_thinking_operations",
  undoOperation: "undo_cowart_thinking_operation",
};

const projectArgsSchema = {
  projectDir: z.string().trim().optional(),
  canvasDir: z.string().trim().optional(),
};

const placementSchema = z.enum(["right", "left", "below", "above"]);
const roleSchema = z.enum([
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

const createCardSchema = z.object({
  type: z.literal("create_card"),
  key: z.string().trim().max(80).optional(),
  role: roleSchema.optional(),
  title: z.string().max(300).optional(),
  body: z.string().max(12_000).optional(),
  color: z.string().trim().optional(),
  sourceRefs: z.array(z.string().trim()).max(50).optional(),
  url: z.string().max(2_000).optional(),
  anchorId: z.string().trim().optional(),
  placement: placementSchema.optional(),
  gap: z.number().min(0).max(2_000).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().min(120).max(2_000).optional(),
  h: z.number().min(80).max(2_000).optional(),
});

const updateCardSchema = z.object({
  type: z.literal("update_card"),
  id: z.string().trim(),
  role: roleSchema.optional(),
  title: z.string().max(300).optional(),
  body: z.string().max(12_000).optional(),
  color: z.string().trim().optional(),
});

const moveShapeSchema = z.object({
  type: z.literal("move_shape"),
  id: z.string().trim(),
  x: z.number(),
  y: z.number(),
});

const resizeShapeSchema = z.object({
  type: z.literal("resize_shape"),
  id: z.string().trim(),
  w: z.number().min(16).max(8_192),
  h: z.number().min(16).max(8_192),
});

const createRelationSchema = z.object({
  type: z.literal("create_relation"),
  key: z.string().trim().max(80).optional(),
  from: z.string().trim(),
  to: z.string().trim(),
  kind: z.string().trim().max(80).optional(),
  label: z.string().max(300).optional(),
  color: z.string().trim().optional(),
  dash: z.enum(["draw", "dashed"]).optional(),
});

const deleteShapeSchema = z.object({
  type: z.literal("delete_shape"),
  id: z.string().trim(),
});

const operationSchema = z.discriminatedUnion("type", [
  createCardSchema,
  updateCardSchema,
  moveShapeSchema,
  resizeShapeSchema,
  createRelationSchema,
  deleteShapeSchema,
]);

function toolText(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

export function registerCowartThinkingTools(server) {
  server.registerTool(
    THINKING_TOOL_NAMES.getContext,
    {
      title: "Inspect Yogurt AI Thinking Context",
      description:
        "Read a compact, source-aware representation of the current Yogurt AI page or selection. Use before planning any thinking-canvas edit; do not ask for the raw tldraw snapshot.",
      inputSchema: {
        ...projectArgsSchema,
        pageId: z.string().trim().optional(),
        scope: z.enum(["page", "selection"]).optional(),
        includeAnnotations: z.boolean().optional(),
        maxShapes: z.number().int().min(1).max(250).optional(),
        maxTextLength: z.number().int().min(200).max(4_000).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input = {}) => {
      const context = await getThinkingContext(input, input);
      return toolText(
        `Loaded ${context.shapes.length} Yogurt AI thinking object(s) from ${context.scope} at revision ${context.revision}.`,
        context,
      );
    },
  );

  server.registerTool(
    THINKING_TOOL_NAMES.importMaterial,
    {
      title: "Import Yogurt AI Material",
      description:
        "Attach a local source file to the Yogurt AI project and create an editable material card that preserves its path, excerpt, summary, and provenance.",
      inputSchema: {
        ...projectArgsSchema,
        sourcePath: z.string().trim(),
        fileName: z.string().trim().optional(),
        title: z.string().max(300).optional(),
        summary: z.string().max(12_000).optional(),
        excerpt: z.string().max(3_000).optional(),
        kind: z.string().trim().max(32).optional(),
        pageId: z.string().trim().optional(),
        baseRevision: z.string().trim().optional(),
        copySource: z.boolean().optional(),
        allowExternalSource: z.boolean().optional(),
        color: z.string().trim().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().min(120).max(2_000).optional(),
        h: z.number().min(80).max(2_000).optional(),
        reason: z.string().max(2_000).optional(),
        explanation: z.string().max(8_000).optional(),
        dryRun: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input = {}) => {
      const result = await importThinkingMaterial(input, input);
      const action = result.applied ? "Imported" : "Previewed";
      return toolText(
        `${action} material ${result.source.fileName} as ${result.references.material} at revision ${result.resultRevision}.`,
        result,
      );
    },
  );

  server.registerTool(
    THINKING_TOOL_NAMES.applyOperations,
    {
      title: "Apply Yogurt AI Thinking Operations",
      description:
        "Preview or atomically apply local, typed edits to Yogurt AI cards, positions, sizes, and relations. A connected batch of new cards and relations is automatically arranged as a top-down Excalidraw-style graph when positions are omitted. Deletion is limited to agent-generated shapes. Pass the latest canvas revision and use dryRun before applying a non-trivial batch.",
      inputSchema: {
        ...projectArgsSchema,
        baseRevision: z.string().trim().optional(),
        pageId: z.string().trim().optional(),
        operations: z.array(operationSchema).min(1).max(100),
        reason: z.string().max(2_000).optional(),
        explanation: z.string().max(8_000).optional(),
        allowUserAuthoredEdits: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input = {}) => {
      const result = await applyThinkingOperations(input, input);
      return toolText(
        `${result.applied ? "Applied" : "Previewed"} ${result.changes.length} Yogurt AI thinking edit(s); result revision ${result.resultRevision}.`,
        result,
      );
    },
  );

  server.registerTool(
    THINKING_TOOL_NAMES.undoOperation,
    {
      title: "Undo Yogurt AI Thinking Operation",
      description:
        "Undo the latest compatible thinking-agent batch, or a named operation. Refuses to overwrite canvas work made after that batch.",
      inputSchema: {
        ...projectArgsSchema,
        operationId: z.string().trim().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input = {}) => {
      const result = await undoThinkingOperation(input, input);
      return toolText(
        `Undid Yogurt AI thinking operation ${result.operationId}; canvas revision is now ${result.revision}.`,
        result,
      );
    },
  );
}
