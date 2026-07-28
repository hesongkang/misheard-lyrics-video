#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_ATTEMPTS_PER_REVISION,
  SCHEMA_VERSION,
  assertPlanApproved,
  atomicWriteJson,
  computeShotDigest,
  getEffectivePrompt,
  getShot,
  nonEmptyFile,
  nowIso,
  parseArgs,
  probeMedia,
  readJson,
  requireArg,
  resolveProject,
  toProjectRelative,
} from "./lib/project.mjs";

try {
  const args = parseArgs(process.argv.slice(2), ["json"]);
  const { projectDir } = resolveProject(requireArg(args, "project"));
  const shotId = requireArg(args, "shot");
  const revision = Number(args.revision ?? 1);
  const attempt = Number(requireArg(args, "attempt"));
  const filePath = resolve(requireArg(args, "file"));
  const host = args.host ?? "cola";
  if (!Number.isInteger(revision) || revision < 1) throw new Error("--revision must be a positive integer.");
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS_PER_REVISION) {
    throw new Error(`--attempt must be 1-${MAX_ATTEMPTS_PER_REVISION}.`);
  }
  if (!nonEmptyFile(filePath)) throw new Error(`Generated file is missing or empty: ${filePath}`);

  const plan = readJson(resolve(projectDir, "plan.json"));
  const approval = assertPlanApproved(plan);
  const shot = getShot(plan, shotId);
  const prompt = getEffectivePrompt(projectDir, plan, shot, revision, attempt);
  const media = probeMedia(filePath);
  const video = media.streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("Generated file has no video stream.");
  if (media.duration_s === null || media.duration_s + 0.15 < shot.visual_window.duration) {
    throw new Error(`Generated file is shorter than ${shot.visual_window.duration}s.`);
  }
  const width = Number(video.width);
  const height = Number(video.height);
  if (!(height > width) || Math.abs(width / height - 9 / 16) > 0.04) {
    throw new Error(`Generated file is not a usable 9:16 portrait video (${width}x${height}).`);
  }

  const logPath = resolve(projectDir, "shots", "generation.json");
  const log = existsSync(logPath) ? readJson(logPath) : { schema_version: SCHEMA_VERSION, tasks: [] };
  const duplicate = log.tasks.some(
    (entry) => entry.shot === shotId && entry.revision === revision && entry.attempt === attempt,
  );
  if (duplicate) throw new Error(`${shotId} revision ${revision} attempt ${attempt} is already logged.`);
  log.tasks.push({
    shot: shotId,
    revision,
    attempt,
    task_id: args["task-id"] ?? null,
    host,
    model: "doubao-seedance-2-pro",
    resolution: "1080p",
    ratio: "9:16",
    requested_duration_s: shot.generation_duration_s,
    actual_duration_s: media.duration_s,
    file: toProjectRelative(projectDir, filePath),
    approval_digest: approval.digest,
    shot_digest: computeShotDigest(shot),
    prompt,
    created_at: nowIso(),
  });
  atomicWriteJson(logPath, log);
  const response = {
    ok: true,
    shot: shotId,
    revision,
    attempt,
    file: toProjectRelative(projectDir, filePath),
    duration_s: media.duration_s,
    dimensions: `${width}x${height}`,
  };
  console.log(args.json ? JSON.stringify(response) : `Recorded generated media: ${response.file}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
