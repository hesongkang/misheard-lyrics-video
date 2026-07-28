#!/usr/bin/env node

import { resolve } from "node:path";
import {
  assertPlanApproved,
  atomicWriteJson,
  computePlanDigest,
  nowIso,
  parseArgs,
  readJson,
  requireArg,
  resolveProject,
  validatePlan,
} from "./lib/project.mjs";

try {
  const args = parseArgs(process.argv.slice(2), ["json"]);
  const { projectDir } = resolveProject(requireArg(args, "project"));
  const confirmation = requireArg(args, "confirmation").trim();
  if (confirmation.length < 8) {
    throw new Error("--confirmation must briefly identify the user's explicit selection.");
  }

  const planPath = resolve(projectDir, "plan.json");
  const plan = readJson(planPath);
  const updated = {
    ...plan,
    status: "approved",
    approval: {
      state: "approved",
      confirmed_by: "user",
      confirmation,
      confirmed_at: nowIso(),
      digest: "",
    },
  };
  const validation = validatePlan(updated, { requireSelections: true });
  if (validation.errors.length > 0) {
    throw new Error(`Cannot approve plan:\n- ${validation.errors.join("\n- ")}`);
  }
  updated.approval.digest = computePlanDigest(updated);
  assertPlanApproved(updated);
  atomicWriteJson(planPath, updated);

  const result = {
    ok: true,
    plan: planPath,
    digest: updated.approval.digest,
    warnings: validation.warnings,
  };
  if (args.json) console.log(JSON.stringify(result));
  else {
    console.log(`Approved and locked ${planPath}`);
    console.log(`Digest: ${updated.approval.digest}`);
    for (const warning of validation.warnings) console.log(`WARN: ${warning}`);
  }
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

