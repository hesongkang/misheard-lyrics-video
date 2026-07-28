#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: verify-render.sh <video.mp4> <plan.json>" >&2
  exit 2
fi

video_file="$1"
plan_file="$2"

if [ ! -s "$video_file" ]; then
  echo "ERROR: render is missing or empty: $video_file" >&2
  exit 1
fi
if [ ! -s "$plan_file" ]; then
  echo "ERROR: plan is missing or empty: $plan_file" >&2
  exit 1
fi

expected_duration="$(
  node -e '
    const fs = require("fs");
    const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!Number.isFinite(plan?.segment?.duration)) process.exit(1);
    process.stdout.write(String(plan.segment.duration));
  ' "$plan_file"
)"

actual_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$video_file")"
width="$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 "$video_file")"
height="$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 "$video_file")"
frame_rate="$(ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of default=nw=1:nk=1 "$video_file")"
video_codec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$video_file")"
audio_codec="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$video_file")"
audio_count="$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$video_file" | awk 'NF { count += 1 } END { print count + 0 }')"

[ "$width" = "1080" ] || { echo "ERROR: expected width 1080, got $width" >&2; exit 1; }
[ "$height" = "1920" ] || { echo "ERROR: expected height 1920, got $height" >&2; exit 1; }
[ "$video_codec" = "h264" ] || { echo "ERROR: expected H.264 video, got $video_codec" >&2; exit 1; }
[ "$audio_codec" = "aac" ] || { echo "ERROR: expected AAC audio, got ${audio_codec:-none}" >&2; exit 1; }
[ "$audio_count" -ge 1 ] || { echo "ERROR: render has no audio stream" >&2; exit 1; }

if ! awk -v rate="$frame_rate" 'BEGIN {
  split(rate, parts, "/");
  fps = parts[2] == 0 ? 0 : parts[1] / parts[2];
  exit !(fps >= 29.9 && fps <= 30.1);
}'; then
  echo "ERROR: expected 30fps, got $frame_rate" >&2
  exit 1
fi

if ! awk -v expected="$expected_duration" -v actual="$actual_duration" 'BEGIN {
  delta = expected - actual;
  if (delta < 0) delta = -delta;
  exit !(delta <= 0.5);
}'; then
  echo "ERROR: duration mismatch, expected ${expected_duration}s, got ${actual_duration}s" >&2
  exit 1
fi

ffmpeg -v error -i "$video_file" -f null -

if file_size="$(stat -f '%z' "$video_file" 2>/dev/null)"; then
  :
else
  file_size="$(stat -c '%s' "$video_file")"
fi

echo "OK: render verified"
echo "  file: $video_file"
echo "  duration: ${actual_duration}s"
echo "  dimensions: ${width}x${height}"
echo "  frame rate: $frame_rate"
echo "  codecs: ${video_codec}+${audio_codec}"
echo "  bytes: $file_size"

