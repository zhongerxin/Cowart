import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { pluginPath, pluginRoot } from "./plugin-root.mjs";

const pluginVersion = JSON.parse(
  readFileSync(pluginPath(".codex-plugin", "plugin.json"), "utf8"),
).version;

export const COWART_STATIC_BUILD_DIR = process.env.COWART_WIDGET_STATIC_DIR
  || path.join(tmpdir(), `cowart-widget-build-v${pluginVersion}`);

const BUILD_MARKER_FILE = ".cowart-widget-build.json";

let cachedStaticHtml = "";
let pendingStaticHtml = null;

export async function cowartStaticHtml() {
  if (cachedStaticHtml) return cachedStaticHtml;

  pendingStaticHtml ??= buildCowartStaticHtml().finally(() => {
    pendingStaticHtml = null;
  });
  cachedStaticHtml = await pendingStaticHtml;
  return cachedStaticHtml;
}

async function buildCowartStaticHtml() {
  await ensureViteBinary();
  await ensureStaticBuildDir();
  return inlineViteBuild(COWART_STATIC_BUILD_DIR);
}

async function ensureStaticBuildDir() {
  const sourceHash = await buildSourceHash();
  if (existsSync(path.join(COWART_STATIC_BUILD_DIR, "index.html"))) {
    const marker = await readBuildMarker();
    if (marker?.sourceHash === sourceHash) return;
  }

  await runViteBuild(COWART_STATIC_BUILD_DIR);
  await writeBuildMarker(sourceHash);
}

async function ensureViteBinary() {
  if (existsSync(viteBinaryPath())) return;

  await runNpmInstall();
  if (!existsSync(viteBinaryPath())) {
    throw new Error("Missing Vite dependency after npm install in the Yogurt AI plugin directory.");
  }
}

function viteBinaryPath() {
  return pluginPath(
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vite.cmd" : "vite",
  );
}

function runNpmInstall() {
  const { command, args } = npmInstallCommand();
  return runCommand(command, args, {
    cwd: pluginRoot(),
    failureLabel: "npm install failed while preparing the Yogurt AI widget",
  });
}

function npmInstallCommand() {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", "install"],
    };
  }
  return { command: "npm", args: ["install"] };
}

function runViteBuild(outDir) {
  return runCommand(process.execPath, [
    pluginPath("scripts", "vite-build-once.mjs"),
    pluginRoot(),
    "--outDir",
    outDir,
    "--emptyOutDir",
  ], {
    cwd: pluginRoot(),
    env: {
      COWART_WIDGET_BUILD: "1",
    },
    failureLabel: "Vite build failed while preparing the Yogurt AI widget",
  });
}

function runCommand(command, args, { cwd, env = {}, failureLabel }) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
        BROWSER: "none",
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const capture = (chunk) => {
      logs.push(String(chunk));
      if (logs.length > 120) logs.shift();
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${failureLabel} (${signal || `code ${code}`}).\n${logs.join("")}`));
    });
  });
}

async function readBuildMarker() {
  try {
    return JSON.parse(
      await readFile(path.join(COWART_STATIC_BUILD_DIR, BUILD_MARKER_FILE), "utf8"),
    );
  } catch (_error) {
    return null;
  }
}

async function writeBuildMarker(sourceHash) {
  await writeFile(
    path.join(COWART_STATIC_BUILD_DIR, BUILD_MARKER_FILE),
    `${JSON.stringify({ sourceHash }, null, 2)}\n`,
  );
}

async function buildSourceHash() {
  const hash = createHash("sha256");
  hash.update(pluginVersion);

  const sourceFiles = [
    pluginPath(".codex-plugin", "plugin.json"),
    pluginPath("index.html"),
    pluginPath("package.json"),
    pluginPath("package-lock.json"),
    pluginPath("vite.config.js"),
    ...(await listFiles(pluginPath("src"))),
    ...(await listFiles(pluginPath("public"))),
  ].sort();

  for (const file of sourceFiles) {
    hash.update(path.relative(pluginRoot(), file));
    hash.update(await readFile(file));
  }

  return hash.digest("hex");
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function inlineViteBuild(outDir) {
  let html = await readFile(path.join(outDir, "index.html"), "utf8");
  const inlineScripts = [];
  const consumedAssets = new Set();

  html = html.replace(
    /<link\s+rel="modulepreload"[^>]+href="([^"]+)"[^>]*>\s*/g,
    "",
  );

  html = await replaceAsync(
    html,
    /<link\s+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g,
    async (_match, href) => {
      const css = await readBuildAsset(outDir, href, consumedAssets);
      return `<style>\n${escapeInlineStyle(css)}\n</style>`;
    },
  );

  html = await replaceAsync(
    html,
    /<script\s+type="module"[^>]+src="([^"]+)"[^>]*><\/script>/g,
    async (_match, src) => {
      const js = await readBuildAsset(outDir, src, consumedAssets);
      inlineScripts.push(`<script>\n(() => {\n${escapeInlineScript(js)}\n})();\n</script>`);
      return "";
    },
  );

  if (/\b(?:src|href)\s*=\s*"[^"]*\/assets\//i.test(html)) {
    throw new Error("The Yogurt AI widget still references external build assets.");
  }

  const assetsDir = path.join(outDir, "assets");
  if (existsSync(assetsDir)) {
    const leftovers = (await readdir(assetsDir)).filter(
      (name) => !consumedAssets.has(`assets/${name}`),
    );
    if (leftovers.length > 0) {
      throw new Error(
        `The Yogurt AI widget build emitted non-inlined assets: ${leftovers.join(", ")}`,
      );
    }
  }

  if (inlineScripts.length > 0) {
    const scripts = inlineScripts.join("\n");
    html = html.includes("</body>")
      ? html.replace("</body>", () => `${scripts}\n</body>`)
      : `${html}\n${scripts}`;
  }

  assertCspCompatibleStaticHtml(html);
  return html;
}

function assertCspCompatibleStaticHtml(html) {
  const shellMarkup = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");

  const forbiddenShellPatterns = [
    [/<script\b[^>]+\bsrc\s*=/i, "external script tag"],
    [/<script\b[^>]*\btype\s*=\s*["']module["']/i, "module script tag"],
    [/<link\b[^>]+\bhref\s*=/i, "external link tag"],
    [/<iframe\b/i, "iframe tag"],
    [/<(?:object|embed|base)\b/i, "embedded/base tag"],
  ];
  for (const [pattern, label] of forbiddenShellPatterns) {
    if (pattern.test(shellMarkup)) {
      throw new Error(`The Yogurt AI widget is not CSP-compatible: found ${label}.`);
    }
  }

  for (const value of resourceAttributeValues(shellMarkup)) {
    if (isExternalResourceValue(value)) {
      throw new Error(
        `The Yogurt AI widget is not CSP-compatible: found external resource ${value}.`,
      );
    }
  }

  if (/\bfetch\s*\(/i.test(html) && !html.includes("__COWART_WIDGET_FETCH_GUARD__")) {
    throw new Error(
      "The Yogurt AI widget is not CSP-compatible: found fetch() without the fetch guard.",
    );
  }
}

function resourceAttributeValues(markup) {
  return Array.from(
    markup.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi),
    (match) => match[2].trim(),
  );
}

function isExternalResourceValue(value) {
  if (!value) return false;
  if (/^(?:#|data:|blob:|about:blank\b)/i.test(value)) return false;
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|\.{1,2}\/)/i.test(value);
}

async function readBuildAsset(outDir, assetPath, consumedAssets) {
  const normalized = assetPath.replace(/^\//, "");
  consumedAssets?.add(normalized);
  return readFile(path.join(outDir, normalized), "utf8");
}

async function replaceAsync(source, pattern, replacer) {
  const matches = Array.from(source.matchAll(pattern));
  let result = "";
  let lastIndex = 0;

  for (const match of matches) {
    result += source.slice(lastIndex, match.index);
    result += await replacer(...match);
    lastIndex = match.index + match[0].length;
  }

  return result + source.slice(lastIndex);
}

function escapeInlineScript(source) {
  return source.replaceAll("</script", "<\\/script").replaceAll("</SCRIPT", "<\\/SCRIPT");
}

function escapeInlineStyle(source) {
  return source.replaceAll("</style", "<\\/style").replaceAll("</STYLE", "<\\/STYLE");
}
