import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transportEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
const serverRoot = path.resolve(optionValue("--server-root") || process.cwd());
const probeUserData = await realpath(await mkdtemp(path.join(tmpdir(), "cowart-probe-documents-")));
const maximumStartupMs = Number(optionValue("--max-startup-ms") || 0);
transportEnvironment.COWART_PLUGIN_ROOT = serverRoot;
transportEnvironment.COWART_DOCUMENTS_DIR = probeUserData;
const transport = new StdioClientTransport({
  command: "node",
  args: [process.argv.includes("--source") ? "./mcp/server.mjs" : "./scripts/start-mcp.mjs"],
  cwd: serverRoot,
  env: transportEnvironment,
});

const client = new Client({
  name: "cowart-probe",
  version: "0.1.0",
});
const toolsOnly = process.argv.includes("--tools-only");

const startupStartedAt = performance.now();
await client.connect(transport);

let downloadedProbePath = null;
let downloadedFilmPath = null;
let downloadedFilmMp4Path = null;
let downloadedProbeDirectory = null;
let projectDir = null;

const probeSnapshotSchema = {
  schemaVersion: 2,
  sequences: {
    "com.tldraw.store": 5,
    "com.tldraw.asset": 1,
    "com.tldraw.camera": 1,
    "com.tldraw.document": 2,
    "com.tldraw.instance": 26,
    "com.tldraw.instance_page_state": 5,
    "com.tldraw.page": 1,
    "com.tldraw.instance_presence": 6,
    "com.tldraw.pointer": 1,
    "com.tldraw.shape": 4,
    "com.tldraw.user": 1,
    "com.tldraw.asset.image": 6,
    "com.tldraw.asset.video": 5,
    "com.tldraw.asset.bookmark": 2,
    "com.tldraw.shape.arrow": 8,
    "com.tldraw.shape.bookmark": 2,
    "com.tldraw.shape.draw": 4,
    "com.tldraw.shape.embed": 4,
    "com.tldraw.shape.frame": 1,
    "com.tldraw.shape.geo": 11,
    "com.tldraw.shape.group": 0,
    "com.tldraw.shape.highlight": 3,
    "com.tldraw.shape.image": 5,
    "com.tldraw.shape.line": 5,
    "com.tldraw.shape.note": 12,
    "com.tldraw.shape.text": 4,
    "com.tldraw.shape.video": 4,
    "com.tldraw.binding.arrow": 1,
  },
};

function duplicateImageAsset(id, src, fileSize) {
  return {
    id,
    typeName: "asset",
    type: "image",
    props: {
      w: 1,
      h: 1,
      name: "duplicate.png",
      isAnimated: false,
      mimeType: "image/png",
      src,
      fileSize,
    },
    meta: {},
  };
}

function duplicateImageShape(id, assetId, index, x) {
  return {
    id,
    typeName: "shape",
    type: "image",
    x,
    y: 0,
    rotation: 0,
    index,
    parentId: "page:duplicate-assets",
    isLocked: false,
    opacity: 1,
    props: {
      w: 1,
      h: 1,
      playing: true,
      url: "",
      assetId,
      crop: null,
      flipX: false,
      flipY: false,
      altText: "",
    },
    meta: {},
  };
}

function isCanvasDirectory(value) {
  const canvasDir = String(value || "");
  return (
    path.basename(path.normalize(canvasDir)) === "canvas" ||
    path.win32.basename(path.win32.normalize(canvasDir)) === "canvas"
  );
}

try {
  probe: {
  const tools = await client.listTools();
  const startupMs = performance.now() - startupStartedAt;
  if (maximumStartupMs > 0 && startupMs > maximumStartupMs) {
    throw new Error(
      `Cowart MCP tool discovery took ${Math.round(startupMs)} ms; expected at most ${maximumStartupMs} ms.`,
    );
  }
  const toolNames = tools.tools.map((tool) => tool.name);
  const requiredTools = [
    "render_cowart_canvas_widget",
    "get_cowart_canvas_state",
    "save_cowart_canvas_state",
    "save_cowart_selection_state",
    "save_cowart_view_state",
    "save_cowart_reference_image",
    "read_cowart_page_asset",
    "download_cowart_file",
    "copy_cowart_image_to_clipboard",
    "get_cowart_selection",
    "insert_cowart_image",
    "insert_cowart_html_draft",
    "track_cowart_analytics_event",
  ];

  for (const toolName of requiredTools) {
    if (!toolNames.includes(toolName)) {
      throw new Error(`${toolName} not found. Tools: ${toolNames.join(", ")}`);
    }
  }

  const analyticsTool = tools.tools.find((tool) => tool.name === "track_cowart_analytics_event");
  if (JSON.stringify(analyticsTool?._meta?.ui?.visibility) !== JSON.stringify(["app"])) {
    throw new Error("Cowart analytics tool should only be visible to the widget app.");
  }
  if (analyticsTool?.annotations?.openWorldHint !== true) {
    throw new Error("Cowart analytics tool should declare its external GA4 side effect.");
  }
  if (!/PostHog/.test(analyticsTool?.description || "")) {
    throw new Error("Cowart analytics tool should document dual GA4 and PostHog delivery.");
  }
  if (!Object.hasOwn(analyticsTool?.inputSchema?.properties || {}, "eventId")) {
    throw new Error("Cowart analytics tool should accept a dedupe eventId shared with PostHog.");
  }
  const analyticsProperties = analyticsTool.inputSchema.properties
  const filmParameters = analyticsProperties.parameters.properties
  if (!filmParameters.ai_type.enum.includes('film') || !filmParameters.prompt_type.enum.includes('ai_film') ||
      !analyticsProperties.eventName.enum.includes('ai_film_inserted') ||
      !analyticsProperties.eventName.enum.includes('ai_film_export_cancelled') ||
      filmParameters.film_duration.maximum !== 120 || !filmParameters.film_style.enum.includes('data-flow')) {
    throw new Error("Cowart MCP analytics must accept film events and bounded film metadata.")
  }
  const htmlDraftTool = tools.tools.find((tool) => tool.name === "insert_cowart_html_draft");
  if (!/AI film/.test(htmlDraftTool?.description || "")) {
    throw new Error("Cowart HTML draft insertion should document AI film holder inheritance.");
  }
  const clipboardTool = tools.tools.find((tool) => tool.name === "copy_cowart_image_to_clipboard");
  if (JSON.stringify(clipboardTool?._meta?.ui?.visibility) !== JSON.stringify(["app"])) {
    throw new Error("Cowart clipboard tool should only be visible to the widget app.");
  }

  const globalLaunch = await client.callTool({ name: "render_cowart_canvas_widget", arguments: {} });
  if (globalLaunch.structuredContent?.view !== "canvas" ||
      globalLaunch.structuredContent?.canvasDir !== path.join(probeUserData, "Cowart", "canvas") ||
      !Object.values(globalLaunch.structuredContent?.canvasState?.snapshot?.store || {}).some((record) => record.typeName === "page")) {
    throw new Error("A global launch must open Documents/Cowart/canvas directly with an initial page.");
  }
  projectDir = await realpath(await mkdtemp(path.join(tmpdir(), "cowart-widget-probe-")));
  const renderResult = await client.callTool({
    name: "render_cowart_canvas_widget",
    arguments: {
      projectDir,
      title: "Probe Cowart",
    },
  });
  if (renderResult._meta?.["openai/outputTemplate"] !== "ui://widget/cowart/canvas.html") {
    throw new Error("Cowart render tool result did not include the expected outputTemplate.");
  }
  if (renderResult.structuredContent?.preferredDisplayMode !== "fullscreen") {
    throw new Error("Cowart render tool did not default to fullscreen display mode.");
  }
  if (renderResult.structuredContent?.projectDir !== projectDir) {
    throw new Error("Cowart render tool did not preserve the requested projectDir.");
  }
  if (toolsOnly) {
    console.log(
      `OK: Cowart MCP tools are available before the widget resource is built (${Math.round(startupMs)} ms).`,
    );
    break probe;
  }

  const stateResult = await client.callTool({
    name: "get_cowart_canvas_state",
    arguments: {
      projectDir,
    },
  });
  if (stateResult.structuredContent?.storage !== "empty") {
    throw new Error("A fresh Cowart project should report empty storage.");
  }
  if (!isCanvasDirectory(stateResult.structuredContent?.canvasDir)) {
    throw new Error("Cowart canvas state did not report a project-local canvas directory.");
  }
  if ((stateResult.structuredContent?.hydratedAssets || []).length !== 0) {
    throw new Error("Cowart canvas state should not hydrate image assets by default.");
  }
  const revision = stateResult.structuredContent?.revision;
  if (!/^[a-f0-9]{64}$/.test(revision || "")) throw new Error("Canvas state must include a content revision.");
  const unchangedState = await client.callTool({
    name: "get_cowart_canvas_state", arguments: { projectDir, ifRevision: revision },
  });
  if (unchangedState.structuredContent?.unchanged !== true || unchangedState.structuredContent?.snapshot !== null) {
    throw new Error("Unchanged canvas polling must not transfer a full snapshot.");
  }

  const duplicateSourceDir = path.join(projectDir, "canvas", "assets");
  const firstDuplicateBytes = Buffer.from("first duplicate asset");
  const secondDuplicateBytes = Buffer.from("second duplicate asset");
  await mkdir(path.join(duplicateSourceDir, "first"), { recursive: true });
  await mkdir(path.join(duplicateSourceDir, "second"), { recursive: true });
  await writeFile(path.join(duplicateSourceDir, "first", "duplicate.png"), firstDuplicateBytes);
  await writeFile(path.join(duplicateSourceDir, "second", "duplicate.png"), secondDuplicateBytes);

  const duplicateAssetSnapshot = {
    schema: probeSnapshotSchema,
    store: {
      "page:duplicate-assets": {
        id: "page:duplicate-assets",
        typeName: "page",
        name: "Duplicate assets",
        index: "a1",
        meta: {},
      },
      "asset:duplicate-first": duplicateImageAsset(
        "asset:duplicate-first",
        "/assets/first/duplicate.png",
        firstDuplicateBytes.length,
      ),
      "asset:duplicate-second": duplicateImageAsset(
        "asset:duplicate-second",
        "/assets/second/duplicate.png",
        secondDuplicateBytes.length,
      ),
      "shape:duplicate-first": duplicateImageShape(
        "shape:duplicate-first",
        "asset:duplicate-first",
        "a1",
        0,
      ),
      "shape:duplicate-second": duplicateImageShape(
        "shape:duplicate-second",
        "asset:duplicate-second",
        "a2",
        2,
      ),
    },
  };
  const duplicateSaveResult = await client.callTool({
    name: "save_cowart_canvas_state",
    arguments: { projectDir, snapshot: duplicateAssetSnapshot },
  });
  if (duplicateSaveResult.isError || !duplicateSaveResult.structuredContent?.ok) {
    throw new Error("Cowart could not save the duplicate-asset regression snapshot.");
  }
  const duplicateStateResult = await client.callTool({
    name: "get_cowart_canvas_state",
    arguments: { projectDir },
  });
  const duplicateStore = duplicateStateResult.structuredContent?.snapshot?.store;
  const firstAssetUrl = duplicateStore?.["asset:duplicate-first"]?.props?.src;
  const secondAssetUrl = duplicateStore?.["asset:duplicate-second"]?.props?.src;
  if (!firstAssetUrl || !secondAssetUrl || firstAssetUrl === secondAssetUrl) {
    throw new Error("Cowart page asset localization did not preserve distinct same-named assets.");
  }
  const [firstAssetResult, secondAssetResult] = await Promise.all([
    client.callTool({
      name: "read_cowart_page_asset",
      arguments: { projectDir, assetUrl: firstAssetUrl },
    }),
    client.callTool({
      name: "read_cowart_page_asset",
      arguments: { projectDir, assetUrl: secondAssetUrl },
    }),
  ]);
  if (
    !Buffer.from(firstAssetResult.structuredContent?.dataBase64 || "", "base64").equals(firstDuplicateBytes) ||
    !Buffer.from(secondAssetResult.structuredContent?.dataBase64 || "", "base64").equals(secondDuplicateBytes)
  ) {
    throw new Error("Cowart page asset localization overwrote one of the same-named assets.");
  }

  const probePageAssetDir = path.join(projectDir, "canvas", "pages", "probe-page", "assets");
  await mkdir(probePageAssetDir, { recursive: true });
  await writeFile(
    path.join(probePageAssetDir, "tiny.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
  );
  await writeFile(path.join(probePageAssetDir, "draft.html"), "<!doctype html><html><body>draft</body></html>");
  const pageAssetResult = await client.callTool({
    name: "read_cowart_page_asset",
    arguments: {
      projectDir,
      assetUrl: "/page-assets/probe-page/tiny.png",
    },
  });
  if (pageAssetResult.structuredContent?.mimeType !== "image/png" || !pageAssetResult.structuredContent?.dataBase64) {
    throw new Error("Cowart page asset tool did not return the expected png payload.");
  }
  const htmlAssetResult = await client.callTool({
    name: "read_cowart_page_asset",
    arguments: {
      projectDir,
      assetUrl: "/page-assets/probe-page/draft.html",
    },
  });
  if (htmlAssetResult.structuredContent?.mimeType !== "text/html" || !htmlAssetResult.structuredContent?.dataBase64) {
    throw new Error("Cowart page asset tool did not return the expected html payload.");
  }

  const clipboardResult = await client.callTool({
    name: "copy_cowart_image_to_clipboard",
    arguments: {
      projectDir,
      dataBase64: pageAssetResult.structuredContent.dataBase64,
      mimeType: "image/png",
      dryRun: true,
    },
  });
  if (
    clipboardResult.structuredContent?.dryRun !== true ||
    clipboardResult.structuredContent?.width !== 1 ||
    clipboardResult.structuredContent?.height !== 1
  ) {
    throw new Error("Cowart clipboard tool did not validate the expected PNG payload.");
  }

  const downloadResult = await client.callTool({
    name: "download_cowart_file",
    arguments: {
      projectDir,
      assetUrl: "/page-assets/probe-page/tiny.png",
      fileName: `cowart-download-probe-${process.pid}.png`,
    },
  });
  downloadedProbePath = downloadResult.structuredContent?.filePath;
  if (!downloadedProbePath || !(await readFile(downloadedProbePath)).length) {
    throw new Error("Cowart download tool did not write the expected file into Downloads.");
  }

  const folderDownloadResult = await client.callTool({
    name: "download_cowart_file",
    arguments: {
      projectDir,
      dataUrl: "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Ctitle%3Eprobe%3C%2Ftitle%3E",
      directoryName: `Cowart Slides Probe ${process.pid}`,
      subdirectory: "pages",
      fileName: "page-01.html",
      mimeType: "text/html",
      overwrite: true,
      uniqueDirectory: true,
    },
  });
  downloadedProbeDirectory = folderDownloadResult.structuredContent?.directoryPath;
  const folderDownloadPath = folderDownloadResult.structuredContent?.filePath;
  if (
    !downloadedProbeDirectory ||
    path.basename(path.dirname(folderDownloadPath || "")) !== "pages" ||
    !(await readFile(folderDownloadPath, "utf8")).includes("<title>probe</title>")
  ) {
    throw new Error("Cowart download tool did not create the expected Slides export folder structure.");
  }

  await probeAiFilmInsertion(globalLaunch.structuredContent?.canvasState?.snapshot);

  const resource = await client.readResource({
    uri: "ui://widget/cowart/canvas.html",
  });
  const resourceMeta = resource.contents?.[0]?._meta || {};
  const widgetCsp = resourceMeta["openai/widgetCSP"] || {};
  const connectDomains = widgetCsp.connect_domains || [];
  const requiredAnalyticsConnectDomains = [
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
    "https://analytics.google.com",
    "https://www.googletagmanager.com",
    "https://stats.g.doubleclick.net",
    "https://www.doubleclick.net",
    "https://pagead2.googlesyndication.com",
    "https://www.googleadservices.com",
    "https://www.google.com",
    "https://www.google.cn",
    "https://www.gstatic.com",
    "https://www.googleapis.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
    "https://*.doubleclick.net",
    "https://*.googlesyndication.com",
    "https://*.googleadservices.com",
    "https://*.google.com",
    "https://*.google.cn",
    "https://*.gstatic.com",
    "https://*.googleapis.com",
    "https://*.merchant-center-analytics.goog",
  ];
  for (const domain of requiredAnalyticsConnectDomains) {
    if (!connectDomains.includes(domain)) {
      throw new Error(`Cowart widget CSP should allow Google Analytics connections to ${domain}.`);
    }
  }
  const resourceDomains = widgetCsp.resource_domains || [];
  if (!resourceDomains.includes("data:") || !resourceDomains.includes("blob:")) {
    throw new Error(`Cowart widget CSP should allow local data/blob resources. Found: ${resourceDomains.join(", ")}`);
  }
  const requiredAnalyticsResourceDomains = requiredAnalyticsConnectDomains;
  for (const domain of requiredAnalyticsResourceDomains) {
    if (!resourceDomains.includes(domain)) {
      throw new Error(`Cowart widget CSP should allow Google Analytics resources from ${domain}.`);
    }
  }
  const frameDomains = widgetCsp.frame_domains || [];
  if (!frameDomains.includes("data:") || !frameDomains.includes("blob:")) {
    throw new Error(`Cowart widget CSP should allow local data/blob iframes for HTML drafts. Found: ${frameDomains.join(", ")}`);
  }

  const widgetHtml = resource.contents?.[0]?.text || "";
  if (!widgetHtml.includes("window.cowartMcp") || !widgetHtml.includes("Cowart Canvas")) {
    throw new Error("Cowart widget HTML does not include the expected bridge and app shell.");
  }
  if (/<script\b[^>]*\btype="module"/i.test(widgetHtml)) {
    throw new Error("Cowart widget HTML should use classic inline scripts for host compatibility.");
  }
  const shellMarkup = widgetHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  if (/<iframe\b/i.test(shellMarkup) || /<script\b[^>]+\bsrc=/i.test(shellMarkup) || /<link\b[^>]+\bhref=/i.test(shellMarkup)) {
    throw new Error("Cowart widget HTML should be direct static markup without iframe or external asset tags.");
  }

  console.log(
    `OK: Cowart MCP tools and native widget resource are available (${Math.round(startupMs)} ms startup).`,
  );
  }
} finally {
  if (downloadedProbePath) {
    await unlink(downloadedProbePath).catch(() => undefined);
  }
  if (downloadedFilmPath) {
    await unlink(downloadedFilmPath).catch(() => undefined);
  }
  if (downloadedFilmMp4Path) {
    await unlink(downloadedFilmMp4Path).catch(() => undefined);
  }
  if (downloadedProbeDirectory) {
    await rm(downloadedProbeDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
  if (projectDir) {
    await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
  }
  await client.close();
  await rm(probeUserData, { recursive: true, force: true });
}

async function probeAiFilmInsertion(defaultSnapshot) {
  const snapshot = structuredClone(defaultSnapshot);
  const page = Object.values(snapshot?.store || {}).find((record) => record.typeName === "page");
  if (!page) throw new Error("AI film probe needs the default project page.");
  const frameRecord = (id, parentId, x, y, w, h, meta = {}, index = "a1") => ({
    id, typeName: "shape", type: "frame", parentId, x, y, index,
    rotation: 0, isLocked: false, opacity: 1,
    props: { w, h, name: id, color: "blue" }, meta,
  });
  const parent = frameRecord("shape:film-parent", page.id, 70, 90, 1400, 1000);
  const holder = frameRecord("shape:film-holder", parent.id, 44, 66, 640, 360, {
    cowartAiDraftHolder: true,
    cowartAiFilmHolder: true,
    cowartFilmStyle: "abstract-physics",
    cowartFilmDuration: 24,
    cowartFilmMuted: false,
  });
  holder.rotation = 0.18;
  const child = frameRecord("shape:film-holder-child", holder.id, 1, 1, 30, 30);
  const htmlHolder = frameRecord("shape:html-holder", page.id, 2000, 10, 512, 683, {
    cowartAiDraftHolder: true,
  }, "a2");
  for (const record of [parent, holder, child, htmlHolder]) snapshot.store[record.id] = record;
  const saved = await callProbeTool("save_cowart_canvas_state", { projectDir, snapshot });
  if (!saved.ok || saved.skippedRecords?.length) {
    throw new Error(`AI film probe fixture must contain valid canvas records: ${JSON.stringify(saved.skippedRecords)}`);
  }
  await callProbeTool("save_cowart_selection_state", {
    projectDir,
    selection: { selectedShapes: [{ id: holder.id, type: holder.type, meta: holder.meta }] },
  });
  const selection = await callProbeTool("get_cowart_selection", { projectDir });
  const selectedHolder = selection.selection?.selectedShapes?.[0];
  if (selectedHolder?.meta?.cowartAiFilmHolder !== true || selectedHolder.meta.cowartFilmStyle !== "abstract-physics") {
    throw new Error("Cowart selection must expose AI film holder metadata to the model.");
  }

  const filmHtml = `\n<!doctype html><html><body><h1>Film original</h1><script>
window.CowartFilm={duration:24,seek(seconds){this.currentTime=seconds},play(){},pause(){},setMuted(value){this.muted=value}};
window.addEventListener('message',event=>{if(event.data.channel==='cowart-film'&&event.data.type==='command'){const action=event.data.command==='mute'?'setMuted':event.data.command;window.CowartFilm[action]?.(event.data.value)}});
parent.postMessage({channel:'cowart-film',type:'status',duration:24,currentTime:0,playing:false,muted:false},'*');
</script></body></html>\n`;
  const film = await callProbeTool("insert_cowart_html_draft", {
    projectDir, draftShapeId: holder.id, htmlContent: filmHtml, fileName: "probe-film.html",
    // Omit shapeMeta deliberately: holder metadata must identify the generated film.
  });
  const assertFilmPlacement = (record) => {
    if (record?.parentId !== parent.id || record.x !== holder.x || record.y !== holder.y ||
        record.rotation !== holder.rotation || record.props?.w !== holder.props.w || record.props?.h !== holder.props.h ||
        record.index !== holder.index) {
      throw new Error("AI film insertion/update must retain holder parent, coordinates, dimensions, rotation and index.");
    }
    if (record.meta?.cowartFilm !== true || record.meta.cowartFilmStyle !== "abstract-physics" ||
        record.meta.cowartFilmDuration !== 24 || record.meta.cowartFilmMuted !== false ||
        record.meta.cowartGeneratedForAiFilmHolder !== holder.id) {
      throw new Error("AI film insertion/update must inherit film identity, holder, style, duration and mute state.");
    }
  };
  let state = await callProbeTool("get_cowart_canvas_state", { projectDir });
  assertFilmPlacement(state.snapshot?.store?.[film.shapeId]);
  if (!film.replacedAiDraftHolder || !film.isFilm || state.snapshot.store[holder.id] || state.snapshot.store[child.id]) {
    throw new Error("AI film insertion must replace its holder and descendants using the existing HTML holder workflow.");
  }
  if (await readFile(film.assetFile, "utf8") !== filmHtml) {
    throw new Error("AI film insertion must preserve the authored HTML source exactly.");
  }

  const editedHtml = filmHtml.replace("Film original", "Film edited");
  const beforeEditRevision = state.revision;
  const edited = await callProbeTool("insert_cowart_html_draft", {
    projectDir, draftShapeId: film.shapeId, htmlContent: editedHtml,
    shapeMeta: { cowartFilm: false, cowartFilmStyle: "unknown", cowartFilmDuration: 0, cowartFilmMuted: true },
  });
  state = await callProbeTool("get_cowart_canvas_state", { projectDir, ifRevision: beforeEditRevision });
  if (state.unchanged || state.revision === beforeEditRevision) {
    throw new Error("Editing canvas content must invalidate the previous polling revision.");
  }
  const reloadedFilm = state.snapshot?.store?.[film.shapeId];
  assertFilmPlacement(reloadedFilm);
  if (!edited.updatedExistingHtmlDraft || edited.shapeId !== film.shapeId || edited.assetFile !== film.assetFile ||
      reloadedFilm.props.url !== edited.virtualUrl) {
    throw new Error("Editing an AI film must retain its existing shape/file and reference its lazy playback HTML.");
  }
  const filmAsset = await callProbeTool("read_cowart_page_asset", { projectDir, assetUrl: film.assetUrl });
  if (filmAsset.mimeType !== "text/html" || Buffer.from(filmAsset.dataBase64, "base64").toString("utf8") !== editedHtml) {
    throw new Error("AI film asset reload must return the original playback protocol and edited text.");
  }
  const exported = await callProbeTool("download_cowart_file", {
    projectDir, assetUrl: film.assetUrl, fileName: `cowart-film-probe-${process.pid}.html`,
  });
  downloadedFilmPath = exported.filePath;
  if (await readFile(downloadedFilmPath, "utf8") !== editedHtml) {
    throw new Error("AI film HTML export must preserve the complete edited playback source.");
  }
  const mp4Fixture = optionValue("--mp4-fixture");
  if (mp4Fixture) {
    const mp4 = await readFile(mp4Fixture);
    if (mp4.toString("ascii", 4, 8) !== "ftyp") throw new Error("MP4 probe fixture must be an actual MP4 file.");
    const downloaded = await callProbeTool("download_cowart_file", {
      projectDir, dataUrl: `data:video/mp4;base64,${mp4.toString("base64")}`,
      fileName: `cowart-film-probe-${process.pid}.mp4`, mimeType: "video/mp4",
    });
    downloadedFilmMp4Path = downloaded.filePath;
    if (downloaded.mimeType !== "video/mp4" || !(await readFile(downloadedFilmMp4Path)).equals(mp4)) {
      throw new Error("AI film MP4 download must preserve the complete rendered video and soundtrack.");
    }
    console.log("OK: Rendered MP4 downloads to Downloads with exact video/audio bytes and MIME type.");
  }

  const ordinaryHtml = "<!doctype html><title>Ordinary HTML</title>";
  const ordinary = await callProbeTool("insert_cowart_html_draft", {
    projectDir, draftShapeId: htmlHolder.id, htmlContent: ordinaryHtml, fileName: "probe-ordinary.html",
  });
  state = await callProbeTool("get_cowart_canvas_state", { projectDir });
  const ordinaryRecord = state.snapshot?.store?.[ordinary.shapeId];
  if (ordinary.isFilm || ordinaryRecord?.meta?.cowartFilm || ordinaryRecord?.props?.w !== 512 ||
      ordinaryRecord.props.h !== 683 || await readFile(ordinary.assetFile, "utf8") !== ordinaryHtml) {
    throw new Error("AI film support must preserve ordinary AI HTML holder behavior.");
  }
  await callProbeTool("save_cowart_selection_state", { projectDir, selection: { selectedShapes: [] } });
  const standalone = await callProbeTool("insert_cowart_html_draft", {
    projectDir, pageId: page.id, htmlContent: filmHtml, shapeMeta: { cowartFilm: true }, dryRun: true,
  });
  if (standalone.bounds?.w !== 1024 || standalone.bounds?.h !== 576 || standalone.film?.cowartFilmDuration !== 15 ||
      standalone.film.cowartFilmStyle !== "product-launch" || standalone.film.cowartFilmMuted !== false) {
    throw new Error("A standalone AI film must default to 16:9, 15 seconds, product-launch and unmuted playback.");
  }
  const invalidMeta = await callProbeTool("insert_cowart_html_draft", {
    projectDir, pageId: page.id, htmlContent: filmHtml,
    shapeMeta: { cowartFilm: true, cowartFilmStyle: "unknown", cowartFilmDuration: 500, cowartFilmMuted: "false" }, dryRun: true,
  });
  if (invalidMeta.film?.cowartFilmDuration !== 120 || invalidMeta.film?.cowartFilmStyle !== "product-launch" ||
      invalidMeta.film?.cowartFilmMuted !== false) {
    throw new Error("AI film metadata must normalize invalid styles, durations and mute flags.");
  }
  const invalidDimensions = await client.callTool({
    name: "insert_cowart_html_draft",
    arguments: { projectDir, pageId: page.id, htmlContent: filmHtml, displayWidth: -1, dryRun: true },
  });
  if (!invalidDimensions.isError) throw new Error("HTML/film display dimensions must reject negative sizes.");
  console.log("OK: AI film holder insertion, metadata, placement, text update, HTML reload/export and ordinary HTML regression.");
}

async function callProbeTool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${result.content?.find((item) => item.type === "text")?.text || "tool failed"}`);
  return result.structuredContent;
}

function optionValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex !== -1) return process.argv[exactIndex + 1] || "";
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : "";
}
