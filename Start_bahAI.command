#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "🚀 BahAI Agent (Desktop & Web) Başladılır..."
echo "=================================================="

chmod +x scripts/*.sh 2>/dev/null || true
bash scripts/start-bahai-gui.sh
