import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const SCHEMA_VERSION = 1;
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;
export const MIN_DURATION = 60;
export const MAX_DURATION = 90;
export const MAX_GENERATION_DURATION = 15;
export const MAX_ATTEMPTS_PER_REVISION = 3;

export function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseArgs(argv, booleanNames = []) {
  const booleans = new Set(booleanNames);
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (booleans.has(name)) {
      out[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    out[name] = value;
    index += 1;
  }
  return out;
}

export function requireArg(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

export function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read JSON ${filePath}: ${detail}`);
  }
}

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function atomicWriteJson(filePath, value) {
  ensureDir(dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function computePlanDigest(plan) {
  const payload = { ...plan };
  delete payload.approval;
  const canonical = JSON.stringify(canonicalize(payload));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function computeShotDigest(shot) {
  const payload = {
    id: shot.id,
    misheard: shot.misheard,
    visual: shot.visual,
    prompt: shot.prompt,
    generation_duration_s: shot.generation_duration_s,
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex")}`;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function near(left, right, tolerance = 0.02) {
  return Math.abs(left - right) <= tolerance;
}

export function validatePlan(plan, { requireSelections = false } = {}) {
  const errors = [];
  const warnings = [];

  if (!plan || typeof plan !== "object") {
    return { errors: ["plan must be an object"], warnings };
  }
  if (plan.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }
  if (!plan.segment || typeof plan.segment !== "object") {
    errors.push("segment is required");
  } else {
    const { source_start: start, source_end: end, duration } = plan.segment;
    if (![start, end, duration].every(isFiniteNumber)) {
      errors.push("segment source_start/source_end/duration must be finite numbers");
    } else {
      if (!(end > start)) errors.push("segment.source_end must be greater than source_start");
      if (!near(duration, end - start)) {
        errors.push("segment.duration must equal source_end - source_start");
      }
      if (!plan.segment.user_override && (duration < MIN_DURATION || duration > MAX_DURATION)) {
        errors.push(`default segment duration must be ${MIN_DURATION}-${MAX_DURATION} seconds`);
      } else if (plan.segment.user_override && (duration < MIN_DURATION || duration > MAX_DURATION)) {
        warnings.push(`user-overridden duration is ${duration}s, outside ${MIN_DURATION}-${MAX_DURATION}s`);
      }
    }
  }

  if (!Array.isArray(plan.lines) || plan.lines.length === 0) {
    errors.push("lines must be a non-empty array");
    return { errors, warnings };
  }

  const ids = new Set();
  const segmentDuration = plan.segment?.duration;
  let previousVisualEnd = 0;

  plan.lines.forEach((line, index) => {
    const label = `lines[${index}]`;
    if (!line || typeof line !== "object") {
      errors.push(`${label} must be an object`);
      return;
    }
    if (typeof line.id !== "string" || !/^shot_\d{2,}$/.test(line.id)) {
      errors.push(`${label}.id must match shot_NN`);
    } else if (ids.has(line.id)) {
      errors.push(`${label}.id is duplicated`);
    } else {
      ids.add(line.id);
    }
    if (typeof line.original !== "string" || line.original.trim() === "") {
      errors.push(`${label}.original is required`);
    }

    const caption = line.caption;
    if (!caption || !["source_start", "source_end", "start", "end"].every((key) => isFiniteNumber(caption[key]))) {
      errors.push(`${label}.caption requires finite source_start/source_end/start/end`);
    } else {
      if (!(caption.source_end > caption.source_start)) {
        errors.push(`${label}.caption source_end must be greater than source_start`);
      }
      if (!(caption.end > caption.start)) {
        errors.push(`${label}.caption end must be greater than start`);
      }
      if (plan.segment && !near(caption.start, caption.source_start - plan.segment.source_start, 0.05)) {
        errors.push(`${label}.caption.start is not normalized from source_start`);
      }
      if (plan.segment && !near(caption.end, caption.source_end - plan.segment.source_start, 0.05)) {
        errors.push(`${label}.caption.end is not normalized from source_end`);
      }
      if (caption.start < -0.01 || (isFiniteNumber(segmentDuration) && caption.end > segmentDuration + 0.01)) {
        errors.push(`${label}.caption falls outside the selected segment`);
      }
    }

    const window = line.visual_window;
    if (!window || !["start", "end", "duration"].every((key) => isFiniteNumber(window[key]))) {
      errors.push(`${label}.visual_window requires finite start/end/duration`);
    } else {
      if (!(window.end > window.start)) errors.push(`${label}.visual_window must have positive duration`);
      if (!near(window.duration, window.end - window.start)) {
        errors.push(`${label}.visual_window.duration must equal end - start`);
      }
      if (!near(window.start, previousVisualEnd, 0.02)) {
        errors.push(`${label}.visual_window does not continue from the previous shot`);
      }
      if (window.duration > MAX_GENERATION_DURATION + 0.01) {
        errors.push(`${label}.visual_window exceeds ${MAX_GENERATION_DURATION}s`);
      }
      previousVisualEnd = window.end;
    }

    if (!Number.isInteger(line.generation_duration_s)
      || line.generation_duration_s < 3
      || line.generation_duration_s > MAX_GENERATION_DURATION) {
      errors.push(`${label}.generation_duration_s must be an integer from 3 to ${MAX_GENERATION_DURATION}`);
    } else if (window && line.generation_duration_s + 0.05 < window.duration) {
      errors.push(`${label}.generation_duration_s is shorter than its visual window`);
    }

    if (requireSelections) {
      if (!Array.isArray(line.candidates) || line.candidates.length < 2 || line.candidates.length > 3) {
        errors.push(`${label}.candidates must contain 2-3 options before approval`);
      } else {
        const candidateLabels = new Set();
        line.candidates.forEach((candidate, candidateIndex) => {
          const candidateLabel = `${label}.candidates[${candidateIndex}]`;
          if (!candidate || typeof candidate !== "object") {
            errors.push(`${candidateLabel} must be an object`);
            return;
          }
          if (typeof candidate.label !== "string" || candidate.label.trim() === "") {
            errors.push(`${candidateLabel}.label is required`);
          } else if (candidateLabels.has(candidate.label)) {
            errors.push(`${candidateLabel}.label is duplicated`);
          } else {
            candidateLabels.add(candidate.label);
          }
          for (const field of ["misheard", "visual", "prompt"]) {
            if (typeof candidate[field] !== "string" || candidate[field].trim() === "") {
              errors.push(`${candidateLabel}.${field} is required`);
            }
          }
        });
        if (
          typeof line.selected === "string"
          && line.selected !== "custom"
          && !candidateLabels.has(line.selected)
        ) {
          errors.push(`${label}.selected must match a candidate label or "custom"`);
        }
      }
      if (typeof line.selected !== "string" || line.selected.trim() === "") {
        errors.push(`${label}.selected is required before approval`);
      }
      for (const field of ["misheard", "visual", "prompt"]) {
        if (typeof line[field] !== "string" || line[field].trim() === "") {
          errors.push(`${label}.${field} is required before approval`);
        }
      }
    }
  });

  if (isFiniteNumber(segmentDuration) && !near(previousVisualEnd, segmentDuration, 0.02)) {
    errors.push("visual windows must cover the complete selected segment");
  }

  return { errors, warnings };
}

export function assertPlanApproved(plan) {
  const validation = validatePlan(plan, { requireSelections: true });
  if (validation.errors.length > 0) {
    throw new Error(`Plan is not generation-ready:\n- ${validation.errors.join("\n- ")}`);
  }
  if (plan.status !== "approved") {
    throw new Error('Plan status is not "approved"; return to the candidate confirmation gate.');
  }
  if (!plan.approval || plan.approval.state !== "approved") {
    throw new Error("Plan approval record is missing.");
  }
  const expected = computePlanDigest(plan);
  if (plan.approval.digest !== expected) {
    throw new Error("Plan changed after approval; obtain explicit user confirmation and run approve-plan again.");
  }
  return { digest: expected, warnings: validation.warnings };
}

export function getShot(plan, shotId) {
  const shot = plan.lines.find((line) => line.id === shotId);
  if (!shot) throw new Error(`Unknown shot id: ${shotId}`);
  return shot;
}

export function getEffectivePrompt(projectDir, plan, shot, revision, attempt) {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error("revision must be a positive integer");
  }
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS_PER_REVISION) {
    throw new Error(`attempt must be 1-${MAX_ATTEMPTS_PER_REVISION}`);
  }
  const approval = assertPlanApproved(plan);
  if (attempt === 1) return shot.prompt;

  const reviewPath = resolve(projectDir, "shots", "review.json");
  if (!existsSync(reviewPath)) throw new Error(`Cannot run attempt ${attempt}: review.json is missing.`);
  const review = readJson(reviewPath);
  const previous = review.shots?.[shot.id]
    ?.revisions?.[String(revision)]
    ?.attempts?.find((entry) => entry.attempt === attempt - 1);
  if (!previous || previous.result !== "fail") {
    throw new Error(`Cannot run attempt ${attempt}: attempt ${attempt - 1} must be recorded as failed first.`);
  }

  const retryPath = resolve(projectDir, "shots", "retry-prompts.json");
  if (!existsSync(retryPath)) throw new Error(`Cannot run attempt ${attempt}: retry prompt is missing.`);
  const retryPrompts = readJson(retryPath);
  const entry = retryPrompts.prompts?.find(
    (candidate) => candidate.shot === shot.id
      && candidate.revision === revision
      && candidate.attempt === attempt,
  );
  if (!entry || typeof entry.prompt !== "string" || entry.prompt.trim() === "") {
    throw new Error(`Cannot run attempt ${attempt}: retry prompt is missing.`);
  }
  if (entry.approval_digest !== approval.digest) {
    throw new Error(`Retry prompt for ${shot.id} attempt ${attempt} predates the current approved plan.`);
  }
  return entry.prompt;
}

export function resolveProject(projectArg) {
  const projectDir = resolve(projectArg);
  const projectFile = resolve(projectDir, "project.json");
  if (!existsSync(projectFile)) {
    throw new Error(`project.json not found in ${projectDir}`);
  }
  return { projectDir, projectFile, project: readJson(projectFile) };
}

export function toProjectRelative(projectDir, filePath) {
  const absolute = resolve(filePath);
  const rel = relative(resolve(projectDir), absolute);
  if (rel === "" || rel === ".") return ".";
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path must stay inside the project: ${filePath}`);
  }
  return rel.split("\\").join("/");
}

export function nonEmptyFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile() && statSync(filePath).size > 0;
}

export function probeMedia(filePath) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "ffprobe failed").trim();
    throw new Error(`Cannot probe ${filePath}: ${detail}`);
  }
  const parsed = JSON.parse(result.stdout);
  const duration = Number(parsed.format?.duration);
  return {
    duration_s: Number.isFinite(duration) ? round3(duration) : null,
    streams: Array.isArray(parsed.streams) ? parsed.streams : [],
    format: parsed.format ?? {},
  };
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatTimeValue(value) {
  const rounded = round3(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function safeTitleFromPath(filePath) {
  return basename(filePath).replace(/\.[^.]+$/, "").trim() || "untitled";
}
