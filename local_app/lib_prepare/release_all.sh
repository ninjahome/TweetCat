#!/bin/bash
set -euo pipefail

# 默认 .app 路径（可被入参覆盖）
APP_PATH="${1:-./TweetCatApp/TweetCatApp.app}"

# 允许通过环境变量覆盖一些常用配置（可选）
: "${PROFILE:=notary-profile}"   # notarytool keychain profile
: "${IDENTITY:=Developer ID Application: Yushian (Beijing) Technology Co., Ltd.}"
: "${VOL_NAME:=TweetCatApp}"     # DMG 卷名
: "${OUT_DIR:=$(pwd)}"           # DMG 输出目录

# 可选开关：跳过某步（默认都执行）
: "${SKIP_APP_NOTARIZE:=0}"      # 1=跳过 notarize_app.sh
: "${SKIP_DMG:=0}"               # 1=跳过 make_dmg_and_notarize.sh

echo "==> App path: $APP_PATH"
[[ -d "$APP_PATH" ]] || { echo "ERROR: 找不到 .app: $APP_PATH"; exit 1; }

# 确保两个子脚本存在并可执行
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SCRIPT="$ROOT_DIR/notarize_app.sh"
DMG_SCRIPT="$ROOT_DIR/make_dmg_and_notarize.sh"

[[ -x "$APP_SCRIPT" ]] || { echo "ERROR: $APP_SCRIPT 不存在或不可执行"; exit 1; }
[[ -x "$DMG_SCRIPT" ]] || { echo "ERROR: $DMG_SCRIPT 不存在或不可执行"; exit 1; }

# 输出当前关键配置（供日志排查）
echo "==> Identity: $IDENTITY"
echo "==> Notary profile: $PROFILE"
echo "==> DMG Volume name: $VOL_NAME"
echo "==> Output dir: $OUT_DIR"

# 1) 公证 .app（带 Hardened Runtime 的重签 + staple）
if [[ "$SKIP_APP_NOTARIZE" != "1" ]]; then
  echo "==> Step 1/2: notarize_app.sh"
  PROFILE="$PROFILE" IDENTITY="$IDENTITY" \
  "$APP_SCRIPT" "$APP_PATH"
else
  echo "==> Step 1/2: 跳过 .app 公证（SKIP_APP_NOTARIZE=1）"
fi

# 2) 生成并公证 DMG
if [[ "$SKIP_DMG" != "1" ]]; then
  echo "==> Step 2/2: make_dmg_and_notarize.sh"
  PROFILE="$PROFILE" IDENTITY="$IDENTITY" VOL_NAME="$VOL_NAME" OUT_DIR="$OUT_DIR" \
  "$DMG_SCRIPT" "$APP_PATH"
else
  echo "==> Step 2/2: 跳过 DMG 生成与公证（SKIP_DMG=1）"
fi

echo "✅ 全流程完成"
