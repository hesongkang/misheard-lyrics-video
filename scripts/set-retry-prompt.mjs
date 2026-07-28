#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_ATTEMPTS_PER_REVISION,
  SCHEMA_VERSION,
  assertPlanApproved,
  atomicWriteJson,
  getShot,
  nowIso,
  parseArgs,
  readJson,
  requireArg,
  resolveProject,
} from "./lib/project.mjs";

try {
  const args = parseArgs(process.argv.slice(2), ["json", "force"]);
  const { projectDir } = resolveProject(requireArg(args, "project"));
  const shotId = requireArg(args, "shot");
  const revision = Number(args.revision ?? 1);
  const attempt = Number(requireArg(args, "attempt"));
  const prompt = requireArg(args, "prompt").trim();
  const reason = requireArg(args, "reason").trim();
  if (!Number.isInteger(revision) || revision < 1) throw new Error("--revision must be a positive integer.");
  if (!Number.isInteger(attempt) || attempt < 2 || attempt > MAX_ATTEMPTS_PER_REVISION) {
    throw new Error(`Retry --attempt must be 2-${MAX_ATTEMPTS_PER_REVISION}.`);
  }
  if (prompt.length < 20) throw new Error("Retry prompt is too short.");
  if (reason.length < 3) throw new Error("Retry reason is too short.");

  const plan = readJson(resolve(projectDir, "plan.json"));
  const approval = assertPlanApproved(plan);
  getShot(plan, shotId);
  const review = readJson(resolve(projectDir, "shots", "review.json"));
  const previous = review.shots?.[shotId]
    ?.revisions?.[String(revision)]
    ?.attempts?.find((entry) => entry.attempt === attempt - 1);
  if (!previous || previous.result !== "fail") {
    throw new Error(`Attempt ${attempt - 1} must be recorded as failed before setting retry ${attempt}.`);
  }

  const generationPath = resolve(projectDir, "shots", "generation.json");
  if (existsSync(generationPath)) {
    const generation = readJson(generationPath);
    const alreadyGenerated = generation.tasks?.some(
      (entry) => entry.shot === shotId && entry.revision === revision && entry.attempt === attempt,
    );
    if (alreadyGenerated) throw new Error(`Attempt ${attempt} is already generated; its prompt cannot be replaced.`);
  }

  const retryPath = resolve(projectDir, "shots", "retry-prompts.json");
  const retryPrompts = existsSync(retryPath)
    ? readJson(retryPath)
    : { schema_version: SCHEMA_VERSION, prompts: [] };
  const existingIndex = retryPrompts.prompts.findIndex(
    (entry) => entry.shot === shotId && entry.revision === revision && entry.attempt === attempt,
  );
  const entry = {
    shot: shotId,
    revision,
    attempt,
    prompt,
    reason,
    previous_attempt: attempt - 1,
    approval_digest: approval.digest,
    created_at: nowIso(),
  };
  if (existingIndex >= 0 && !args.force) {
    throw new Error(`Retry prompt already exists for ${shotId} revision ${revision} attempt ${attempt}.`);
  }
  if (existingIndex >= 0) retryPrompts.prompts[existingIndex] = entry;
  else retryPrompts.prompts.push(entry);
  atomicWriteJson(retryPath, retryPrompts);

  const response = { ok: true, shot: shotId, revision, attempt, reason };
  console.log(args.json ? JSON.stringify(response) : `Set retry prompt: ${shotId} r${revision} attempt ${attempt}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

