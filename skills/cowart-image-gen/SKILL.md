---
name: cowart-image-gen
description: Generate a final AI bitmap for the Yogurt AI canvas, including any requested in-image text by default. Use when the user asks Codex to create, fill, replace, or place an AI-generated image in Yogurt AI. If an AI 图片 holder is selected, use it as the size target and replace it with the generated image by default; otherwise generate the image and insert it into the current page.
---

# Yogurt AI Image Gen

Use this skill when the user wants an AI-generated image placed onto the Yogurt AI canvas. A selected `AI 图片` holder gives a precise size and placement target, but it is not required. By default, a selected holder is a temporary target and should be replaced by the generated image.

## Preconditions

The native Yogurt AI widget should be open for the user's active project. Canvas state is read and written through the compatibility MCP tools, not through a localhost browser service.

New holders are tldraw `frame` shapes with:

```json
{
  "type": "frame",
  "meta": {
    "cowartAiImageHolder": true
  }
}
```

Older canvases may still contain legacy `geo` rectangle holders with the same
meta flag. Support both shapes.

## Workflow

1. Read the selected shape from Yogurt AI with the MCP `get_cowart_selection` tool. Pass the active user project directory as `projectDir`.

2. Check whether exactly one selected shape is an AI image holder. A holder is any selected shape with either:

   ```text
   isAiImageHolder: true
   ```

   or:

   ```text
   meta.cowartAiImageHolder: true
   ```

   If yes, use the holder replacement workflow below. If not, do not ask the user to select a holder; use the standalone workflow below and insert the generated image into the current Yogurt AI page.

3. Choose the placement workflow.

   Holder replacement workflow: use the selected holder's `props.w` and `props.h` as the size contract for both generation and placement. Before generating, derive and keep these values:

   - `targetWidth`: selected holder `props.w`
   - `targetHeight`: selected holder `props.h`
   - `targetAspectRatio`: the reduced `targetWidth:targetHeight` ratio when it maps cleanly, plus the decimal `targetWidth / targetHeight`

   If the selected holder matches a Yogurt AI ratio preset such as `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `16:9`, or `9:16`, use that preset label as the human-readable aspect ratio. The generated image should be composed for this target size and aspect ratio, and should not rely on later stretching or cropping to fit the holder.

   The generated image should replace the selected holder as a normal tldraw image shape:

   - `parentId`: same parent as the holder
   - `x`, `y`, `rotation`: same as the holder
   - `props.w`, `props.h`: same as the holder

   This leaves the final canvas with an image shape at the holder's position, not an AI holder that contains an image. Only preserve the holder when the user explicitly asks to keep the reusable slot.

   Standalone workflow: when no AI holder is selected, generate the image anyway and insert it as a normal image shape on the current page. Prefer the current page from Yogurt AI view state; if there is a selected non-holder shape and it is useful as context, place the image beside it, otherwise place it in a clear page area. If the user requested a size or aspect ratio, pass that size and ratio into generation and use it for display. Otherwise, use the generated bitmap's natural aspect ratio and a practical display width such as 512 canvas units.

4. Generate the bitmap with the built-in `imagegen` skill unless the user explicitly requests another image path. If the requested asset needs visible copy, labels, poster text, ad text, UI text, or typography, include that text directly in the image generation prompt and let the image model produce the final bitmap. Do not default to generating a text-free background and then adding text locally unless the user explicitly asks for local typography, deterministic text overlay, SVG/vector output, or another non-imagegen layout step.

   For the holder workflow, the image generation request must explicitly include the selected holder's target size and aspect ratio. Add this information to the model prompt, for example:

   ```text
   Target canvas slot: 512 x 683 canvas units.
   Target aspect ratio: 3:4 (0.75 width/height).
   Compose the final bitmap for this portrait ratio so it fits the slot without cropping or stretching.
   ```

   If the image generation tool or model accepts size or aspect-ratio parameters, pass the closest supported option in addition to the prompt text. If only prompt text is available, the prompt text must still include `targetWidth`, `targetHeight`, and `targetAspectRatio`.

   Resolve the actual local output image carefully before inserting it into Yogurt AI. Do not assume the built-in image generation flow always writes a fresh file under `$CODEX_HOME/generated_images`.

   Preferred resolution order:

   - Use the exact local image path returned by the current image generation tool call when one is available.
   - If no new file path is returned, inspect the current Codex session JSONL for the current request and extract the PNG/base64 payload from the latest `image_generation_call.result`, then write it to a timestamped output filename.
   - Use `$CODEX_HOME/generated_images` only when you can prove the file was created by the current request, for example by matching its timestamp after this generation step. Never pick an older image merely because it is the newest file in a stale generated_images directory.

   Before inserting the resolved file into Yogurt AI, visually inspect the local bitmap and confirm it is the newly generated image for this request, not a stale generated asset.

   For project-bound output, copy the resolved generated image into the selected page's asset folder:

   ```text
   canvas/pages/<page-id-without-page-prefix>/assets/
   ```

5. Insert the generated image as a new tldraw image shape.

   For the holder replacement workflow, call `insert_cowart_image` with the holder id as `anchorShapeId` and leave `replaceAiImageHolder` unset or set it to `true`. The MCP tool will place the image exactly where the holder was and remove the holder shape:

   - `type`: `image`
   - `parentId`: same as holder parent
   - `x`, `y`, `rotation`: same as holder
   - `props.w`, `props.h`: same as holder
   - `props.assetId`: the new image asset id
   - `meta.cowartGeneratedForAiImageHolder`: holder shape id
   - `meta.cowartReplacedAiImageHolder`: `true`

   If the user explicitly asks to keep the AI holder reusable, call `insert_cowart_image` with `replaceAiImageHolder: false`; for frame holders that legacy mode inserts the generated image as a child of the frame.

   For the standalone workflow, insert it into the current page as a normal image:

   - `type`: `image`
   - `parentId`: current page id, unless placing beside a selected non-holder shape requires the same parent
   - `x`, `y`: a clear page area or beside the selected non-holder shape
   - `rotation`: `0`
   - `props.w`, `props.h`: display size matching the generated bitmap aspect ratio
   - `props.assetId`: the new image asset id
   - `meta.cowartGeneratedStandalone`: `true`

6. Delete the selected holder by default as part of replacement. In the standalone workflow, do not create a holder first unless the user explicitly asks for one.

7. Save through Yogurt AI MCP. Prefer `insert_cowart_image` for inserting the generated bitmap, or use `save_cowart_canvas_state` only when you must update the whole tldraw snapshot.

   Prefer page-local asset URLs in the image asset:

   ```text
   /page-assets/<page-id-without-page-prefix>/<filename>
   ```

8. Let the Yogurt AI widget refresh from MCP-backed storage, then confirm the inserted shape id, final dimensions, target aspect ratio, saved asset path, and replaced holder id when the holder replacement workflow was used.

## Notes

- If the holder is a legacy rotated `geo` rectangle, preserve the same `rotation` on the replacement image.
- If there is already a generated image inside the holder from an older Yogurt AI version, replacing the holder should remove the holder and its child image shape, then create one normal image shape in the holder's former position.
- Do not refuse generation solely because no `AI 图片` holder is selected. Generate the bitmap and insert it into the current Yogurt AI page.
- Never overwrite an existing asset file; use a timestamped filename.
