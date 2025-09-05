#!/bin/bash
set -euo pipefail

### ===== 必填/可配参数 =====
APP_PATH="${1:-${APP_PATH:-}}"
DEV_ID_APP="${DEV_ID_APP:-Developer ID Application: Yushian (Beijing) Technology Co., Ltd.}"
NOTARY_PROFILE="${NOTARY_PROFILE:-notary-profile}"

VOL_NAME="${VOL_NAME:-TweetCatApp}"
OUT_DIR="${OUT_DIR:-$(pwd)}"
SIGN_DMG="${SIGN_DMG:-1}"         # 1=给 DMG 代码签名；0=不签
NOTARIZE_DMG="${NOTARIZE_DMG:-1}" # 1=对 DMG 也公证；0=不公证（通常不需要）
### ========================

err(){ echo "ERROR: $*" >&2; exit 1; }
info(){ echo "==> $*"; }

[[ -n "$APP_PATH" ]] || err "用法: $0 /path/to/YourApp.app  或设置 APP_PATH 环境变量"
[[ -d "$APP_PATH" ]] || err "找不到 .app: $APP_PATH"

APP_ABS="$(cd "$(dirname "$APP_PATH")" && pwd)/$(basename "$APP_PATH")"
APP_NAME="$(basename "$APP_ABS" .app)"
WORK_DIR="$(mktemp -d -t "${APP_NAME}-work")"
ZIP_PATH="${WORK_DIR}/${APP_NAME}.zip"
DMG_PATH="${OUT_DIR}/${APP_NAME}.dmg"
NOTARY_LOG_APP="${OUT_DIR}/${APP_NAME}.app.notary.log"

cleanup(){ rm -rf "$WORK_DIR"; }
trap cleanup EXIT

info "App: $APP_ABS"
info "Work: $WORK_DIR"
info "Out DMG: $DMG_PATH"
info "Signer: $DEV_ID_APP"
info "Notary profile: $NOTARY_PROFILE"

xcrun --version >/dev/null

is_macho() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  file -b "$f" | grep -Eiq 'Mach-O' || return 1
  return 0
}

sign_one() {
  local target="$1"
  codesign --force --options runtime --timestamp --sign "$DEV_ID_APP" "$target"
}

### 1) 递归签名嵌套 Mach-O
info "Scanning and signing nested Mach-O files (may take a while)..."

CANDIDATES=()
# 兼容 bash 3.2：用 -print0 + read -d ''
while IFS= read -r -d '' f; do
  CANDIDATES+=("$f")
done < <(find "$APP_ABS/Contents" \( \
            -path "*/Frameworks/*" -o \
            -path "*/MacOS/*" -o \
            -path "*/PlugIns/*" -o \
            -path "*/XPCServices/*" -o \
            -path "*/Helpers/*" -o \
            -path "*/Resources/*" \
         \) -type f -print0 2>/dev/null)

NEED_SIGN=()
for f in "${CANDIDATES[@]}"; do
  if is_macho "$f"; then
    NEED_SIGN+=("$f")
  fi
done

if ((${#NEED_SIGN[@]} > 0)); then
  info "Found ${#NEED_SIGN[@]} Mach-O files to sign."
  # 多轮覆盖依赖顺序
  for i in 1 2; do
    for f in "${NEED_SIGN[@]}"; do
      sign_one "$f" || err "签名失败: $f"
    done
  done
fi

### 2) 深度重签主 .app
info "Deep re-sign the app bundle"
codesign --force --deep --options runtime --timestamp --sign "$DEV_ID_APP" "$APP_ABS"

### 3) 验证签名完整性
info "Verify codesign"
codesign --verify --deep --strict --verbose=2 "$APP_ABS"

### 4) 压缩为 zip（供 notarytool 提交）
info "Zip .app for notarization"
/usr/bin/xcrun ditto -c -k --keepParent "$APP_ABS" "$ZIP_PATH"

### 5) 提交公证（针对 .app.zip），并等待
info "Submit app for notarization (this may take a while)..."
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$NOTARY_PROFILE" --wait | tee "$NOTARY_LOG_APP"
info "✅ App notarization accepted"

### 6) staple 到 .app
info "Staple notarization ticket to .app"
xcrun stapler staple "$APP_ABS"

### 7) 生成 DMG（装入已 stapled 的 .app）
info "Create DMG from stapled .app"
STAGE_DIR="$(mktemp -d -t ${APP_NAME}-stage)"
cp -R "$APP_ABS" "$STAGE_DIR/"
ln -s /Applications "$STAGE_DIR/Applications" || true

RW_DMG="$(mktemp -u -t ${APP_NAME}-rw).dmg"
hdiutil create -srcfolder "$STAGE_DIR" -volname "$VOL_NAME" -fs HFS+ -format UDRW -ov "$RW_DMG" >/dev/null
hdiutil convert "$RW_DMG" -format UDZO -o "$DMG_PATH" -ov >/dev/null
rm -f "$RW_DMG"
rm -rf "$STAGE_DIR"

### 8) （可选）给 DMG 签名
if [[ "$SIGN_DMG" == "1" ]]; then
  info "Codesign DMG"
  codesign --force --sign "$DEV_ID_APP" --timestamp "$DMG_PATH"
fi

### 9) （可选）对 DMG 也公证 + staple
if [[ "$NOTARIZE_DMG" == "1" ]]; then
  NOTARY_LOG_DMG="${OUT_DIR}/${APP_NAME}.dmg.notary.log"
  info "Notarize DMG (optional, may take a while)..."
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait | tee "$NOTARY_LOG_DMG"
  info "Staple DMG"
  xcrun stapler staple "$DMG_PATH"
fi

### 10) Gatekeeper 自检
info "Gatekeeper check (.app)"
spctl -a -vv "$APP_ABS" || true

info "Gatekeeper check (DMG)"
spctl -a -vv "$DMG_PATH" || true

echo
echo "✅ 完成：已对 .app 公证并生成 DMG"
echo "   .app: $APP_ABS"
echo "   DMG : $DMG_PATH"
echo "📝 App Notary log: $NOTARY_LOG_APP"
if [[ "${NOTARIZE_DMG:-0}" == "1" ]]; then
  echo "📝 DMG Notary log: $NOTARY_LOG_DMG"
fi
