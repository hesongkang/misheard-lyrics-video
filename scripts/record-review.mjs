#!/usr/bin/env node

import { copyFileSync, existsSync } from "node:fs";
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
  readJson,
  requireArg,
  resolveProject,
  toProjectRelative,
} from "./lib/project.mjs";

try {
  const args = parseArgs(process.argv.slice(2), ["json", "select"]);
  const { projectDir } = resolveProject(requireArg(args, "project"));
  const shotId = requireArg(args, "shot");
  const revision = Number(args.revision ?? 1);
  const attempt = Number(requireArg(args, "attempt"));
  const resultName = requireArg(args, "result");
  const score = Number(requireArg(args, "score"));
  const reason = requireArg(args, "reason").trim();
  const filePath = resolve(requireArg(args, "file"));
  const contactSheetPath = typeof args["contact-sheet"] === "string"
    ? resolve(args["contact-sheet"])
    : null;

  if (!Number.isInteger(revision) || revision < 1) throw new Error("--revision must be a positive integer.");
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS_PER_REVISION) {
    throw new Error(`--attempt must be 1-${MAX_ATTEMPTS_PER_REVISION}.`);
  }
  if (!["pass", "fail"].includes(resultName)) throw new Error("--result must be pass or fail.");
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error("--score must be an integer from 1 to 5.");
  if (resultName === "pass" && score < 4) throw new Error("A passing shot must score 4 or 5.");
  if (resultName === "fail" && score > 3) throw new Error("A failed shot must score 1-3.");
  if (reason.length < 3) throw new Error("--reason is too short.");
  if (!nonEmptyFile(filePath)) throw new Error(`Attempt video is missing or empty: ${filePath}`);
  if (contactSheetPath && !nonEmptyFile(contactSheetPath)) {
    throw new Error(`Contact sheet is missing or empty: ${contactSheetPath}`);
  }

  const plan = readJson(resolve(projectDir, "plan.json"));
  assertPlanApproved(plan);
  const shot = getShot(plan, shotId);
  const effectivePrompt = getEffectivePrompt(projectDir, plan, shot, revision, attempt);
  const reviewPath = resolve(projectDir, "shots", "review.json");
  const review = existsSync(reviewPath) ? readJson(reviewPath) : { schema_version: SCHEMA_VERSION, shots: {} };
  review.shots ??= {};
  review.shots[shotId] ??= {
    active_revision: revision,
    status: "pending_review",
    selected_file: null,
    revisions: {},
  };
  const shotReview = review.shots[shotId];
  shotReview.revisions ??= {};
  const revisionKey = String(revision);
  shotReview.revisions[revisionKey] ??= {
    status: "pending_review",
    selected_attempt: null,
    attempts: [],
  };
  const revisionReview = shotReview.revisions[revisionKey];
  if (revisionReview.attempts.some((entry) => entry.attempt === attempt)) {
    throw new Error(`${shotId} revision ${revision} attempt ${attempt} is already recorded.`);
  }
  if (revisionReview.attempts.length >= MAX_ATTEMPTS_PER_REVISION) {
    throw new Error(`${shotId} revision ${revision} already has ${MAX_ATTEMPTS_PER_REVISION} attempts.`);
  }

  const generationPath = resolve(projectDir, "shots", "generation.json");
  const generation = existsSync(generationPath) ? readJson(generationPath) : { tasks: [] };
  const task = generation.tasks?.find(
    (entry) => entry.shot === shotId && entry.revision === revision && entry.attempt === attempt,
  );
  revisionReview.attempts.push({
    attempt,
    result: resultName,
    score,
    reason,
    file: toProjectRelative(projectDir, filePath),
    contact_sheet: contactSheetPath ? toProjectRelative(projectDir, contactSheetPath) : null,
    prompt: effectivePrompt,
    task_id: task?.task_id ?? null,
    reviewed_at: nowIso(),
  });
  revisionReview.attempts.sort((left, right) => left.attempt - right.attempt);

  if (args.select) {
    const selectedAttemptNumber = Number(args["select-attempt"] ?? attempt);
    if (!Number.isInteger(selectedAttemptNumber)) throw new Error("--select-attempt must be an integer.");
    const selectedEntry = revisionReview.attempts.find((entry) => entry.attempt === selectedAttemptNumber);
    if (!selectedEntry) {
      throw new Error(`Cannot select unrecorded attempt ${selectedAttemptNumber}.`);
    }
    if (selectedEntry.result === "fail" && revisionReview.attempts.length < MAX_ATTEMPTS_PER_REVISION) {
      throw new Error("Select a failed-best shot only after all three attempts are recorded.");
    }
    const canonicalPath = resolve(projectDir, "shots", `${shotId}.mp4`);
    copyFileSync(resolve(projectDir, selectedEntry.file), canonicalPath);
    const status = selectedEntry.result === "pass" ? "passed" : "failed_best_selected";
    revisionReview.status = status;
    revisionReview.selected_attempt = selectedAttemptNumber;
    revisionReview.selected_source = selectedEntry.file;
    shotReview.active_revision = revision;
    shotReview.status = status;
    shotReview.selected_file = toProjectRelative(projectDir, canonicalPath);
    shotReview.shot_digest = computeShotDigest(shot);
  } else {
    revisionReview.status = resultName === "pass" ? "passed_unselected" : "retry_required";
    shotReview.status = "pending_review";
  }

  atomicWriteJson(reviewPath, review);
  const response = {
    ok: true,
    shot: shotId,
    revision,
    attempt,
    status: shotReview.status,
    selected_file: shotReview.selected_file,
  };
  console.log(args.json ? JSON.stringify(response) : `Recorded ${shotId} r${revision} attempt ${attempt}: ${shotReview.status}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
