#!/usr/bin/env bash
set -euo pipefail

skill_name="misheard-lyrics-video"
mode="${1:---all}"

case "$mode" in
  --cola) mode="cola" ;;
  --codex) mode="codex" ;;
  --all) mode="all" ;;
  *)
    echo "Usage: ./uninstall.sh [--cola|--codex|--all]" >&2
    exit 2
    ;;
esac

cola_target="${COLA_DATA_DIR:-$HOME/.cola}/skills/$skill_name"
codex_target="${CODEX_HOME:-$HOME/.codex}/skills/$skill_name"

remove_skill() {
  target="$1"
  label="$2"
  case "$target" in
    */skills/misheard-lyrics-video) ;;
    *)
      echo "ERROR: refusing unexpected uninstall target: $target" >&2
      exit 1
      ;;
  esac
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf -- "$target"
    echo "Removed $label Skill: $target (not recoverable from the install directory)"
  else
    echo "$label Skill is not installed: $target"
  fi
}

case "$mode" in
  cola) remove_skill "$cola_target" "Cola" ;;
  codex) remove_skill "$codex_target" "Codex" ;;
  all)
    remove_skill "$cola_target" "Cola"
    remove_skill "$codex_target" "Codex"
    ;;
esac

