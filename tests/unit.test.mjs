import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPlanApproved,
  computePlanDigest,
  computeShotDigest,
  parseArgs,
  validatePlan,
} from "../scripts/lib/project.mjs";

function selectedLine(id, start, end) {
  return {
    id,
    line_ids: [`line_${id.slice(-2)}`],
    original: "原词",
    caption: {
      source_start: start,
      source_end: end,
      start,
      end,
    },
    visual_window: {
      start,
      end,
      duration: end - start,
    },
    generation_duration_s: 5,
    candidates: [
      { label: "A", misheard: "空耳甲", visual: "画面甲", prompt: "清楚画出画面甲" },
      { label: "B", misheard: "空耳乙", visual: "画面乙", prompt: "清楚画出画面乙" },
    ],
    selected: "A",
    misheard: "空耳甲",
    visual: "画面甲",
    prompt: "清楚画出画面甲",
  };
}

function approvedPlan() {
  const plan = {
    schema_version: 1,
    project_title: "test",
    status: "approved",
    segment: {
      source_start: 0,
      source_end: 10,
      duration: 10,
      user_override: true,
    },
    lines: [
      selectedLine("shot_01", 0, 5),
      selectedLine("shot_02", 5, 10),
    ],
    approval: {
      state: "approved",
      confirmed_by: "user",
      confirmation: "user selected all lines",
      confirmed_at: "2026-01-01T00:00:00.000Z",
      digest: "",
    },
  };
  plan.approval.digest = computePlanDigest(plan);
  return plan;
}

test("approved plan passes and carries an override warning", () => {
  const plan = approvedPlan();
  const result = assertPlanApproved(plan);
  assert.equal(result.digest, plan.approval.digest);
  assert.equal(result.warnings.length, 1);
});

test("digest is stable across key ordering", () => {
  const plan = approvedPlan();
  const reordered = {
    approval: plan.approval,
    lines: plan.lines,
    segment: plan.segment,
    status: plan.status,
    project_title: plan.project_title,
    schema_version: plan.schema_version,
  };
  assert.equal(computePlanDigest(reordered), computePlanDigest(plan));
});

test("changing a prompt invalidates approval", () => {
  const plan = approvedPlan();
  plan.lines[0].prompt = "changed after approval";
  assert.throws(() => assertPlanApproved(plan), /changed after approval/i);
});

test("shot digest changes only with generation-relevant shot content", () => {
  const plan = approvedPlan();
  const before = computeShotDigest(plan.lines[0]);
  plan.lines[0].caption.start = 0.25;
  assert.equal(computeShotDigest(plan.lines[0]), before);
  plan.lines[0].visual = "changed literal scene";
  assert.notEqual(computeShotDigest(plan.lines[0]), before);
});

test("visual gaps are rejected", () => {
  const plan = approvedPlan();
  plan.lines[1].visual_window.start = 5.5;
  plan.lines[1].visual_window.duration = 4.5;
  const validation = validatePlan(plan, { requireSelections: true });
  assert.ok(validation.errors.some((message) => message.includes("does not continue")));
});

test("candidate selection must name a candidate or custom", () => {
  const plan = approvedPlan();
  plan.lines[0].selected = "Z";
  const validation = validatePlan(plan, { requireSelections: true });
  assert.ok(validation.errors.some((message) => message.includes("must match a candidate")));
});

test("parseArgs handles values and explicit booleans", () => {
  assert.deepEqual(
    parseArgs(["--project", "/tmp/x", "--json", "tail"], ["json"]),
    { _: ["tail"], project: "/tmp/x", json: true },
  );
});
