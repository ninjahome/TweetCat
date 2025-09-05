#!/bin/bash
set -euo pipefail

# === config ===
APP_PATH="${1:-}"   # 传入 .app 或 .dmg 的路径；传 .app 时脚本会自行打 zip
IDENTITY="${IDENTITY:-Developer ID Application: Yushian (Beijing) Technology Co., Ltd.}"
PROFILE="${PROFILE:-notary-profile}"     # notarytool 的 keychain profile 名
USE_PROFILE="${USE_PROFILE:-1}"          # 1=使用保存的 profile；0=使用账号方式
APPLE_ID="${APPLE_ID:-}"                 # 当 USE_PROFILE=0 时需要
TEAM_ID="${TEAM_ID:-2XYK8RBB6M}"         # 你的 Team ID
APP_PWD="${APP_PWD:-}"                   # Apple ID 的 App 专用密码（USE_PROFILE=0 时需要）

err() { echo "ERROR: $*" >&2; exit 1; }
info(){ echo "==> $*"; }

[[ -z "$APP_PATH" ]] && err "用法: ./notarize_app.sh /path/to/YourApp.app|YourApp.dmg"
[[ -e "$APP_PATH" ]] || err "找不到文件: $APP_PATH"

ABS_PATH="$(cd "$(dirname "$APP_PATH")" && pwd)/$(basename "$APP_PATH")"

# 如果是 .app，给嵌入的三件工具做 HR 签名并深度重签 .app
if [[ "$ABS_PATH" == *.app ]]; then
  APP_ABS="$ABS_PATH"
  TOOLS_DIR="$APP_ABS/Contents/Resources"
  info "App: $APP_ABS"
  info "Identity: $IDENTITY"
  info "Tools dir: $TOOLS_DIR"

  for f in yt-dlp_macos ffmpeg ffprobe; do
    BIN="$TOOLS_DIR/$f"
    if [[ -f "$BIN" ]]; then
      info "codesign (HR) $f"
      /usr/bin/codesign --force --sign "$IDENTITY" --options runtime --timestamp "$BIN"
    else
      echo "未找到: $BIN "
    fi
  done

  info "deep re-sign app bundle"
 # 兼容旧版 codesign：优先用 --deep-bundle-version 2，不支持就退回 --deep
 if /usr/bin/codesign -h 2>&1 | grep -q -- "--deep-bundle-version"; then
   /usr/bin/codesign --force --deep-bundle-version 2 \
     --sign "$IDENTITY" --options runtime --timestamp "$APP_ABS"
 else
   /usr/bin/codesign --force --deep \
     --sign "$IDENTITY" --options runtime --timestamp "$APP_ABS"
 fi

  info "verify hardened runtime on embedded tools"
  for f in yt-dlp_macos ffmpeg ffprobe; do
    BIN="$TOOLS_DIR/$f"
    [[ -f "$BIN" ]] && /usr/bin/codesign -dv --verbose=4 "$BIN" 2>&1 | grep -E "Identifier|Hardened" || true
  done

  ZIP_PATH="${APP_ABS%.*}.zip"
  info "zip -> $ZIP_PATH"
  ditto -c -k --keepParent "$APP_ABS" "$ZIP_PATH"
  SUBMIT_PATH="$ZIP_PATH"
else
  # 传入的是 .dmg/.pkg/.zip 时，直接用于公证
  SUBMIT_PATH="$ABS_PATH"
  info "Bundle: $SUBMIT_PATH"
fi

# 5) 公证（不解析 JSON，直接看退出码；顺便把输出保存到日志）
echo "→ notarize with notarytool (this may take a while)"
LOGFILE="${SUBMIT_PATH%.*}.notary.log"
set +e
if [[ "$USE_PROFILE" == "1" ]]; then
  xcrun notarytool submit "$SUBMIT_PATH" --keychain-profile "$PROFILE" --wait | tee "$LOGFILE"
  RC=${PIPESTATUS[0]}
else
  xcrun notarytool submit "$SUBMIT_PATH" \
    --apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APP_PWD" \
    --wait | tee "$LOGFILE"
  RC=${PIPESTATUS[0]}
fi
set -e

if [[ $RC -ne 0 ]]; then
  echo "❌ Notarization failed. See log: $LOGFILE"
  exit $RC
fi
echo "✅ Notarization Accepted."

# 6) staple & Gatekeeper 自检
echo "→ staple ticket"
xcrun stapler staple "$ABS_PATH"

echo "→ spctl check (Gatekeeper)"
spctl -a -vv "$ABS_PATH" || true

echo "✅ 完成。产物："
if [[ "${ZIP_PATH:-}" ]]; then
  echo "   App: $APP_ABS"
  echo "   Zip: $ZIP_PATH"
else
  echo "   Bundle: $ABS_PATH"
fi
