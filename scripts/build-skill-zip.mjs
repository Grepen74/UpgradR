#!/usr/bin/env node
/**
 * Builds the `upgradr-mcp-skill.zip` release asset.
 *
 * Run: npm run build:skill-zip   ->   dist/upgradr-mcp-skill.zip
 *
 * Two things here are deliberate, and both exist because of real incidents:
 *
 * 1. It uses `git archive`, NOT `zip -r`. `zip -r skills/upgradr-mcp` sweeps
 *    in `skills/upgradr-mcp/.state/`, which holds the live OAuth
 *    `tokens.json` (access + refresh token) of whoever last ran the skill
 *    locally -- and it does so precisely on the machines most likely to cut
 *    a release. Publishing that would hand every downloader a working
 *    credential. `git archive` can only ever emit tracked files, and
 *    `.state/` is gitignored, so the leak is structurally impossible rather
 *    than merely remembered-about.
 *
 * 2. It applies `--prefix=upgradr-mcp/` so the archive has exactly ONE
 *    top-level entry. macOS Archive Utility only invents a wrapper folder
 *    when an archive has multiple top-level entries; with a single folder it
 *    extracts it as-is. That is what makes the install a clean drag-and-drop
 *    into ~/.copilot/skills/ with no renaming -- Copilot CLI only discovers
 *    the skill under the exact directory name `upgradr-mcp`.
 *
 * Builds from origin/main by default so a release can never be cut from
 * uncommitted or half-merged local work. Override with SKILL_ZIP_REF.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ref = process.env.SKILL_ZIP_REF ?? "origin/main";
const outDir = join(repoRoot, "dist");
const outFile = join(outDir, "upgradr-mcp-skill.zip");

const git = (...args) =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();

if (!process.env.SKILL_ZIP_REF) {
  try {
    git("fetch", "--quiet", "origin", "main");
  } catch {
    console.warn("Warning: could not fetch origin/main; using the local copy.");
  }
}

mkdirSync(outDir, { recursive: true });
rmSync(outFile, { force: true });

git(
  "archive",
  "--format=zip",
  "--prefix=upgradr-mcp/",
  "-o",
  outFile,
  `${ref}:skills/upgradr-mcp`,
);

const entries = execFileSync("unzip", ["-Z1", outFile], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const leaked = entries.filter((entry) => entry.includes(".state"));
if (leaked.length > 0) {
  rmSync(outFile, { force: true });
  throw new Error(
    `Refusing to publish: archive contained state/credential files:\n  ${leaked.join("\n  ")}`,
  );
}

const expected = ["upgradr-mcp/", "upgradr-mcp/SKILL.md", "upgradr-mcp/mcp.mjs"];
const missing = expected.filter((entry) => !entries.includes(entry));
if (missing.length > 0) {
  rmSync(outFile, { force: true });
  throw new Error(`Archive is missing expected entries: ${missing.join(", ")}`);
}

const topLevel = new Set(entries.map((entry) => entry.split("/")[0]));
if (topLevel.size !== 1) {
  rmSync(outFile, { force: true });
  throw new Error(
    `Archive must have exactly one top-level entry or macOS will add a wrapper ` +
      `folder; found: ${[...topLevel].join(", ")}`,
  );
}

console.log(`Built ${outFile} from ${ref}`);
for (const entry of entries) console.log(`  ${entry}`);
console.log(
  "\nUpload with:\n" +
    "  gh release upload upgradr-mcp-skill-v1 " +
    `${outFile} --clobber`,
);
