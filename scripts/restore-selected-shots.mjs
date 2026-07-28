#!/usr/bin/env node

import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertPlanApproved,
  computeShotDigest,
  getShot,
  nonEmptyFile,
  parseArgs,
  probeMedia,
  readJson,
  requireArg,
  resolveProject,
} from "./lib/project.mjs";

try {
  const args = parseArgs(process.argv.slice(2), ["json"]);
  const { projectDir } = resolveProject(requireArg(args, "project"));
  const requestedShot = args.shot ?? null;
  const plan = readJson(resolve(projectDir, "plan.json"));
  assertPlanApproved(plan);
  const reviewPath = resolve(projectDir, "shots", "review.json");
  if (!existsSync(reviewPath)) throw new Error("shots/review.json is missing.");
  const review = readJson(reviewPath);
  const targets = requestedShot ? [getShot(plan, requestedShot)] : plan.lines;
  const restored = [];
  const skipped = [];

  for (const shot of targets) {
    const canonical = resolve(projectDir, "shots", `${shot.id}.mp4`);
    if (nonEmptyFile(canonical)) {
      skipped.push(shot.id);
      continue;
    }
    const shotReview = review.shots?.[shot.id];
    if (!["passed", "failed_best_selected"].includes(shotReview?.status)) {
      throw new Error(`${shot.id} has no selected review result to restore.`);
    }
    if (shotReview.shot_digest !== computeShotDigest(shot)) {
      throw new Error(`${shot.id} changed after its selected attempt; it cannot be restored as current.`);
    }
    const revision = shotReview.revisions?.[String(shotReview.active_revision)];
    const sourceRelative = revision?.selected_source;
    if (typeof sourceRelative !== "string") throw new Error(`${shot.id} selected source is missing from review.json.`);
    const source = resolve(projectDir, sourceRelative);
    if (!nonEmptyFile(source)) throw new Error(`${shot.id} selected attempt is missing: ${sourceRelative}`);
    const media = probeMedia(source);
    if (media.duration_s === null || media.duration_s + 0.15 < shot.visual_window.duration) {
      throw new Error(`${shot.id} selected attempt no longer covers its visual window.`);
    }
    copyFileSync(source, canonical);
    restored.push(shot.id);
  }

  const response = { ok: true, restored, skipped };
  console.log(args.json ? JSON.stringify(response) : `Restored: ${restored.join(", ") || "none"}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
