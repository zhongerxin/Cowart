---
name: cowart-thinking-agent
description: Build and revise source-grounded, non-linear thinking spaces in Yogurt AI. Use when the user supplies documents, images, notes, or personal knowledge and wants ideas, evidence, questions, relations, comparisons, or charts to grow on an editable canvas; when the user circles, crosses out, groups, arrows, or annotates canvas content and expects the marks to be interpreted; or when a prior thinking-canvas operation must be explained or undone.
---

# Yogurt AI Thinking Agent

Treat the canvas as shared external memory. Preserve the user's materials and change only the smallest relevant region.

## Core loop

1. Open Yogurt AI with `render_cowart_canvas_widget` when no active canvas exists.
2. Read context with `get_cowart_thinking_context`. Use `scope: selection` for annotation requests and `scope: page` for broader synthesis.
3. Separate four layers before editing:
   - source material and direct excerpts;
   - knowledge or judgments supplied by the user;
   - source-grounded synthesis;
   - questions, uncertainty, and model inference.
4. Design one local operation batch. Prefer 3–8 clear cards at a time. Keep evidence beside its conclusion and label relationships with meaningful verbs.
5. Call `apply_cowart_thinking_operations` with `dryRun: true` and the current revision.
6. Check that the preview touches only intended shapes. Apply the identical operation list against the preview's `baseRevision`.
7. Report the interpreted intent, changes, evidence used, inference introduced, and returned operation ID.

Never write tldraw records or replace a raw snapshot directly.

## Add materials

- Read each supplied file with the host's appropriate file capability.
- Call `import_cowart_material` with a concise source-faithful summary and a short representative excerpt. Keep the original and canvas-local paths in provenance.
- Use `insert_cowart_image` for an image that must remain visible as an image; add a material card when its provenance or interpretation matters.
- Do not copy whole copyrighted source bodies into cards. Store summaries, short excerpts, and paths.

## Grow visual content

- Use thinking cards and relations for claims, evidence, questions, assumptions, decisions, and counterpoints.
- When the user asks to organize, map, diagram, or show a panorama, build one connected graph in a single operation batch: create the central topic, its branches, detail cards, and every required `create_relation`. Never return a few isolated boxes as the finished diagram.
- Prefer a top-down hierarchy matching Excalidraw: one short central card, 3–6 concise branch cards, and detail cards beneath the branch they explain. The canvas automatically lays out connected cards when you omit `x`, `y`, and `anchorId`; use explicit coordinates only when preserving or extending an existing composition.
- Keep structural parent-to-child arrows unlabeled. Add a relation label only when the verb carries meaning that the surrounding hierarchy does not already express.
- Use title-only cards for scannable concepts. Put paragraphs or numbered detail into a body card; Yogurt AI sizes those cards to their content.
- Use existing `insert_cowart_html_draft` for an editable comparison table, timeline, matrix, quantitative chart, or interactive explanation that cards cannot express well.
- Use existing image generation and insertion only when a bitmap materially aids understanding.
- Anchor new content beside the material or idea it explains. Do not dump every result at the page edge.

## Interpret visual annotations

Treat the submitted screenshot as authoritative visual intent and the compact context as authoritative structured content.

- Circle or enclosure: focus, group, or scope the enclosed objects.
- Arrow: add or change a relationship in the indicated direction.
- Strike-through or X: remove an agent-generated object; for user-authored content, explain the intended removal and request confirmation if meaning is uncertain.
- Handwritten or typed annotation: treat it as an instruction attached to the nearest marked object.
- Repeated color or boundary: infer a cluster only when the grouping is visually clear.

If two plausible interpretations would lead to materially different edits, ask one short question before applying. Otherwise preview and apply the smallest local change. Set `allowUserAuthoredEdits: true` only when the user explicitly selected or marked that content for modification.

## Undo

Use `undo_cowart_thinking_operation` when the user asks to undo. Do not bypass a stale-undo refusal: newer canvas work must be preserved.

## Quality rules

- Preserve source cards, images, and user-authored shapes by default.
- Do not rewrite the whole page to improve layout.
- Do not flatten disagreements into one conclusion; show conflicting evidence or conditions.
- Avoid duplicate cards. Update an existing agent card when the concept is materially the same.
- Keep labels short enough to scan at canvas zoom; put detail in the card body or a linked HTML view.
- Before applying a new diagram, verify every non-root card has a visible relation and that the overall batch reads as one composition at fit-to-selection zoom.
- Explain what changed after applying, not before, unless ambiguity requires user input.
