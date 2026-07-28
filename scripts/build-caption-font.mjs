#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPlanApproved,
  atomicWriteJson,
  ensureDir,
  nonEmptyFile,
  nowIso,
  parseArgs,
  readJson,
  requireArg,
  resolveProject,
} from "./lib/project.mjs";

function uniqueCharacters(value) {
  return [...new Set([...value.normalize("NFC")])].join("");
}

try {
  const args = parseArgs(process.argv.slice(2), ["json", "force"]);
  const { projectDir } = resolveProject(requireArg(args, "project"));
  const plan = readJson(resolve(projectDir, "plan.json"));
  assertPlanApproved(plan);

  const text = uniqueCharacters(plan.lines.map((line) => line.misheard).join(" "));
  if (!text.trim()) throw new Error("Approved plan contains no caption text.");
  const textDigest = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  const fontDir = resolve(projectDir, "assets", "fonts");
  const fontPath = resolve(fontDir, "noto-sans-sc-900.woff2");
  const metaPath = resolve(fontDir, "font-meta.json");
  ensureDir(fontDir);

  if (!args.force && nonEmptyFile(fontPath) && existsSync(metaPath)) {
    const meta = readJson(metaPath);
    if (meta.text_digest === textDigest) {
      const result = { ok: true, reused: true, font: fontPath, glyphs: [...text].length };
      console.log(args.json ? JSON.stringify(result) : `Reused frozen caption font → ${fontPath}`);
      process.exit(0);
    }
  }

  const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@900&display=swap&text=${encodeURIComponent(text)}`;
  const cssResponse = await fetch(cssUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
  });
  if (!cssResponse.ok) throw new Error(`Google Fonts CSS request failed with HTTP ${cssResponse.status}.`);
  const css = await cssResponse.text();
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/i);
  if (!match) throw new Error("Google Fonts response did not contain a WOFF2 URL.");
  const fontUrl = match[1].replace(/^['"]|['"]$/g, "");
  const fontResponse = await fetch(fontUrl);
  if (!fontResponse.ok) throw new Error(`Font download failed with HTTP ${fontResponse.status}.`);
  const bytes = Buffer.from(await fontResponse.arrayBuffer());
  if (bytes.length < 1000) throw new Error("Downloaded font subset is unexpectedly small.");
  const tempPath = `${fontPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, fontPath);

  const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const licenseSource = resolve(skillDir, "assets", "licenses", "OFL-NotoSansSC.txt");
  if (!existsSync(licenseSource)) throw new Error(`Bundled font license is missing: ${licenseSource}`);
  copyFileSync(licenseSource, resolve(fontDir, "OFL-NotoSansSC.txt"));
  atomicWriteJson(metaPath, {
    schema_version: 1,
    family: "Noto Sans SC",
    weight: 900,
    format: "woff2",
    glyph_count: [...text].length,
    text_digest: textDigest,
    provider: "Google Fonts",
    license: "SIL Open Font License 1.1",
    frozen_at: nowIso(),
  });

  const result = { ok: true, reused: false, font: fontPath, glyphs: [...text].length };
  console.log(args.json ? JSON.stringify(result) : `Frozen ${result.glyphs} caption glyphs → ${fontPath}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

