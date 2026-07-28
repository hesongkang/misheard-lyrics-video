#!/usr/bin/env bash
set -u

host="auto"
soft=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      [ "$#" -ge 2 ] || { echo "ERROR: --host needs cola or codex" >&2; exit 2; }
      host="$2"
      shift 2
      ;;
    --soft)
      soft=1
      shift
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [ "$host" = "auto" ]; then
  host="${MISHEARD_HOST:-codex}"
fi
case "$host" in
  cola|codex) ;;
  *)
    echo "ERROR: --host must be cola or codex" >&2
    exit 2
    ;;
esac

failures=0
warnings=0

ok() {
  printf 'OK: %s\n' "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf 'WARN: %s\n' "$1"
}

fail() {
  failures=$((failures + 1))
  printf 'ERROR: %s\n' "$1" >&2
}

need_command() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 found"
  else
    fail "$1 is missing. $2"
  fi
}

need_command node "Install Node.js 22 or newer."
need_command npx "Install npm with Node.js."
need_command ffmpeg "Install FFmpeg (macOS: brew install ffmpeg)."
need_command ffprobe "Install FFmpeg/ffprobe (macOS: brew install ffmpeg)."

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [ "$node_major" -ge 22 ]; then
    ok "Node.js $(node --version) meets >=22"
  else
    fail "Node.js 22+ is required; found $(node --version 2>/dev/null || echo unknown)."
  fi
fi

hyperframes_runner=(npx --yes hyperframes)
hyperframes_source="npx"
if command -v hyperframes >/dev/null 2>&1; then
  hyperframes_runner=(hyperframes)
  hyperframes_source="global command"
fi

if command -v npx >/dev/null 2>&1; then
  hyperframes_version="$("${hyperframes_runner[@]}" --version 2>/dev/null || true)"
  if [ -n "$hyperframes_version" ]; then
    ok "HyperFrames $hyperframes_version via $hyperframes_source"
  else
    fail "HyperFrames CLI is unavailable. Install it or verify that `npx hyperframes --version` works."
  fi
  if "${hyperframes_runner[@]}" transcribe --help 2>&1 | grep -q "word-level timestamps"; then
    ok "HyperFrames transcribe is available"
  else
    fail "HyperFrames transcribe is unavailable; upgrade HyperFrames."
  fi
fi

if [ "$host" = "codex" ]; then
  need_command listenhub "Install @marswave/listenhub-cli and run listenhub auth login."
  if command -v listenhub >/dev/null 2>&1; then
    if listenhub auth status >/dev/null 2>&1; then
      ok "ListenHub authentication is active"
    else
      fail "ListenHub is not logged in. Run: listenhub auth login"
    fi
    if listenhub video create --help 2>&1 | grep -q "doubao-seedance-2-pro"; then
      ok "ListenHub SeeDance 2.0 Pro path is available"
    else
      fail "ListenHub video create does not expose doubao-seedance-2-pro; upgrade the CLI."
    fi
  fi
else
  warn "The shell cannot inspect Cola's native gen_video tool; confirm it is visible to the agent before approval."
fi

skill_home="${COLA_DATA_DIR:-$HOME/.cola}/skills"
if [ "$host" = "codex" ]; then
  skill_home="${CODEX_HOME:-$HOME/.codex}/skills"
fi
for companion in hyperframes hyperframes-core hyperframes-cli media-use; do
  if [ ! -f "$skill_home/$companion/SKILL.md" ]; then
    warn "Companion Skill '$companion' is not installed under $skill_home; CLI execution still works, but contract guidance may be unavailable."
  fi
done

printf 'SUMMARY: %s error(s), %s warning(s), host=%s\n' "$failures" "$warnings" "$host"
if [ "$failures" -gt 0 ] && [ "$soft" -ne 1 ]; then
  exit 1
fi
