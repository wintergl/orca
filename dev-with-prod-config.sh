#!/usr/bin/env bash
# 以 dev 模式启动 Orca，但复用正式版的 userData 配置目录。
# 通过官方环境变量 ORCA_DEV_USER_DATA_PATH 实现（见
# src/main/startup/configure-process.ts:193）。
#
# 使用：
#   nvm use 24 && ./dev-with-prod-config.sh
#
# 注意：运行前请先退出正式版 Orca，避免双进程同时写同一份配置。
set -euo pipefail

# 检查正式版是否还在运行（共享 userData 时双开有数据损坏风险）
if pgrep -f "/Applications/Orca.app/Contents/MacOS" >/dev/null 2>&1; then
  echo "⚠️  检测到正式版 Orca 正在运行。"
  echo "   方案A 共享 userData，双开会导致配置损坏。"
  read -r -p "是否现在退出正式版 Orca？[y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    osascript -e 'tell application "Orca" to quit' 2>/dev/null || true
    sleep 3
    pgrep -f "/Applications/Orca.app/Contents/MacOS" >/dev/null && pkill -f "/Applications/Orca.app/Contents/MacOS" && sleep 2
    echo "✅ 正式版已退出"
  else
    echo "已取消。请先手动退出正式版 Orca 再运行本脚本。"
    exit 1
  fi
fi

# 确保 Node 24
if ! command -v nvm >/dev/null 2>&1; then
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi
nvm use 24 >/dev/null

# 方案A 核心：让 dev 复用正式版 userData
export ORCA_DEV_USER_DATA_PATH="$HOME/Library/Application Support/Orca"

echo "🚀 启动 dev（复用正式版配置）"
echo "   userData → $ORCA_DEV_USER_DATA_PATH"
echo ""

exec pnpm dev
