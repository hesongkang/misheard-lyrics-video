#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_GENERATION_DURATION,
  SCHEMA_VERSION,
  atomicWriteJson,
  parseArgs,
  readJson,
  requireArg,
  resolveProject,
  round3,
} from "./lib/project.mjs";

function fail(message) {
  throw new Error(message);
}

try {
  const args = parseArgs(process.argv.slice(2), ["json", "user-override", "force"]);
  const { projectDir, project } = resolveProject(requireArg(args, "project"));
  const transcriptPath = resolve(projectDir, "transcript.json");
  const planPath = resolve(projectDir, "plan.json");
  if (!existsSync(transcriptPath)) fail("transcript.json is missing.");
  if (existsSync(planPath) && !args.force) {
    fail("plan.json already exists. Refuse to overwrite it; pass --force only after intentionally discarding the draft.");
  }

  const start = round3(Number(requireArg(args, "start")));
  const end = round3(Number(requireArg(args, "end")));
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    fail("--start and --end must define a positive range.");
  }
  if (start < 0 || end > Number(project.source?.audio_duration_s) + 0.05) {
    fail(`Selected range must stay inside the ${project.source?.audio_duration_s}s source audio.`);
  }
  const duration = round3(end - start);
  if (!args["user-override"] && (duration < 60 || duration > 90)) {
    fail("Default excerpt must be 60-90 seconds. Use --user-override only for an explicit user range or a test.");
  }

  const transcript = readJson(transcriptPath);
  if (!Array.isArray(transcript.lines) || transcript.lines.length === 0) {
    fail("transcript.json has no grouped lines.");
  }
  const selectedLines = transcript.lines
    .filter((line) => Number(line.end) > start && Number(line.start) < end)
    .sort((left, right) => Number(left.start) - Number(right.start));
  if (selectedLines.length === 0) fail("No transcript lines overlap the selected range.");

  const captionStarts = selectedLines.map((line) => round3(Math.max(0, Number(line.start) - start)));
  for (let index = 1; index < captionStarts.length; index += 1) {
    if (captionStarts[index] <= captionStarts[index - 1] + 0.05) {
      fail(`Transcript lines ${selectedLines[index - 1].id} and ${selectedLines[index].id} overlap at the same cut. Fix grouping first.`);
    }
  }

  const planLines = selectedLines.map((line, index) => {
    const visualStart = index === 0 ? 0 : captionStarts[index];
    const visualEnd = index + 1 < selectedLines.length ? captionStarts[index + 1] : duration;
    const visualDuration = round3(visualEnd - visualStart);
    if (visualDuration > MAX_GENERATION_DURATION + 0.01) {
      fail(
        `${line.id} needs a ${visualDuration}s visual window, above the ${MAX_GENERATION_DURATION}s generation limit. `
        + "Split the transcript or choose a tighter excerpt.",
      );
    }
    if (visualDuration <= 0) fail(`${line.id} has a non-positive visual window.`);
    const captionSourceStart = round3(Math.max(start, Number(line.start)));
    const captionSourceEnd = round3(Math.min(end, Number(line.end)));
    const generationDuration = Math.min(
      MAX_GENERATION_DURATION,
      Math.max(5, Math.ceil(visualDuration)),
    );
    return {
      id: `shot_${String(index + 1).padStart(2, "0")}`,
      line_ids: [line.id],
      original: String(line.original ?? "").trim(),
      caption: {
        source_start: captionSourceStart,
        source_end: captionSourceEnd,
        start: round3(captionSourceStart - start),
        end: round3(captionSourceEnd - start),
      },
      visual_window: {
        start: visualStart,
        end: visualEnd,
        duration: visualDuration,
      },
      generation_duration_s: generationDuration,
      candidates: [],
      selected: null,
      misheard: "",
      visual: "",
      prompt: "",
    };
  });

  const plan = {
    schema_version: SCHEMA_VERSION,
    project_title: project.title,
    status: "draft",
    segment: {
      source_start: start,
      source_end: end,
      duration,
      user_override: Boolean(args["user-override"]),
    },
    lines: planLines,
    approval: null,
  };
  atomicWriteJson(planPath, plan);
  const result = { ok: true, plan: planPath, duration_s: duration, shot_count: planLines.length };
  console.log(args.json ? JSON.stringify(result) : `Created draft plan: ${planLines.length} shots, ${duration}s → ${planPath}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

