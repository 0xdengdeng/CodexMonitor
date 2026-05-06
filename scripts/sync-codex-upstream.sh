#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CODEX_DIR="$ROOT_DIR/vendor/codex"

if [ ! -d "$CODEX_DIR/.git" ] && [ ! -f "$CODEX_DIR/.git" ]; then
  echo "[sync-codex-upstream] Codex fork submodule not found at $CODEX_DIR" >&2
  echo "[sync-codex-upstream] Add it with: git submodule add <product-codex-fork-url> vendor/codex" >&2
  exit 1
fi

echo "[sync-codex-upstream] CodexMonitor pins:"
git -C "$ROOT_DIR" submodule status vendor/codex || true

echo
echo "[sync-codex-upstream] Codex fork branch:"
git -C "$CODEX_DIR" branch --show-current || true

echo
echo "[sync-codex-upstream] Fetching remotes:"
git -C "$CODEX_DIR" remote -v
git -C "$CODEX_DIR" fetch --all --prune

echo
echo "[sync-codex-upstream] Fork status:"
git -C "$CODEX_DIR" status --short --branch

echo
echo "[sync-codex-upstream] Next steps:"
echo "1. Merge or rebase official Codex upstream into the product fork."
echo "2. Run the Codex fork tests."
echo "3. Update the vendor/codex submodule pointer in CodexMonitor."
echo "4. Run npm run codex:check-protocol and update CodexMonitor adapters/docs."
