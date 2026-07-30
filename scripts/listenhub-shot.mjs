#!/usr/bin/env node

import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import {
  MAX_ATTEMPTS_PER_REVISION,
  SCHEMA_VERSION,
  assertPlanApproved,
  atomicWriteJson,
  computeShotDigest,
  ensureDir,
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

function parseJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("ListenHub returned no JSON.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const starts = [];
    for (let index = 0; index < trimmed.length; index += 1) {
      if (trimmed[index] === "{" && (index === 0 || trimmed[index - 1] === "\n")) starts.push(index);
    }
    for (const start of starts.reverse()) {
      try {
        return JSON.parse(trimmed.slice(start));
      } catch {
        // Try the previous candidate.
      }
    }
  }
  throw new Error("Could not parse ListenHub JSON output.");
}

function runListenHub(cliArgs, timeoutMs) {
  return spawnSync("listenhub", cliArgs, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs,
  });
}

function taskIdFromText(value) {
  const match = value.match(/(?:taskId|task submitted|task created)\s*[:：]\s*([a-zA-Z0-9_-]+)/i);
  return match?.[1] ?? null;
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Video download failed with HTTP ${response.status}.`);
  }
  const tempPath = `${destination}.${process.pid}.download`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
  if (!nonEmptyFile(tempPath)) throw new Error("Downloaded video is empty.");
  renameSync(tempPath, destination);
}

try {
  const args = parseArgs(process.argv.slice(2), ["json", "redo", "force"]);
  const { projectDir } = resolveProject(requireArg(args, "project"));
  const shotId = requireArg(args, "shot");
  const revision = Number(args.revision ?? 1);
  const attempt = Number(args.attempt ?? 1);
  const timeoutSeconds = Number(args.timeout ?? 1200);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("--revision must be a positive integer.");
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS_PER_REVISION) {
    throw new Error(`--attempt must be 1-${MAX_ATTEMPTS_PER_REVISION}.`);
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 30) throw new Error("--timeout must be at least 30 seconds.");

  const plan = readJson(resolve(projectDir, "plan.json"));
  const approval = assertPlanApproved(plan);
  const shot = getShot(plan, shotId);
  const prompt = getEffectivePrompt(projectDir, plan, shot, revision, attempt);
  const canonicalPath = resolve(projectDir, "shots", `${shotId}.mp4`);
  if (existsSync(canonicalPath) && !args.redo) {
    throw new Error(`${shotId} already has a selected shot. Pass --redo only after an explicit user redo request.`);
  }

  const attemptsDir = resolve(projectDir, "shots", "attempts");
  ensureDir(attemptsDir);
  const outputPath = resolve(attemptsDir, `${shotId}_r${revision}_attempt_${attempt}.mp4`);
  if (existsSync(outputPath) && !args.force) {
    throw new Error(`Attempt file already exists: ${outputPath}. Refuse a duplicate paid call.`);
  }

  const auth = runListenHub(["openapi", "config", "show"], 30_000);
  if (auth.status !== 0) {
    throw new Error("ListenHub API Key is not configured. Run `listenhub openapi config set-key` (or set LISTENHUB_API_KEY), then retry.");
  }

  const createArgs = [
    "openapi",
    "video",
    "create",
    "--prompt",
    prompt,
    "--model",
    "doubao-seedance-2-pro",
    "--resolution",
    "1080p",
    "--ratio",
    "9:16",
    "--duration",
    String(shot.generation_duration_s),
    "--no-generate-audio",
    "--timeout",
    String(timeoutSeconds),
    "--json",
  ];

  let generation = runListenHub(createArgs, (timeoutSeconds + 30) * 1000);
  let combined = `${generation.stdout ?? ""}\n${generation.stderr ?? ""}`;
  if (generation.status !== 0) {
    const existingTaskId = taskIdFromText(combined);
    if (existingTaskId) {
      const recovered = runListenHub(["openapi", "video", "get", existingTaskId, "--json"], 60_000);
      if (recovered.status === 0) generation = recovered;
      else {
        throw new Error(`Generation task ${existingTaskId} was submitted but could not be recovered. Do not resubmit automatically.`);
      }
    } else if (/api\.(listenhub\.ai|marswave\.ai|listenhub\.app)|ENOTFOUND|ECONN|fetch failed|network/i.test(combined)) {
      generation = runListenHub(createArgs, (timeoutSeconds + 30) * 1000);
    }
  }

  if (generation.status !== 0) {
    const detail = `${generation.stderr || generation.stdout || "ListenHub generation failed"}`.trim();
    throw new Error(detail);
  }

  const task = parseJsonOutput(generation.stdout);
  const videoUrl = task.videoUrl ?? task.video_url ?? task.result?.videoUrl;
  const taskId = task.id ?? task.taskId ?? task.task_id ?? null;
  if (typeof videoUrl !== "string" || !/^https?:\/\//.test(videoUrl)) {
    throw new Error(`Generation completed without a downloadable video URL${taskId ? ` (task ${taskId})` : ""}.`);
  }
  await download(videoUrl, outputPath);

  const media = probeMedia(outputPath);
  const videoStream = media.streams.find((stream) => stream.codec_type === "video");
  if (!videoStream) throw new Error("Downloaded file has no video stream.");
  if (media.duration_s === null || media.duration_s + 0.15 < shot.visual_window.duration) {
    throw new Error(
      `Generated file is ${media.duration_s ?? "unknown"}s, shorter than the ${shot.visual_window.duration}s visual window.`,
    );
  }
  const width = Number(videoStream.width);
  const height = Number(videoStream.height);
  if (!(height > width) || Math.abs(width / height - 9 / 16) > 0.04) {
    throw new Error(`Generated file is not a usable 9:16 portrait video (${width}x${height}).`);
  }

  const logPath = resolve(projectDir, "shots", "generation.json");
  const log = existsSync(logPath) ? readJson(logPath) : { schema_version: SCHEMA_VERSION, tasks: [] };
  log.tasks.push({
    shot: shotId,
    revision,
    attempt,
    task_id: taskId,
    model: "doubao-seedance-2-pro",
    resolution: "1080p",
    ratio: "9:16",
    requested_duration_s: shot.generation_duration_s,
    actual_duration_s: media.duration_s,
    file: toProjectRelative(projectDir, outputPath),
    approval_digest: approval.digest,
    shot_digest: computeShotDigest(shot),
    prompt,
    created_at: nowIso(),
  });
  atomicWriteJson(logPath, log);

  const result = {
    ok: true,
    shot: shotId,
    revision,
    attempt,
    task_id: taskId,
    file: outputPath,
    duration_s: media.duration_s,
    dimensions: `${width}x${height}`,
  };
  console.log(args.json ? JSON.stringify(result) : `Generated ${shotId} r${revision} attempt ${attempt} → ${outputPath}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
