#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertPlanApproved,
  computeShotDigest,
  nonEmptyFile,
  parseArgs,
  readJson,
  requireArg,
  resolveProject,
} from "./lib/project.mjs";

try {
  const args = parseArgs(process.argv.slice(2), ["json"]);
  const { projectDir, project } = resolveProject(requireArg(args, "project"));
  const transcriptPath = resolve(projectDir, "transcript.json");
  const planPath = resolve(projectDir, "plan.json");
  const indexPath = resolve(projectDir, "index.html");
  const renderPath = resolve(projectDir, "renders", "video.mp4");
  const reviewPath = resolve(projectDir, "shots", "review.json");

  let stage = "initialized";
  let plan = null;
  let approvalError = null;
  let canGenerate = false;
  let missingShots = [];
  let recoverableShots = [];
  let staleShots = [];
  let pendingReview = [];
  let passedShots = [];
  let failedBestShots = [];

  if (existsSync(transcriptPath)) stage = "transcribed";
  if (existsSync(planPath)) {
    plan = readJson(planPath);
    stage = "plan_draft";
    try {
      assertPlanApproved(plan);
      canGenerate = true;
      stage = "approved";
    } catch (error) {
      approvalError = error instanceof Error ? error.message : String(error);
    }
  }

  if (plan && canGenerate) {
    const review = existsSync(reviewPath) ? readJson(reviewPath) : { shots: {} };
    const attemptDir = resolve(projectDir, "shots", "attempts");
    const attempts = existsSync(attemptDir) ? readdirSync(attemptDir) : [];

    for (const shot of plan.lines) {
      const canonical = resolve(projectDir, "shots", `${shot.id}.mp4`);
      const shotReview = review.shots?.[shot.id];
      const digestMatches = shotReview?.shot_digest === computeShotDigest(shot);
      if (["passed", "failed_best_selected"].includes(shotReview?.status) && !digestMatches) {
        staleShots.push(shot.id);
      } else if (nonEmptyFile(canonical) && shotReview?.status === "passed") {
        passedShots.push(shot.id);
      } else if (nonEmptyFile(canonical) && shotReview?.status === "failed_best_selected") {
        failedBestShots.push(shot.id);
      } else if (
        ["passed", "failed_best_selected"].includes(shotReview?.status)
        && typeof shotReview?.revisions?.[String(shotReview.active_revision)]?.selected_source === "string"
        && nonEmptyFile(resolve(
          projectDir,
          shotReview.revisions[String(shotReview.active_revision)].selected_source,
        ))
      ) {
        recoverableShots.push(shot.id);
      } else if (attempts.some((name) => name.startsWith(`${shot.id}_r`) && name.endsWith(".mp4"))) {
        pendingReview.push(shot.id);
      } else {
        missingShots.push(shot.id);
      }
    }

    if (staleShots.length > 0) stage = "stale";
    else if (recoverableShots.length > 0) stage = "recovering";
    else if (pendingReview.length > 0) stage = "reviewing";
    else if (missingShots.length > 0) stage = "generating";
    else stage = "ready_to_assemble";
    if (stage === "ready_to_assemble" && existsSync(indexPath)) stage = "assembled";
    if (nonEmptyFile(renderPath)) stage = "rendered";
  }

  const result = {
    ok: true,
    project: projectDir,
    title: project.title,
    stage,
    can_generate: canGenerate,
    approval_error: approvalError,
    missing_shots: missingShots,
    recoverable_shots: recoverableShots,
    stale_shots: staleShots,
    pending_review: pendingReview,
    passed_shots: passedShots,
    failed_best_shots: failedBestShots,
    index_exists: existsSync(indexPath),
    render_exists: nonEmptyFile(renderPath),
  };

  if (args.json) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`Project: ${project.title}`);
    console.log(`Stage: ${stage}`);
    console.log(`Can generate: ${canGenerate ? "yes" : "no"}`);
    if (approvalError) console.log(`Approval: ${approvalError}`);
    if (missingShots.length) console.log(`Missing: ${missingShots.join(", ")}`);
    if (recoverableShots.length) console.log(`Recoverable without generation: ${recoverableShots.join(", ")}`);
    if (staleShots.length) console.log(`Stale after plan changes: ${staleShots.join(", ")}`);
    if (pendingReview.length) console.log(`Pending review: ${pendingReview.join(", ")}`);
    if (failedBestShots.length) console.log(`Failed-best selected: ${failedBestShots.join(", ")}`);
  }
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
