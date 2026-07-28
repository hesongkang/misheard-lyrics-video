---
name: misheard-lyrics-video
description: >
  Turn a user-provided song audio file into a 60–90 second vertical misheard-lyrics comedy MV:
  timestamp the singing, propose 2–3 phonetic rewrites per line, require line-by-line user approval,
  generate one text-to-video shot per approved joke, review and retry weak shots, then assemble the
  original song, hard-cut visuals, and large Chinese captions with HyperFrames. Use for 空耳视频、
  沙雕MV、谐音歌词视频、把歌做成空耳、misheard lyrics video, or requests to redo one shot in an
  existing misheard-lyrics project. Accept mp3, m4a, or wav supplied by the user.
---

# Misheard Lyrics Video

Create a literal-minded comedy MV from a song. Preserve the melody and lyric timing; change only the
displayed lyric and the visual interpretation.

## Load the contracts

Load companion skills when the host provides them:

- Load `hyperframes` at entry and resume its project lifecycle.
- Load `media-use` before transcription, audio cutting, frame extraction, or media inspection.
- Load `hyperframes-core` before changing composition HTML.
- Load `hyperframes-cli` before checking, previewing, or rendering.

Read this Skill's references only when their stage applies:

- Read `references/workflow.md` while creating or resuming a project.
- Read `references/misheard-writing.md` before proposing candidates.
- Read `references/video-prompts.md` before generating or retrying a shot.
- Read `references/review.md` before judging generated shots.
- Read `references/composition.md` before assembly or a timing edit.
- Read `references/project-schema.md` before directly editing project JSON.

## Enforce the two approval gates

Treat both gates as mandatory:

1. **Candidate gate:** do not call `gen_video`, `listenhub video`, or any other paid video generator
   until the user explicitly selects or edits every line. Silence, an earlier general request to
   make a video, autonomous mode, and an estimated budget are not approval.
2. **Render gate:** after `hyperframes check` passes, open the final Studio preview and ask whether
   to revise or render. Render only after an explicit render answer.

`scripts/approve-plan.mjs` locks the candidate gate with a content digest.
`scripts/assert-generation-ready.mjs` must pass immediately before every video-generation call.
If any approved timing, subtitle, joke, visual meaning, or base prompt changes, the digest becomes
invalid; return to the candidate gate and approve the changed plan again. Do not mutate the plan for
automatic review retries: record their minimal Prompt repair with `set-retry-prompt.mjs`.

## Start or resume

Resolve this Skill's directory, then choose the host:

- If the Cola-native `gen_video` tool is available, use host `cola`.
- Otherwise use host `codex` and the ListenHub CLI path.

Run the dependency check before other work:

```bash
bash <skill-dir>/scripts/check-deps.sh --host <cola|codex>
```

When the user points to an existing output project, inspect it first:

```bash
node <skill-dir>/scripts/project-status.mjs --project <project-dir>
```

Resume from the reported stage. Never regenerate an existing accepted shot. For a new song, create
an isolated project:

```bash
node <skill-dir>/scripts/init-project.mjs \
  --audio <song.mp3> \
  --output <output>/<song-name>-空耳MV \
  --title <song-name>
```

The project owns all user media and generated artifacts. Do not copy them into this Skill
repository.

If status reports `recoverable_shots`, restore their already-selected attempts locally before any
generation:

```bash
node <skill-dir>/scripts/restore-selected-shots.mjs --project <project>
```

If status reports `stale_shots`, regenerate only those shots under the next revision with `--redo`.
Unchanged shots keep their per-shot digest and remain reusable.

## Execute the workflow

### 1. Transcribe and group

Run HyperFrames transcription into the project's private work directory, then normalize its
word-level output into line candidates:

```bash
npx hyperframes transcribe <project>/source/<song-file> \
  --dir <project>/.work/asr --engine whisper --model medium --language zh --json

node <skill-dir>/scripts/group-transcript.mjs \
  --input <project>/.work/asr/transcript.json \
  --output <project>/transcript.json
```

Singing ASR text may be wrong. Correct lyric text when evidence supports it, but preserve every
timestamp unless the audio itself proves the boundary is wrong.

### 2. Select the excerpt and scaffold the plan

Default to one verse plus one chorus totaling 60–90 seconds. Honor a user-provided range or
start/end lyric instead. Scaffold `plan.json` from the chosen source times:

```bash
node <skill-dir>/scripts/create-plan.mjs \
  --project <project> --start <seconds> --end <seconds>
```

Keep visual shot windows continuous. Keep caption windows aligned to the singing. Split any visual
window longer than 15 seconds before generation.

### 3. Write candidates and pause

For every planned line, write 2–3 candidates into `plan.json`, including the literal visual,
generation prompt, and scores. Include “保留原词” when it is a useful setup beat. Present:

```text
| # | 时间 | 原词 | 候选A | 候选B | 候选C |
```

Tell the user they can answer `1A 2B 3自定义：…`. End the turn and wait. Make no video-generation
call during this pause.

### 4. Apply the explicit selection

After the user responds, set each line's `selected`, `misheard`, `visual`, and `prompt`. Preserve
unselected candidates for audit. Then lock the exact content:

```bash
node <skill-dir>/scripts/approve-plan.mjs \
  --project <project> --confirmation "user selected every line in chat"
```

Do not approve on the user's behalf.

### 5. Generate only missing shots

Query status and work only on `missing_shots` or an explicitly requested redo.

For Cola, run the guard, call native `gen_video`, and save the result under
`shots/attempts/shot_NN_attempt_K.mp4`:

```bash
node <skill-dir>/scripts/assert-generation-ready.mjs \
  --project <project> --shot shot_NN --revision 1 --attempt K --json
```

Use `doubao-seedance-2-pro`, 1080p, 9:16, and the returned `generation_duration_s`. The final song
is the only audio, so disable generated shot audio when the tool supports it.
After the native tool saves the file, validate and log it:

```bash
node <skill-dir>/scripts/record-generation.mjs \
  --project <project> --shot shot_NN --revision 1 --attempt K \
  --file <attempt.mp4> --host cola
```

Outside Cola, use the guarded wrapper:

```bash
node <skill-dir>/scripts/listenhub-shot.mjs \
  --project <project> --shot shot_NN --attempt K
```

The wrapper checks auth, submits SeeDance 2.0 Pro, waits, downloads locally, and records the task.

### 6. Review each shot

Create one early/middle/late contact sheet and inspect it with the host's vision capability:

```bash
bash <skill-dir>/scripts/extract-review-frames.sh \
  <attempt.mp4> <project>/shots/review/shot_NN_attempt_K.jpg
```

Judge whether the literal misheard phrase is unmistakable, the subject/action is correct, the frame
is usable in 9:16, and no safety exclusion is violated. Record every result. A failed first version
may be retried twice, for three attempts total. Change only the prompt weakness identified by the
review.

After recording a failed attempt, keep the approved plan unchanged and register the automatic repair:

```bash
node <skill-dir>/scripts/set-retry-prompt.mjs \
  --project <project> --shot shot_NN --revision 1 --attempt <2|3> \
  --prompt <repaired-prompt> --reason <review-failure>
```

The retry prompt is accepted only when the previous attempt is recorded as failed and remains bound
to the current approval digest.

Select a passing attempt:

```bash
node <skill-dir>/scripts/record-review.mjs \
  --project <project> --shot shot_NN --attempt K --result pass \
  --score <1-5> --reason <summary> --file <attempt.mp4> --select
```

If all three fail, select the visually best attempt with
`--result fail --select --select-attempt <1|2|3>`; delivery must label it
`未过审，建议人工重做`.

### 7. Assemble and check

Freeze the approved caption font, generate the deterministic composition, and run the project pin:

```bash
node <skill-dir>/scripts/build-caption-font.mjs --project <project>
node <skill-dir>/scripts/assemble.mjs --project <project>
cd <project>
npm run upgrade:check
npm run check
npm run preview
```

If `upgrade:check` reports an available HyperFrames version, apply
`npx hyperframes@latest upgrade --project .`, rerun the complete check, and report the old and new
pin. If the upgraded check fails, restore the previous package-script pin and report why.

Run preview as a long-lived background process, confirm the server is still alive, and hand the
actual Studio URL containing `#project/<project-directory-name>`. Do not hand the `index.html` path.

Use hard cuts, muted shot videos, one original-song audio element, and only the approved misheard
captions. Do not add transitions, original-lyric comparison, or a generated music bed.

### 8. Render and deliver

After final-look approval:

```bash
cd <project>
npm run render
bash <skill-dir>/scripts/verify-render.sh \
  <project>/renders/video.mp4 <project>/plan.json
```

Deliver the MP4 plus a shot table listing original text, misheard text, selected file, review result,
and any failed-best shot. Explain that `重做第 N 镜` re-enters at that shot without rebuilding the
rest.

After a verified render, send one HyperFrames feedback report unless telemetry is disabled or the
user opted out. Keep a clean-run report brief; redact personal paths and follow the CLI reproduction
packet contract for any failure.

## Boundaries

- Accept only user-provided local audio. Do not search for or download songs and do not create an AI
  cover.
- Show only the misheard lyric. Keep subtitle styling fixed.
- Use text-to-video for every shot; do not silently fall back to image animation.
- Let style follow the joke; cross-shot visual inconsistency is intentional.
- Avoid sexual vulgarity, political content, and humiliating or deceptive depictions of real
  celebrities.
- Keep credentials, source songs, generated media, and absolute personal paths out of the public
  Skill repository.
