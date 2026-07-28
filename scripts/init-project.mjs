#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  MAX_DURATION,
  MIN_DURATION,
  SCHEMA_VERSION,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  atomicWriteJson,
  ensureDir,
  nowIso,
  parseArgs,
  probeMedia,
  requireArg,
  safeTitleFromPath,
} from "./lib/project.mjs";

function usage() {
  console.error("Usage: node init-project.mjs --audio <song.mp3|m4a|wav> --output <dir> [--title <name>] [--json]");
}

try {
  const args = parseArgs(process.argv.slice(2), ["json"]);
  const audioInput = resolve(requireArg(args, "audio"));
  const outputDir = resolve(requireArg(args, "output"));
  const title = typeof args.title === "string" && args.title.trim()
    ? args.title.trim()
    : safeTitleFromPath(audioInput);

  if (!existsSync(audioInput)) throw new Error(`Audio file not found: ${audioInput}`);
  const extension = extname(audioInput).toLowerCase();
  if (![".mp3", ".m4a", ".wav"].includes(extension)) {
    throw new Error("Audio must be mp3, m4a, or wav.");
  }
  if (existsSync(resolve(outputDir, "project.json"))) {
    throw new Error(`Project already exists: ${outputDir}. Run project-status.mjs instead.`);
  }

  ensureDir(outputDir);
  for (const relativeDir of [
    "source",
    "shots/attempts",
    "shots/review",
    "assets/fonts",
    "renders",
    ".work/asr",
  ]) {
    mkdirSync(resolve(outputDir, relativeDir), { recursive: true });
  }

  const stagedName = `song${extension}`;
  const stagedPath = resolve(outputDir, "source", stagedName);
  copyFileSync(audioInput, stagedPath);
  const media = probeMedia(stagedPath);
  if (!media.duration_s || media.duration_s <= 0) {
    throw new Error("Could not determine a positive audio duration.");
  }

  let hyperframesVersion = "latest";
  try {
    hyperframesVersion = execFileSync("hyperframes", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    try {
      hyperframesVersion = execFileSync(
        "npx",
        ["--yes", "hyperframes", "--version"],
        { encoding: "utf8" },
      ).trim();
    } catch {
      // check-deps catches an unavailable CLI. Keep the project readable if init is invoked alone.
    }
  }

  const project = {
    schema_version: SCHEMA_VERSION,
    title,
    created_at: nowIso(),
    source: {
      original_name: basename(audioInput),
      audio_path: `source/${stagedName}`,
      audio_duration_s: media.duration_s,
    },
    output: {
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      fps: VIDEO_FPS,
      min_duration_s: MIN_DURATION,
      max_duration_s: MAX_DURATION,
    },
    tools: {
      hyperframes_version: hyperframesVersion,
    },
  };

  atomicWriteJson(resolve(outputDir, "project.json"), project);
  atomicWriteJson(resolve(outputDir, "shots", "review.json"), {
    schema_version: SCHEMA_VERSION,
    shots: {},
  });
  atomicWriteJson(resolve(outputDir, "shots", "generation.json"), {
    schema_version: SCHEMA_VERSION,
    tasks: [],
  });

  const pin = /^\d+\.\d+\.\d+$/.test(hyperframesVersion) ? hyperframesVersion : "latest";
  atomicWriteJson(resolve(outputDir, "package.json"), {
    name: "misheard-lyrics-output",
    private: true,
    scripts: {
      check: `npx --yes hyperframes@${pin} check .`,
      preview: `npx --yes hyperframes@${pin} preview .`,
      render: `npx --yes hyperframes@${pin} render . --quality high --output renders/video.mp4 --fps ${VIDEO_FPS}`,
      "upgrade:check": "npx --yes hyperframes@latest upgrade --project . --check --json",
    },
  });

  const result = {
    ok: true,
    project: outputDir,
    audio: `source/${stagedName}`,
    duration_s: media.duration_s,
    hyperframes_version: hyperframesVersion,
  };
  console.log(args.json ? JSON.stringify(result) : `Initialized ${outputDir}\nAudio: ${result.audio} (${media.duration_s}s)`);
} catch (error) {
  usage();
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
