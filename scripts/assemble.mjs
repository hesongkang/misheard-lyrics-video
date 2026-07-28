#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  VIDEO_FPS,
  assertPlanApproved,
  atomicWriteJson,
  computeShotDigest,
  escapeHtml,
  formatTimeValue,
  nonEmptyFile,
  parseArgs,
  probeMedia,
  readJson,
  requireArg,
  resolveProject,
} from "./lib/project.mjs";

function mediaTag(shot, index) {
  return `      <video
        id="${escapeHtml(shot.id)}"
        class="clip shot-media"
        src="shots/${escapeHtml(shot.id)}.mp4"
        data-start="${formatTimeValue(shot.visual_window.start)}"
        data-duration="${formatTimeValue(shot.visual_window.duration)}"
        data-track-index="${10 + index}"
        muted
        playsinline
        preload="auto"
      ></video>`;
}

function captionTag(shot, index) {
  return `      <section
        id="caption-${escapeHtml(shot.id)}"
        class="clip caption-clip"
        data-start="${formatTimeValue(shot.caption.start)}"
        data-duration="${formatTimeValue(shot.caption.end - shot.caption.start)}"
        data-track-index="${200 + index}"
      >
        <div class="caption-text">${escapeHtml(shot.misheard)}</div>
      </section>`;
}

try {
  const args = parseArgs(process.argv.slice(2), ["json"]);
  const { projectDir, project } = resolveProject(requireArg(args, "project"));
  const planPath = resolve(projectDir, "plan.json");
  const plan = readJson(planPath);
  assertPlanApproved(plan);

  const reviewPath = resolve(projectDir, "shots", "review.json");
  if (!existsSync(reviewPath)) throw new Error("shots/review.json is missing.");
  const review = readJson(reviewPath);
  const deliveryShots = [];

  for (const shot of plan.lines) {
    const canonical = resolve(projectDir, "shots", `${shot.id}.mp4`);
    if (!nonEmptyFile(canonical)) throw new Error(`Selected shot is missing: shots/${shot.id}.mp4`);
    const shotReview = review.shots?.[shot.id];
    if (!["passed", "failed_best_selected"].includes(shotReview?.status)) {
      throw new Error(`${shot.id} has no final review selection.`);
    }
    if (shotReview.shot_digest !== computeShotDigest(shot)) {
      throw new Error(`${shot.id} selected media is stale after an approved content change.`);
    }
    const media = probeMedia(canonical);
    if (media.duration_s === null || media.duration_s + 0.15 < shot.visual_window.duration) {
      throw new Error(
        `${shot.id} is ${media.duration_s ?? "unknown"}s but must cover ${shot.visual_window.duration}s.`,
      );
    }
    const video = media.streams.find((stream) => stream.codec_type === "video");
    if (!video) throw new Error(`${shot.id} has no video stream.`);
    deliveryShots.push({
      id: shot.id,
      original: shot.original,
      misheard: shot.misheard,
      prompt: shot.prompt,
      file: `shots/${shot.id}.mp4`,
      review_status: shotReview.status,
      active_revision: shotReview.active_revision,
      selected_attempt: shotReview.revisions?.[String(shotReview.active_revision)]?.selected_attempt ?? null,
      duration_s: media.duration_s,
    });
  }

  const audioRelative = project.source?.audio_path;
  if (typeof audioRelative !== "string" || audioRelative.includes("..")) {
    throw new Error("project.json source.audio_path is invalid.");
  }
  const audioPath = resolve(projectDir, audioRelative);
  if (!nonEmptyFile(audioPath)) throw new Error(`Source audio is missing: ${audioRelative}`);
  const audio = probeMedia(audioPath);
  if (audio.duration_s === null || plan.segment.source_end > audio.duration_s + 0.05) {
    throw new Error("Selected segment exceeds source audio duration.");
  }

  const fontPath = resolve(projectDir, "assets", "fonts", "noto-sans-sc-900.woff2");
  const fontCss = nonEmptyFile(fontPath)
    ? `    @font-face {
      font-family: "Misheard Caption";
      src: url("./assets/fonts/noto-sans-sc-900.woff2") format("woff2");
      font-style: normal;
      font-weight: 900;
      font-display: block;
    }
`
    : `    @font-face {
      font-family: "Misheard Caption";
      src: local("PingFang SC"), local("Microsoft YaHei"), local("Arial");
      font-style: normal;
      font-weight: 900;
    }
`;
  if (!nonEmptyFile(fontPath) && !args.json) {
    console.warn("WARN: local caption font is missing; run build-caption-font.mjs for deterministic Chinese text.");
  }

  const videos = plan.lines.map(mediaTag).join("\n\n");
  const captions = plan.lines.map(captionTag).join("\n\n");
  const duration = formatTimeValue(plan.segment.duration);
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>${escapeHtml(project.title)} · 空耳 MV</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
${fontCss}    * {
      box-sizing: border-box;
    }
    html,
    body {
      width: 1080px;
      height: 1920px;
      margin: 0;
      overflow: hidden;
      background: #000;
    }
    body {
      font-family: "Misheard Caption", sans-serif;
    }
    #root {
      position: relative;
      width: 1080px;
      height: 1920px;
      overflow: hidden;
    }
    .clip,
    .shot-media {
      position: absolute;
      inset: 0;
      width: 1080px;
      height: 1920px;
    }
    .frame-fill {
      position: absolute;
      inset: 0;
      background: #000;
    }
    .shot-media {
      object-fit: cover;
      object-position: center;
    }
    .caption-clip {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding: 0 64px 184px;
    }
    .caption-text {
      width: 100%;
      max-width: 952px;
      color: #fff;
      font-size: 88px;
      font-weight: 900;
      line-height: 1.16;
      letter-spacing: 0.01em;
      text-align: center;
      text-wrap: balance;
      overflow-wrap: anywhere;
      -webkit-text-stroke: 3px #000;
      paint-order: stroke fill;
      text-shadow:
        -4px -4px 0 #000,
        4px -4px 0 #000,
        -4px 4px 0 #000,
        4px 4px 0 #000,
        0 8px 20px rgba(0, 0, 0, 0.9);
    }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="misheard-main"
      data-start="0"
      data-width="1080"
      data-height="1920"
      data-duration="${duration}"
      data-fps="${VIDEO_FPS}"
    >
      <div
        id="background"
        class="clip"
        data-start="0"
        data-duration="${duration}"
        data-track-index="0"
      ><div class="frame-fill"></div></div>

${videos}

      <audio
        id="song-audio"
        src="${escapeHtml(audioRelative)}"
        data-start="0"
        data-media-start="${formatTimeValue(plan.segment.source_start)}"
        data-duration="${duration}"
        data-track-index="1000"
        data-volume="1"
      ></audio>

${captions}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const timeline = gsap.timeline({ paused: true });
      window.__timelines["misheard-main"] = timeline;
    </script>
  </body>
</html>
`;

  const indexPath = resolve(projectDir, "index.html");
  writeFileSync(indexPath, html, "utf8");
  atomicWriteJson(resolve(projectDir, "shot-list.json"), {
    schema_version: 1,
    project_title: project.title,
    segment: plan.segment,
    shots: deliveryShots,
  });

  const result = {
    ok: true,
    index: indexPath,
    duration_s: plan.segment.duration,
    shots: plan.lines.length,
    font_frozen: nonEmptyFile(fontPath),
    failed_best_shots: deliveryShots
      .filter((shot) => shot.review_status === "failed_best_selected")
      .map((shot) => shot.id),
  };
  console.log(args.json ? JSON.stringify(result) : `Assembled ${plan.lines.length} shots (${plan.segment.duration}s) → ${indexPath}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
