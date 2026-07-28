#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
skill_name="misheard-lyrics-video"
mode="${1:---all}"

case "$mode" in
  --cola) mode="cola" ;;
  --codex) mode="codex" ;;
  --all) mode="all" ;;
  *)
    echo "Usage: ./install.sh [--cola|--codex|--all]" >&2
    exit 2
    ;;
esac

if ! command -v rsync >/dev/null 2>&1; then
  echo "ERROR: rsync is required to install this Skill." >&2
  exit 1
fi

cola_skills="${COLA_DATA_DIR:-$HOME/.cola}/skills"
codex_skills="${CODEX_HOME:-$HOME/.codex}/skills"

sync_skill() {
  target="$1"
  mkdir -p "$target"
  rsync -a --delete \
    --exclude '.git' \
    --exclude '.gitignore' \
    --exclude '.DS_Store' \
    --exclude 'node_modules' \
    --exclude 'tests' \
    --exclude 'README.md' \
    --exclude 'REQUIREMENTS.md' \
    --exclude 'install.sh' \
    --exclude 'uninstall.sh' \
    "$script_dir/" "$target/"
}

install_cola() {
  target="$cola_skills/$skill_name"
  sync_skill "$target"
  echo "Installed Cola Skill: $target"
  bash "$target/scripts/check-deps.sh" --host cola --soft
  echo "Restart Cola to make the new Skill appear."
}

install_codex() {
  target="$codex_skills/$skill_name"
  sync_skill "$target"
  echo "Installed Codex Skill: $target"
  bash "$target/scripts/check-deps.sh" --host codex --soft
}

case "$mode" in
  cola) install_cola ;;
  codex) install_codex ;;
  all)
    install_cola
    install_codex
    ;;
esac

