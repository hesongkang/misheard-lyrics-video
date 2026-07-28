#!/usr/bin/env node

import { resolve } from "node:path";
import {
  SCHEMA_VERSION,
  atomicWriteJson,
  parseArgs,
  readJson,
  requireArg,
  round3,
} from "./lib/project.mjs";

function normalizeWords(raw) {
  if (Array.isArray(raw)) {
    return raw.map((word) => ({
      text: String(word.text ?? word.word ?? "").trim(),
      start: Number(word.start),
      end: Number(word.end),
    }));
  }
  if (raw && Array.isArray(raw.words)) {
    return raw.words.map((word) => ({
      text: String(word.text ?? word.word ?? "").trim(),
      start: Number(word.start),
      end: Number(word.end),
    }));
  }
  if (raw && Array.isArray(raw.transcription)) {
    const words = [];
    for (const segment of raw.transcription) {
      for (const token of segment.tokens ?? []) {
        const text = String(token.text ?? "").trim();
        if (!text || text.startsWith("[_") || text.startsWith("[BLANK")) continue;
        words.push({
          text,
          start: Number(token.start ?? token.offsets?.from / 1000),
          end: Number(token.end ?? token.offsets?.to / 1000),
        });
      }
    }
    return words;
  }
  throw new Error("Unsupported transcript JSON. Expected a word array, {words:[]}, or whisper.cpp transcription.");
}

function containsCjk(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function joinTokens(tokens) {
  let output = "";
  for (const token of tokens) {
    const text = token.text;
    if (!output) {
      output = text;
      continue;
    }
    const previous = output.at(-1) ?? "";
    const punctuation = /^[，。！？；：、,.!?;:'"）】》…—-]/u.test(text);
    const noSpace = punctuation || containsCjk(previous) || containsCjk(text);
    output += noSpace ? text : ` ${text}`;
  }
  return output.trim();
}

try {
  const args = parseArgs(process.argv.slice(2), ["json"]);
  const inputPath = resolve(requireArg(args, "input"));
  const outputPath = resolve(requireArg(args, "output"));
  const maxGap = Number(args["max-gap"] ?? 0.8);
  const maxDuration = Number(args["max-duration"] ?? 7);
  const maxChars = Number(args["max-chars"] ?? 18);

  if (![maxGap, maxDuration, maxChars].every(Number.isFinite)) {
    throw new Error("Grouping limits must be finite numbers.");
  }

  const words = normalizeWords(readJson(inputPath))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word) => ({ ...word, start: round3(word.start), end: round3(word.end) }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (words.length === 0) throw new Error("Transcript contains no usable words.");
  words.forEach((word, index) => {
    if (!(word.end > word.start)) throw new Error(`Word ${index} has a non-positive time window.`);
    if (index > 0 && word.start + 0.05 < words[index - 1].start) {
      throw new Error("Words are not chronological.");
    }
  });

  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const previous = current.at(-1);
    if (previous && word.start - previous.end > maxGap) flush();
    current.push({ ...word, index });

    const first = current[0];
    const text = joinTokens(current);
    const duration = word.end - first.start;
    const terminal = /[。！？!?；;…]$/u.test(word.text);
    const next = words[index + 1];
    const nextGap = next ? next.start - word.end : Number.POSITIVE_INFINITY;
    const longEnough = text.length >= maxChars && nextGap >= 0.2;
    if (terminal || duration >= maxDuration || longEnough) flush();
  }
  flush();

  const lines = groups.map((group, index) => ({
    id: `line_${String(index + 1).padStart(3, "0")}`,
    start: round3(group[0].start),
    end: round3(group.at(-1).end),
    original: joinTokens(group),
    word_start: group[0].index,
    word_end: group.at(-1).index,
  }));

  const output = {
    schema_version: SCHEMA_VERSION,
    source_format: "hyperframes-words",
    words,
    lines,
  };
  atomicWriteJson(outputPath, output);
  const result = { ok: true, output: outputPath, word_count: words.length, line_count: lines.length };
  console.log(args.json ? JSON.stringify(result) : `Grouped ${words.length} words into ${lines.length} lines → ${outputPath}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

