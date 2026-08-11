---
name: cowart-open-canvas
description: Open the native Yogurt AI Codex widget, a tldraw-powered infinite canvas. Use when the user asks to open, launch, view, or work in Yogurt AI or wants an editable non-linear thinking canvas inside Codex.
---

# Yogurt AI: Open Canvas

## Workflow

1. Use the compatibility MCP tool `render_cowart_canvas_widget` to open Yogurt AI as a native Codex widget. Pass the user's active Codex workspace as `projectDir`; do not pass the plugin repository directory.

```json
{
  "projectDir": "/absolute/path/to/user/codex-project"
}
```

The tool returns `openai/outputTemplate: ui://widget/cowart/canvas.html`, which tells Codex to render the widget directly. Do not start `scripts/start-canvas.sh` or open a localhost URL for normal use.

2. Confirm the widget opens for the user. The canvas data is stored in the active project:

```text
canvas/pages/<page-id>/cowart-canvas.json
canvas/pages/<page-id>/assets/
canvas/materials/
canvas/thinking-history/
```

3. If the MCP tool is not visible in the current session, use tool discovery for Yogurt AI widget/render capabilities. If the plugin was just installed or upgraded, tell the user a new Codex conversation may be required for the new MCP tool schema to load.

## Constraints

Do not launch the old local web service, inspect canvas files, run builds, check storage layout, take screenshots, or perform other validation steps unless opening the widget fails or the user explicitly asks for those checks. The `scripts/start-canvas.sh` path is now only a local-development fallback.
