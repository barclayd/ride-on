#!/usr/bin/env bash
# Build a synthetic store with the actual pre-migration Models module, then open
# it with today's code. Neither app data nor production CloudKit is accessed.
set -euo pipefail
repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
baseline=2cca1ceeac5190a008ae80945e2ff3c1b0e85c38
scratch="$(mktemp -d "${TMPDIR:-/tmp}/rideon-compatibility.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
cd "$repo"
git archive "$baseline" app/Packages/Models | tar -x -C "$scratch"
sed '/^import Domain$/d' apple/Packages/Models/Tests/ModelsTests/LegacyStoreCompatibilityTests.swift \
  > "$scratch/app/Packages/Models/Tests/ModelsTests/LegacyStoreCompatibilityTests.swift"
RIDEON_COMPATIBILITY_STORE="$scratch/legacy.store" RIDEON_WRITE_COMPATIBILITY_STORE=1 \
  swift test --package-path "$scratch/app/Packages/Models" --filter LegacyStoreCompatibilityTests
RIDEON_COMPATIBILITY_STORE="$scratch/legacy.store" \
  swift test --package-path apple/Packages/Models --filter LegacyStoreCompatibilityTests
