#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertPlanApproved,
  getEffectivePrompt,
  getShot,
  parseArgs,
  readJson,
  requireArg,
  resolveProject,
} from "./lib/project.mjs";

try {
  const args = parseArgs(process.argv.slice(2), ["json", "redo"]);
  const { projectDir } = resolveProject(requireArg(args, "project"));
  const shotId = requireArg(args, "shot");
  const revision = Number(args.revision ?? 1);
  const attempt = Number(args.attempt ?? 1);
  const plan = readJson(resolve(projectDir, "plan.json"));
  const approval = assertPlanApproved(plan);
  const shot = getShot(plan, shotId);
  const prompt = getEffectivePrompt(projectDir, plan, shot, revision, attempt);
  const canonical = resolve(projectDir, "shots", `${shotId}.mp4`);
  if (existsSync(canonical) && !args.redo) {
    throw new Error(`${shotId} already has a selected canonical file. Refuse a paid duplicate; pass --redo only for an explicit user redo.`);
  }

  const result = {
    ok: true,
    shot: shotId,
    revision,
    attempt,
    prompt,
    misheard: shot.misheard,
    visual: shot.visual,
    generation_duration_s: shot.generation_duration_s,
    model: "doubao-seedance-2-pro",
    resolution: "1080p",
    ratio: "9:16",
    approval_digest: approval.digest,
    redo: Boolean(args.redo),
  };
  console.log(args.json ? JSON.stringify(result) : [
    `READY: ${shotId}`,
    `Model: ${result.model}, ${result.resolution}, ${result.ratio}, ${result.generation_duration_s}s`,
    `Prompt: ${result.prompt}`,
  ].join("\n"));
} catch (error) {
  console.error(`BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
