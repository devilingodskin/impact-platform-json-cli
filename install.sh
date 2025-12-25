#!/usr/bin/env bash
set -euo pipefail

# install.sh — create symlink to make `impact` available system-wide
# Usage: bash install.sh  (may prompt for sudo)

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT_DIR/Functions/cli/impact-cli.js"
TARGET="/usr/local/bin/impact"

if [ ! -f "$SRC" ]; then
  echo "Error: CLI script not found at $SRC"
  exit 1
fi

echo "Installing impact -> $TARGET"
sudo ln -sf "$SRC" "$TARGET"
sudo chmod +x "$SRC"
echo "Installed: $TARGET -> $SRC"
