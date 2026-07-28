#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const explicitOutput = outputIndex >= 0 ? resolve(args[outputIndex + 1]) : null;
const tempRoot = explicitOutput ? null : mkdtempSync(resolve(tmpdir(), "misheard-integration-"));
const projectDir = explicitOutput ?? resolve(tempRoot, "project");

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoDir,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (options.expectFailure) {
    assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
    return result;
  }
  if (result.status !== 0) {
    throw new Error([
      `${command} ${commandArgs.join(" ")} failed`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function nodeScript(name, scriptArgs, options = {}) {
  return run(process.execPath, [resolve(repoDir, "scripts", name), ...scriptArgs], options);
}

try {
  const sourceAudio = resolve(dirname(projectDir), "test-song.wav");
  run("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=48000:duration=10",
    "-c:a", "pcm_s16le",
    sourceAudio,
  ]);

  nodeScript("init-project.mjs", [
    "--audio", sourceAudio,
    "--output", projectDir,
    "--title", "Synthetic Test",
    "--json",
  ]);
  nodeScript("group-transcript.mjs", [
    "--input", resolve(repoDir, "tests", "fixtures", "hyperframes-words.json"),
    "--output", resolve(projectDir, "transcript.json"),
    "--json",
  ]);
  nodeScript("create-plan.mjs", [
    "--project", projectDir,
    "--start", "0",
    "--end", "10",
    "--user-override",
    "--json",
  ]);

  const planPath = resolve(projectDir, "plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  plan.lines.forEach((line, index) => {
    const label = index + 1;
    line.candidates = [
      {
        label: "A",
        misheard: `空耳甲${label}`,
        visual: `一只动物认真完成动作甲${label}`,
        prompt: `竖屏近景，一只动物认真完成动作甲${label}，主体清楚，单一动作，不要文字`,
        scores: { phonetic: 4, visual: 5, contrast: 4 },
      },
      {
        label: "B",
        misheard: `空耳乙${label}`,
        visual: `一只动物认真完成动作乙${label}`,
        prompt: `竖屏近景，一只动物认真完成动作乙${label}，主体清楚，单一动作，不要文字`,
        scores: { phonetic: 4, visual: 4, contrast: 4 },
      },
    ];
    line.selected = "A";
    line.misheard = line.candidates[0].misheard;
    line.visual = line.candidates[0].visual;
    line.prompt = line.candidates[0].prompt;
  });
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  nodeScript("assert-generation-ready.mjs", [
    "--project", projectDir,
    "--shot", "shot_01",
  ], { expectFailure: true });
  nodeScript("listenhub-shot.mjs", [
    "--project", projectDir,
    "--shot", "shot_01",
    "--revision", "1",
    "--attempt", "1",
  ], { expectFailure: true });
  const blockedGenerationLog = JSON.parse(
    readFileSync(resolve(projectDir, "shots", "generation.json"), "utf8"),
  );
  assert.equal(blockedGenerationLog.tasks.length, 0);

  nodeScript("approve-plan.mjs", [
    "--project", projectDir,
    "--confirmation", "integration test user selected every line",
    "--json",
  ]);
  nodeScript("assert-generation-ready.mjs", [
    "--project", projectDir,
    "--shot", "shot_01",
    "--json",
  ]);

  const mutated = JSON.parse(readFileSync(planPath, "utf8"));
  mutated.lines[0].prompt += " changed";
  writeFileSync(planPath, `${JSON.stringify(mutated, null, 2)}\n`);
  nodeScript("assert-generation-ready.mjs", [
    "--project", projectDir,
    "--shot", "shot_01",
  ], { expectFailure: true });
  nodeScript("approve-plan.mjs", [
    "--project", projectDir,
    "--confirmation", "integration test user approved changed prompt",
    "--json",
  ]);

  const colors = ["#d9485f", "#3155a4", "#e6a928", "#2b8a6e"];
  const currentPlan = JSON.parse(readFileSync(planPath, "utf8"));
  currentPlan.lines.forEach((line, index) => {
    const createAttempt = (attempt, color) => {
      const attemptPath = resolve(projectDir, "shots", "attempts", `${line.id}_r1_attempt_${attempt}.mp4`);
      run("ffmpeg", [
        "-v", "error", "-y",
        "-f", "lavfi",
        "-i", `color=c=${color}:s=270x480:r=30:d=5`,
        "-an",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        attemptPath,
      ]);
      nodeScript("record-generation.mjs", [
        "--project", projectDir,
        "--shot", line.id,
        "--revision", "1",
        "--attempt", String(attempt),
        "--file", attemptPath,
        "--host", "synthetic-test",
        "--json",
      ]);
      return attemptPath;
    };

    if (index === 0) {
      const failedPath = createAttempt(1, "#111111");
      const failedContact = resolve(projectDir, "shots", "review", `${line.id}_r1_attempt_1.jpg`);
      run("bash", [
        resolve(repoDir, "scripts", "extract-review-frames.sh"),
        failedPath,
        failedContact,
      ]);
      nodeScript("record-review.mjs", [
        "--project", projectDir,
        "--shot", line.id,
        "--revision", "1",
        "--attempt", "1",
        "--result", "fail",
        "--score", "2",
        "--reason", "synthetic first attempt intentionally misses the subject",
        "--file", failedPath,
        "--contact-sheet", failedContact,
        "--json",
      ]);

      nodeScript("set-retry-prompt.mjs", [
        "--project", projectDir,
        "--shot", line.id,
        "--revision", "1",
        "--attempt", "2",
        "--prompt", `${line.prompt}, retry with a larger and clearer main subject`,
        "--reason", "synthetic first attempt missed the subject",
        "--json",
      ]);
      const passedPath = createAttempt(2, colors[index]);
      const passedContact = resolve(projectDir, "shots", "review", `${line.id}_r1_attempt_2.jpg`);
      run("bash", [
        resolve(repoDir, "scripts", "extract-review-frames.sh"),
        passedPath,
        passedContact,
      ]);
      nodeScript("record-review.mjs", [
        "--project", projectDir,
        "--shot", line.id,
        "--revision", "1",
        "--attempt", "2",
        "--result", "pass",
        "--score", "5",
        "--reason", "synthetic retry subject and action are clear",
        "--file", passedPath,
        "--contact-sheet", passedContact,
        "--select",
        "--json",
      ]);
    } else if (index === currentPlan.lines.length - 1) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (attempt > 1) {
          nodeScript("set-retry-prompt.mjs", [
            "--project", projectDir,
            "--shot", line.id,
            "--revision", "1",
            "--attempt", String(attempt),
            "--prompt", `${line.prompt}, retry ${attempt} with a larger literal prop and cleaner frame`,
            "--reason", `synthetic attempt ${attempt - 1} still misses the literal prop`,
            "--json",
          ]);
        }
        const attemptPath = createAttempt(attempt, colors[(index + attempt) % colors.length]);
        const reviewArgs = [
          "--project", projectDir,
          "--shot", line.id,
          "--revision", "1",
          "--attempt", String(attempt),
          "--result", "fail",
          "--score", String(attempt),
          "--reason", `synthetic attempt ${attempt} intentionally fails literal review`,
          "--file", attemptPath,
          "--json",
        ];
        if (attempt === 3) {
          reviewArgs.push("--select", "--select-attempt", "2");
        }
        nodeScript("record-review.mjs", reviewArgs);
      }
    } else {
      const attemptPath = createAttempt(1, colors[index % colors.length]);
      nodeScript("record-review.mjs", [
        "--project", projectDir,
        "--shot", line.id,
        "--revision", "1",
        "--attempt", "1",
        "--result", "pass",
        "--score", "5",
        "--reason", "synthetic subject and action are clear",
        "--file", attemptPath,
        "--select",
        "--json",
      ]);
    }
  });

  const ready = JSON.parse(nodeScript("project-status.mjs", [
    "--project", projectDir,
    "--json",
  ]).stdout);
  assert.equal(ready.stage, "ready_to_assemble");
  assert.equal(ready.missing_shots.length, 0);
  assert.deepEqual(ready.failed_best_shots, [currentPlan.lines.at(-1).id]);

  const assembly = JSON.parse(nodeScript("assemble.mjs", [
    "--project", projectDir,
    "--json",
  ]).stdout);
  assert.deepEqual(assembly.failed_best_shots, [currentPlan.lines.at(-1).id]);
  assert.ok(existsSync(resolve(projectDir, "index.html")));
  const html = readFileSync(resolve(projectDir, "index.html"), "utf8");
  assert.match(html, /data-width="1080"/);
  assert.match(html, /data-height="1920"/);
  assert.equal((html.match(/<video/g) ?? []).length, currentPlan.lines.length);
  assert.equal((html.match(/<audio/g) ?? []).length, 1);
  assert.equal((html.match(/class="clip caption-clip"/g) ?? []).length, currentPlan.lines.length);

  const assembled = JSON.parse(nodeScript("project-status.mjs", [
    "--project", projectDir,
    "--json",
  ]).stdout);
  assert.equal(assembled.stage, "assembled");

  const generationBeforeRestore = JSON.parse(
    readFileSync(resolve(projectDir, "shots", "generation.json"), "utf8"),
  ).tasks.length;
  const removedCanonical = resolve(projectDir, "shots", "shot_02.mp4");
  rmSync(removedCanonical);
  const recovering = JSON.parse(nodeScript("project-status.mjs", [
    "--project", projectDir,
    "--json",
  ]).stdout);
  assert.equal(recovering.stage, "recovering");
  assert.deepEqual(recovering.recoverable_shots, ["shot_02"]);
  nodeScript("restore-selected-shots.mjs", ["--project", projectDir, "--json"]);
  assert.ok(existsSync(removedCanonical));
  const generationAfterRestore = JSON.parse(
    readFileSync(resolve(projectDir, "shots", "generation.json"), "utf8"),
  ).tasks.length;
  assert.equal(generationAfterRestore, generationBeforeRestore);

  const stalePlan = JSON.parse(readFileSync(planPath, "utf8"));
  const originalThirdPrompt = stalePlan.lines[2].prompt;
  stalePlan.lines[2].prompt = `${originalThirdPrompt}, user-approved semantic revision`;
  writeFileSync(planPath, `${JSON.stringify(stalePlan, null, 2)}\n`);
  nodeScript("approve-plan.mjs", [
    "--project", projectDir,
    "--confirmation", "integration user approved only the third shot revision",
    "--json",
  ]);
  const staleStatus = JSON.parse(nodeScript("project-status.mjs", [
    "--project", projectDir,
    "--json",
  ]).stdout);
  assert.equal(staleStatus.stage, "stale");
  assert.deepEqual(staleStatus.stale_shots, ["shot_03"]);
  nodeScript("assemble.mjs", ["--project", projectDir, "--json"], { expectFailure: true });

  const restoredPlan = JSON.parse(readFileSync(planPath, "utf8"));
  restoredPlan.lines[2].prompt = originalThirdPrompt;
  writeFileSync(planPath, `${JSON.stringify(restoredPlan, null, 2)}\n`);
  nodeScript("approve-plan.mjs", [
    "--project", projectDir,
    "--confirmation", "integration user restored the approved third shot prompt",
    "--json",
  ]);
  const cleanStatus = JSON.parse(nodeScript("project-status.mjs", [
    "--project", projectDir,
    "--json",
  ]).stdout);
  assert.equal(cleanStatus.stage, "assembled");

  const syntheticRender = resolve(projectDir, "renders", "video.mp4");
  run("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi",
    "-i", "color=c=#202020:s=1080x1920:r=30:d=10",
    "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=48000:duration=10",
    "-shortest",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    syntheticRender,
  ]);
  run("bash", [
    resolve(repoDir, "scripts", "verify-render.sh"),
    syntheticRender,
    planPath,
  ]);

  console.log(`Integration PASS: ${projectDir}`);
} finally {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
}
