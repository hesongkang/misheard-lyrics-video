#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: extract-review-frames.sh <input.mp4> <output.jpg>" >&2
  exit 2
fi

input_file="$1"
output_file="$2"

if [ ! -s "$input_file" ]; then
  echo "ERROR: input video is missing or empty: $input_file" >&2
  exit 1
fi

duration="$(
  ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$input_file"
)"
if ! awk -v value="$duration" 'BEGIN { exit !(value > 0) }'; then
  echo "ERROR: could not determine a positive video duration" >&2
  exit 1
fi

output_dir="$(dirname "$output_file")"
mkdir -p "$output_dir"
review_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/misheard-review.XXXXXX")"
trap 'rm -r -- "$review_tmp_dir"' EXIT

early="$(awk -v value="$duration" 'BEGIN { printf "%.3f", value * 0.15 }')"
middle="$(awk -v value="$duration" 'BEGIN { printf "%.3f", value * 0.50 }')"
late="$(awk -v value="$duration" 'BEGIN { printf "%.3f", value * 0.85 }')"

ffmpeg -v error -y -ss "$early" -i "$input_file" -frames:v 1 -vf "scale=360:-2" "$review_tmp_dir/early.jpg"
ffmpeg -v error -y -ss "$middle" -i "$input_file" -frames:v 1 -vf "scale=360:-2" "$review_tmp_dir/middle.jpg"
ffmpeg -v error -y -ss "$late" -i "$input_file" -frames:v 1 -vf "scale=360:-2" "$review_tmp_dir/late.jpg"
ffmpeg -v error -y \
  -i "$review_tmp_dir/early.jpg" \
  -i "$review_tmp_dir/middle.jpg" \
  -i "$review_tmp_dir/late.jpg" \
  -filter_complex "hstack=inputs=3" \
  -frames:v 1 \
  "$output_file"

if [ ! -s "$output_file" ]; then
  echo "ERROR: contact sheet was not created" >&2
  exit 1
fi

echo "Created review contact sheet: $output_file"

