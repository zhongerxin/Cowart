import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginSchema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const mcpSchema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const pluginFields = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);
const stdioFields = new Set(["type", "command", "args", "env", "cwd"]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(rootDir, relativePath), "utf8"));
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    assert.ok(allowed.has(key), `${label} contains unsupported field: ${key}`);
  }
}

function assertPluginRelative(value, label) {
  assert.match(value, /^\.\//, `${label} must start with ./`);
  const resolved = path.resolve(rootDir, value);
  assert.ok(
    resolved === rootDir || resolved.startsWith(`${rootDir}${path.sep}`),
    `${label} must stay inside the plugin root`,
  );
}

const [manifest, mcpConfig, codexManifest, packageManifest] = await Promise.all([
  readJson("plugin.json"),
  readJson("mcp.json"),
  readJson(".codex-plugin/plugin.json"),
  readJson("package.json"),
]);

assert.equal(manifest.$schema, pluginSchema);
assert.match(manifest.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
assert.ok(manifest.name.length <= 64);
assertOnlyKeys(manifest, pluginFields, "plugin.json");
assert.equal(manifest.version, codexManifest.version);
assert.equal(manifest.version, packageManifest.version);

assert.equal(mcpConfig.$schema, mcpSchema);
assert.deepEqual(Object.keys(mcpConfig).sort(), ["$schema", "mcpServers"]);
for (const [name, server] of Object.entries(mcpConfig.mcpServers)) {
  assertOnlyKeys(server, stdioFields, `mcp.json server ${name}`);
  assert.equal(server.type, "stdio", `mcp.json server ${name} must use stdio`);
  assert.equal(typeof server.command, "string");
  assert.ok(server.command.length > 0);
  assert.ok(!/\s/.test(server.command), `mcp.json server ${name} command must be one token`);
  if (server.command.includes("/")) assertPluginRelative(server.command, `${name}.command`);
  if (server.cwd) assertPluginRelative(server.cwd, `${name}.cwd`);
  if (server.args) assert.ok(server.args.every((argument) => typeof argument === "string"));
  if (server.env) {
    assert.ok(!("PLUGIN_ROOT" in server.env) && !("PLUGIN_DATA" in server.env));
    assert.ok(Object.values(server.env).every((value) => typeof value === "string"));
  }
}

const resolvedRoot = await realpath(rootDir);
for (const skillName of [
  "cowart-image-edit",
  "cowart-image-gen",
  "cowart-open-canvas",
  "cowart-thinking-agent",
]) {
  const skillPath = path.join(rootDir, "skills", skillName, "SKILL.md");
  assert.ok((await lstat(skillPath)).isFile(), `${skillPath} must be a regular file`);
  assert.ok((await realpath(skillPath)).startsWith(`${resolvedRoot}${path.sep}`));
  const contents = await readFile(skillPath, "utf8");
  const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1];
  assert.ok(frontmatter, `${skillName} must contain YAML frontmatter`);
  assert.equal(frontmatter.match(/^name:\s*(.+)$/mu)?.[1], skillName);
  const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1];
  assert.ok(description && [...description].length <= 1024);
}

console.log(`Yogurt AI Agent Plugin metadata OK (${manifest.version})`);
