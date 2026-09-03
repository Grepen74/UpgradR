#!/usr/bin/env node
/**
 * Generates docs/mcp-tools.md from a live `tools/list` response.
 *
 * The reference is generated rather than hand-written so it cannot drift from
 * the server: it is literally what a connected client sees, including the JSON
 * Schema each tool validates its arguments against. Regenerate with
 * `npm run mcp:tools-doc` whenever a tool is added or its schema changes.
 *
 * Requires `supabase start` and `npm run dev:mcp`.
 */
import { writeFileSync } from "node:fs";

import { MCP_SCOPE_CATALOG, MCP_SCOPES } from "../packages/contracts/src/mcpScopes.ts";
// Authoritative per-tool scope table. `scope-catalog.ts` only imports its
// contracts dependency as `import type`, which Node erases, so it loads under
// plain type stripping.
import { TOOL_SCOPES } from "../apps/mcp-worker/src/auth/scope-catalog.ts";

import { createMcpClient, headlessLogin } from "./lib/mcp-agent-auth.mjs";

const OUTPUT = "docs/mcp-tools.md";
const EMAIL = process.env.UPGRADR_DOC_EMAIL ?? "mcp-docs@example.com";

// Every scope, so tools/list returns the complete catalogue rather than the
// subset one grant happens to allow.
const { tokens, mcpUrl } = await headlessLogin({
  email: EMAIL,
  scopes: [...MCP_SCOPES],
  clientName: "UpgradR docs generator",
  createUser: true,
});

const call = createMcpClient({ mcpUrl, accessToken: tokens.access_token });
const init = await call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "upgradr-docs-generator", version: "0.1.0" },
});
const server = init.result?.serverInfo ?? {};

const listed = await call("tools/list");
const tools = listed.result?.tools ?? [];
if (tools.length === 0) {
  console.error("tools/list returned no tools; refusing to write an empty reference.");
  process.exit(1);
}

function renderSchema(schema) {
  if (!schema || typeof schema !== "object") return "_No arguments._";

  // Discriminated unions (prepare_destructive_operation) have no top-level
  // `properties` at all, so rendering only those would claim the tool takes no
  // arguments. Each variant gets its own table instead.
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants) && variants.length > 0) {
    const blocks = variants.map((variant, index) => {
      const label = discriminatorLabel(variant) ?? `Variant ${index + 1}`;
      return [`**${label}**`, "", renderProperties(variant)].join("\n");
    });
    return ["One of the following shapes:", "", blocks.join("\n\n")].join("\n");
  }

  return renderProperties(schema);
}

/** Names a union variant by its single-valued (discriminator) property. */
function discriminatorLabel(variant) {
  const properties = variant?.properties ?? {};
  for (const [name, property] of Object.entries(properties)) {
    if (property?.const !== undefined) return `${name}: \`${property.const}\``;
    if (Array.isArray(property?.enum) && property.enum.length === 1) {
      return `${name}: \`${property.enum[0]}\``;
    }
  }
  return null;
}

function renderProperties(schema) {
  const rows = [];
  collectRows(schema, "", rows, 0);
  if (rows.length === 0) return "_No arguments._";

  return [
    "| Argument | Type | Required | Description |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/**
 * Flattens nested object and array-of-object schemas into dotted argument
 * names. Agents need the shape of `proposals[].title`, not just "array of
 * object", and a flat table stays readable where nested tables would not.
 */
function collectRows(schema, prefix, rows, depth) {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);

  for (const name of Object.keys(properties)) {
    const property = properties[name] ?? {};
    const path = prefix ? `${prefix}.${name}` : name;
    const description = (property.description ?? "")
      .replace(/\s+/g, " ")
      .replace(/\|/g, "\\|");

    rows.push(
      `| \`${path}\` | ${describeType(property)} | ${required.has(name) ? "yes" : "no"} | ${description} |`,
    );

    if (depth >= 2) continue;
    if (property.type === "object" && property.properties) {
      collectRows(property, path, rows, depth + 1);
    } else if (property.type === "array" && property.items?.properties) {
      collectRows(property.items, `${path}[]`, rows, depth + 1);
    }
  }
}

/**
 * First sentence, ignoring the abbreviations that actually appear in these
 * descriptions so a summary is not cut off mid-parenthesis at "(e.g.".
 */
function firstSentence(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = /(?<!\b(?:e\.g|i\.e|etc|vs|approx))\.\s+(?=[A-Z])/.exec(normalized);
  return match ? normalized.slice(0, match.index + 1) : normalized;
}

function describeType(property) {
  if (property.const !== undefined) return `\`${property.const}\``;
  if (property.enum) {
    return property.enum.map((value) => `\`${value}\``).join(" \\| ");
  }
  if (property.type === "array") {
    const items = property.items ?? {};
    return `array of ${items.enum ? items.enum.map((v) => `\`${v}\``).join(" \\| ") : (items.type ?? "object")}`;
  }
  if (Array.isArray(property.type)) {
    return property.type.join(" \\| ");
  }
  return property.type ?? "object";
}

const scopeByTool = new Map(
  Object.entries(TOOL_SCOPES).map(([tool, scopes]) => [tool, scopes]),
);

const lines = [];
lines.push("# MCP tool reference");
lines.push("");
lines.push(
  "<!-- Generated by `npm run mcp:tools-doc`. Do not edit by hand: this file is",
);
lines.push("     produced from a live `tools/list` response so it cannot drift. -->");
lines.push("");
lines.push(
  `Server \`${server.name ?? "upgradr-mcp-worker"}\` version \`${server.version ?? "unknown"}\`, ` +
    `protocol \`${init.result?.protocolVersion ?? "unknown"}\`, ${tools.length} tools.`,
);
lines.push("");
lines.push(
  "See [mcp.md](./mcp.md) for authorization, scopes, and how to connect. Every " +
    "tool below is additionally gated by the `mcp` scope and by row-level " +
    "security, so a tool only ever sees the calling user's own data.",
);
lines.push("");

lines.push("## Scopes");
lines.push("");
lines.push("| Scope | Grants |");
lines.push("|---|---|");
for (const entry of MCP_SCOPE_CATALOG) {
  lines.push(`| \`${entry.scope}\` | ${entry.description} |`);
}
lines.push("");

lines.push("## Tools at a glance");
lines.push("");
lines.push("| Tool | Scope | Summary |");
lines.push("|---|---|---|");
for (const tool of tools) {
  const summary = firstSentence(tool.description ?? tool.title ?? "").replace(/\|/g, "\\|");
  const scopes = (scopeByTool.get(tool.name) ?? [])
    .map((scope) => `\`${scope}\``)
    .join(", ");
  // GitHub's slugger keeps underscores, so the anchor is the tool name as-is.
  lines.push(`| [\`${tool.name}\`](#${tool.name}) | ${scopes} | ${summary} |`);
}
lines.push("");

for (const tool of tools) {
  lines.push(`## ${tool.name}`);
  lines.push("");
  if (tool.title) {
    lines.push(`**${tool.title}**`);
    lines.push("");
  }
  if (tool.description) {
    lines.push(tool.description.replace(/\s+/g, " "));
    lines.push("");
  }
  const scopes = scopeByTool.get(tool.name);
  if (scopes?.length) {
    lines.push(
      `Requires ${scopes.length === 1 ? "scope" : "scopes"}: ` +
        `${scopes.map((scope) => `\`${scope}\``).join(", ")} (plus \`mcp\`).`,
    );
    lines.push("");
  }
  lines.push(renderSchema(tool.inputSchema));
  lines.push("");
}

lines.push("## Calling a tool");
lines.push("");
lines.push("```sh");
lines.push('curl -sS "$UPGRADR_MCP_URL" \\');
lines.push('  -H "authorization: Bearer $UPGRADR_ACCESS_TOKEN" \\');
lines.push('  -H "content-type: application/json" \\');
lines.push('  -H "accept: application/json, text/event-stream" \\');
lines.push(
  `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",` +
    `"params":{"name":"get_job_search_dashboard","arguments":{}}}'`,
);
lines.push("```");
lines.push("");
lines.push(
  "Get `$UPGRADR_ACCESS_TOKEN` from `npm run mcp:login -- --email you@example.com`.",
);
lines.push("");

writeFileSync(OUTPUT, `${lines.join("\n")}`);
console.log(`Wrote ${OUTPUT}: ${tools.length} tools from ${server.name ?? "the MCP Worker"}.`);
