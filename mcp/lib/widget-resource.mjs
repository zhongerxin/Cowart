import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";

const require = createRequire(import.meta.url);
let cachedMcpAppsGlobalScript = "";

export function readText(...parts) {
  return readFileSync(path.join(...parts), "utf8");
}

export function inlineWidget({
  html,
  css = "",
  js = "",
  appVersion,
  initialDisplayMode = "",
  cssPlaceholder = "/* __COWART_WIDGET_CSS__ */",
  jsPlaceholder = "/* __COWART_WIDGET_JS__ */",
}) {
  return injectMcpHostBridge(
    html.replace(cssPlaceholder, () => css).replace(jsPlaceholder, () => js),
    { appVersion, initialDisplayMode },
  );
}

export function registerWidgetResource(
  server,
  {
    name,
    uri,
    title,
    description,
    html,
    prefersBorder = false,
    connectDomains = [],
    resourceDomains = [],
    frameDomains = [],
  },
) {
  const csp = {
    connectDomains,
    resourceDomains,
  };
  if (frameDomains.length > 0) csp.frameDomains = frameDomains;

  const openAiCsp = {
    connect_domains: connectDomains,
    resource_domains: resourceDomains,
  };
  if (frameDomains.length > 0) openAiCsp.frame_domains = frameDomains;

  const metadata = {
    ui: {
      prefersBorder,
      csp,
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": prefersBorder,
    "openai/widgetCSP": openAiCsp,
  };

  registerAppResource(
    server,
    name,
    uri,
    {
      title,
      description,
      _meta: metadata,
    },
    async () => {
      const text = typeof html === "function" ? await html() : html;
      return {
        contents: [
          {
            uri,
            mimeType: RESOURCE_MIME_TYPE,
            text,
            _meta: metadata,
          },
        ],
      };
    },
  );
}

function injectMcpHostBridge(html, { appVersion, initialDisplayMode = "" } = {}) {
  const bridge = [
    '<script id="cowartInitialDisplayMode">',
    `window.__COWART_INITIAL_DISPLAY_MODE__=${JSON.stringify(initialDisplayMode)};`,
    "</script>",
    '<script id="cowartMcpAppsBundle">',
    escapeInlineScript(mcpAppsGlobalScript()),
    "</script>",
    '<script id="cowartMcpHostBridge">',
    mcpHostBridgeScript(appVersion),
    "</script>",
  ].join("\n");

  if (html.includes("</head>")) {
    return html.replace("</head>", () => `${bridge}\n</head>`);
  }
  return `${bridge}\n${html}`;
}

function mcpAppsGlobalScript() {
  if (cachedMcpAppsGlobalScript) return cachedMcpAppsGlobalScript;

  const sourcePath = require.resolve("@modelcontextprotocol/ext-apps/app-with-deps");
  const source = readFileSync(sourcePath, "utf8");
  const exportStart = source.lastIndexOf("export{");
  if (exportStart === -1) {
    throw new Error("Could not find ext-apps browser export block.");
  }

  const exportBlock = source.slice(exportStart).match(/^export\{([^}]+)\};?\s*$/s);
  if (!exportBlock) {
    throw new Error("Could not parse ext-apps browser export block.");
  }

  const exportMap = parseExportMap(exportBlock[1]);
  const requiredExports = [
    "App",
    "applyDocumentTheme",
    "applyHostFonts",
    "applyHostStyleVariables",
  ];
  for (const name of requiredExports) {
    if (!exportMap.has(name)) throw new Error(`Missing ext-apps browser export: ${name}`);
  }

  cachedMcpAppsGlobalScript = [
    source.slice(0, exportStart),
    ";globalThis.__COWART_MCP_APPS__={",
    requiredExports.map((name) => `${JSON.stringify(name)}:${exportMap.get(name)}`).join(","),
    "};",
  ].join("");
  return cachedMcpAppsGlobalScript;
}

function parseExportMap(body) {
  const exportMap = new Map();
  for (const rawEntry of body.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const parts = entry.split(/\s+as\s+/);
    const local = parts[0]?.trim();
    const exported = (parts[1] || parts[0])?.trim();
    if (local && exported) exportMap.set(exported, local);
  }
  return exportMap;
}

function escapeInlineScript(source) {
  return source.replaceAll("</script", "<\\/script").replaceAll("</SCRIPT", "<\\/SCRIPT");
}

function mcpHostBridgeScript(appVersion) {
  if (typeof appVersion !== "string" || !appVersion.trim()) {
    throw new Error("Yogurt AI widget bridge requires the plugin version.");
  }

  return `(() => {
  "use strict";

  const apps = globalThis.__COWART_MCP_APPS__;
  if (!apps || typeof apps.App !== "function") return;

  let mcpApp = null;

  function publishHostGlobals(globals) {
    window.openai = Object.assign(window.openai || {}, globals);
    window.dispatchEvent(new CustomEvent("openai:set_globals", {
      detail: { globals: window.openai },
    }));
  }

  function applyHostContext(context) {
    if (!context) return;
    try {
      if (context.theme && typeof apps.applyDocumentTheme === "function") {
        apps.applyDocumentTheme(context.theme);
      }
      if (context.styles?.variables && typeof apps.applyHostStyleVariables === "function") {
        apps.applyHostStyleVariables(context.styles.variables);
      }
      if (context.styles?.css?.fonts && typeof apps.applyHostFonts === "function") {
        apps.applyHostFonts(context.styles.css.fonts);
      }
    } catch (_error) {
      // Host styling is a progressive enhancement.
    }

    publishHostGlobals({
      hostContext: context,
      displayMode: context.displayMode,
      availableDisplayModes: context.availableDisplayModes,
      widgetInstanceId: context.widgetInstanceId || context.widgetId,
    });
  }

  function promptFromMessage(message) {
    if (typeof message === "string") return message;
    if (message?.prompt) return String(message.prompt);
    if (typeof message?.content === "string") return message.content;
    return "";
  }

  function contentFromMessage(message, prompt) {
    if (message && Array.isArray(message.content)) return message.content;
    return [{ type: "text", text: prompt }];
  }

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function toBridgeError(error) {
    if (error instanceof Error) return error;
    return new Error(String(error || "Yogurt AI host bridge is unavailable."));
  }

  function currentSize() {
    const root = document.documentElement;
    const body = document.body;
    return {
      width: Math.ceil(window.innerWidth || root.clientWidth || 0),
      height: Math.ceil(Math.max(
        root.scrollHeight || 0,
        root.offsetHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
      )),
    };
  }

  function sendCurrentSize() {
    if (!mcpApp || typeof mcpApp.sendSizeChanged !== "function") return;
    try {
      mcpApp.sendSizeChanged(currentSize());
    } catch (_error) {
      // Hosts without size notifications can keep the default widget size.
    }
  }

  async function waitForReady(app) {
    if (app?.ready) {
      await withTimeout(app.ready, 4000, "Yogurt AI host bridge did not become ready.");
    }
    if (globalThis.__COWART_MCP_HOST_ERROR__) {
      throw toBridgeError(globalThis.__COWART_MCP_HOST_ERROR__);
    }
  }

  function installCowartApi(app) {
    const api = window.cowartMcp || {};
    window.cowartMcp = api;

    api.sendFollowUpMessage = async (message) => {
      try {
        const prompt = promptFromMessage(message);
        if (!prompt) throw new Error("Missing follow-up prompt.");
        if (!app || typeof app.sendMessage !== "function") throw new Error("Host bridge is unavailable.");
        await waitForReady(app);
        const result = await withTimeout(app.sendMessage({
          role: "user",
          content: contentFromMessage(message, prompt),
        }), 8000, "Host did not accept the follow-up message.");
        if (result?.isError) throw new Error("Host rejected the follow-up message.");
        return result || {};
      } catch (error) {
        throw toBridgeError(error);
      }
    };

    api.callServerTool = async (request, options) => {
      try {
        if (!app || typeof app.callServerTool !== "function") throw new Error("Host tool bridge is unavailable.");
        await waitForReady(app);
        return await withTimeout(
          app.callServerTool(request, options),
          options?.timeoutMs || 30000,
          "Yogurt AI server tool call timed out.",
        );
      } catch (error) {
        throw toBridgeError(error);
      }
    };

    api.getHostCapabilities = () => {
      try {
        return typeof app?.getHostCapabilities === "function" ? app.getHostCapabilities() : null;
      } catch (_error) {
        return null;
      }
    };

    api.updateModelContext = async (payload, options) => {
      try {
        if (!app || typeof app.updateModelContext !== "function") return {};
        await waitForReady(app);
        return await app.updateModelContext(payload, options);
      } catch (error) {
        throw toBridgeError(error);
      }
    };

    api.requestDisplayMode = async (modeOrRequest) => {
      if (!app || typeof app.requestDisplayMode !== "function") return {};
      const request = typeof modeOrRequest === "string" ? { mode: modeOrRequest } : (modeOrRequest || { mode: "inline" });
      await waitForReady(app);
      return app.requestDisplayMode(request);
    };

    api.notifyResize = sendCurrentSize;
  }

  function payloadFromToolResult(result) {
    const metadata = result && typeof result === "object" ? result._meta || {} : {};
    const payload = metadata.widgetData || result?.structuredContent || result || {};
    return { metadata, payload };
  }

  function handleToolResult(result) {
    const { metadata, payload } = payloadFromToolResult(result);
    publishHostGlobals({
      rawToolResult: result,
      toolOutput: payload,
      toolResponseMetadata: metadata,
    });
    sendCurrentSize();
  }

  window.addEventListener("message", (event) => {
    const result = event.data?.params?.result;
    if (event.data?.method === "ui/notifications/tool-result" && result) {
      handleToolResult(result);
    }
  });

  try {
    mcpApp = new apps.App(
      { name: "cowart", version: ${JSON.stringify(appVersion)} },
      { availableDisplayModes: ["inline", "fullscreen"] },
      { autoResize: true },
    );
    globalThis.__COWART_MCP_APP__ = mcpApp;
    installCowartApi(mcpApp);

    mcpApp.addEventListener("hostcontextchanged", applyHostContext);
    mcpApp.addEventListener("toolresult", handleToolResult);

    mcpApp.ready = mcpApp.connect()
      .then(() => {
        installCowartApi(mcpApp);
        publishHostGlobals({
          hostCapabilities: mcpApp.getHostCapabilities && mcpApp.getHostCapabilities(),
          hostInfo: mcpApp.getHostVersion && mcpApp.getHostVersion(),
        });
        applyHostContext(mcpApp.getHostContext && mcpApp.getHostContext());
        const initialMode = window.__COWART_INITIAL_DISPLAY_MODE__;
        if (initialMode === "fullscreen" && typeof mcpApp.requestDisplayMode === "function") {
          mcpApp.requestDisplayMode({ mode: "fullscreen" }).catch(() => {});
        }
        sendCurrentSize();
      })
      .catch((error) => {
        globalThis.__COWART_MCP_HOST_ERROR__ = error;
      });
  } catch (error) {
    globalThis.__COWART_MCP_HOST_ERROR__ = error;
  }
})();`;
}
