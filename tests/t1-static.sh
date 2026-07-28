#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"

for file in "$repo_dir"/install.sh "$repo_dir"/uninstall.sh "$repo_dir"/scripts/*.sh; do
  bash -n "$file"
done

for file in "$repo_dir"/scripts/*.mjs "$repo_dir"/scripts/lib/*.mjs "$repo_dir"/tests/*.mjs; do
  node --check "$file"
done

frontmatter="$(sed -n '1,/^---$/p' "$repo_dir/SKILL.md"; sed -n '2,/^---$/p' "$repo_dir/SKILL.md")"
grep -q '^name: misheard-lyrics-video$' <<<"$frontmatter"
grep -q '^description:' <<<"$frontmatter"
for trigger in "空耳视频" "沙雕MV" "谐音歌词视频" "misheard lyrics video" "把歌做成空耳"; do
  grep -qi "$trigger" <<<"$frontmatter" || {
    echo "ERROR: trigger missing from SKILL.md description: $trigger" >&2
    exit 1
  }
done

grep -q "重启 Cola" "$repo_dir/README.md"
grep -q "install.sh.*--cola" "$repo_dir/README.md"

if find "$repo_dir" -path "$repo_dir/.git" -prune -o -type f \
  \( -name '*.mp3' -o -name '*.m4a' -o -name '*.wav' -o -name '*.mp4' -o -name '*.mov' \) \
  -print | grep -q .; then
  echo "ERROR: generated/source media is present in the Skill repository" >&2
  exit 1
fi

if rg -n --hidden -g '!.git/**' -g '!REQUIREMENTS.md' \
  '(sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*["'\''][^"'\'']+|bearer\s+[A-Za-z0-9._-]{20,})' \
  "$repo_dir"; then
  echo "ERROR: possible credential found" >&2
  exit 1
fi

echo "T1 static checks PASS"

