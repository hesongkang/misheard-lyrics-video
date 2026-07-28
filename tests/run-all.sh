#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"

echo "== T1 static contracts =="
bash "$repo_dir/tests/t1-static.sh"

echo "== T2 state-machine unit tests =="
node --test "$repo_dir/tests/unit.test.mjs"

echo "== T3 synthetic workflow =="
test_root="$(mktemp -d "${TMPDIR:-/tmp}/misheard-tests.XXXXXX")"
trap 'rm -r -- "$test_root"' EXIT
project_dir="$test_root/project"
node "$repo_dir/tests/integration.mjs" --output "$project_dir"

if [ "${SKIP_HYPERFRAMES_CHECK:-0}" = "1" ]; then
  echo "== T4 HyperFrames check skipped =="
else
  echo "== T4 HyperFrames check =="
  (
    cd "$project_dir"
    npm run check
  )
fi

echo "ALL TESTS PASSED"

