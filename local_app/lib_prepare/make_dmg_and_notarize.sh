#!/bin/bash
set -euo pipefail

# === 入参/配置 ===
APP_PATH="${1:-}"   # 必填：.app 的路径
VOL_NAME="${VOL_NAME:-TweetCatApp}"  # DMG 卷名，可用环境变量覆盖
OUT_DIR="${OUT_DIR:-$(pwd)}"         # 产物输出目录
IDENTITY="${IDENTITY:-Developer ID Application: Yushian (Beijing) Technology Co., Ltd.}"
PROFILE="${PROFILE:-notary-profile}" # notarytool keychain profile；你已经保存过
USE_PROFILE="${USE_PROFILE:-1}"      # 1=使用 profile；0=使用账号参数
APPLE_ID="${APPLE_ID:-}"             # 当 USE_PROFILE=0 时使用
TEAM_ID="${TEAM_ID:-2XYK8RBB6M}"
APP_PWD="${APP_PWD:-}"               # Apple ID 的 App 专用密码（App-Specific Password）

err(){ echo "ERROR: $*" >&2; exit 1; }
info(){ echo "==> $*"; }

[[ -n "$APP_PATH" ]] || err "用法: ./make_dmg_and_notarize.sh /path/to/YourApp.app"
[[ -d "$APP_PATH" ]] || err "找不到 .app: $APP_PATH"

APP_ABS="$(cd "$(dirname "$APP_PATH")" && pwd)/$(basename "$APP_PATH")"
APP_NAME="$(basename "$APP_ABS" .app)"
STAGE_DIR="$(mktemp -d -t ${APP_NAME}-stage)"
DMG_PATH="${OUT_DIR}/${APP_NAME}.dmg"

info "App: $APP_ABS"
info "Stage: $STAGE_DIR"
info "Identity: $IDENTITY"
info "DMG: $DMG_PATH"

# 1) 准备 staging 内容（App + Applications 快捷方式）
info "Prepare staging folder"
cp -R "$APP_ABS" "$STAGE_DIR/"
ln -s /Applications "$STAGE_DIR/Applications" || true

# 2) 生成压缩 DMG（读写临时 → 压缩只读）
RW_DMG="$(mktemp -u -t ${APP_NAME}-rw).dmg"
info "Create RW dmg: $RW_DMG"
hdiutil create -srcfolder "$STAGE_DIR" -volname "$VOL_NAME" -fs HFS+ -format UDRW -ov "$RW_DMG"

info "Convert to compressed (UDZO) dmg: $DMG_PATH"
hdiutil convert "$RW_DMG" -format UDZO -o "$DMG_PATH" -ov
rm -f "$RW_DMG"
rm -rf "$STAGE_DIR"

# 3) 对 DMG 进行代码签名（Developer ID Application）
#    注：签名 DMG 是推荐做法，便于后续公证与 Gatekeeper 校验
info "Codesign DMG"
codesign --force --sign "$IDENTITY" --timestamp "$DMG_PATH"
# （不加 --options runtime；对 DMG 非必需）

# 4) 提交公证（notarytool），并等待结果
LOGFILE="${DMG_PATH%.dmg}.notary.log"
info "Notarize DMG (this may take a while)..."
set +e
if [[ "$USE_PROFILE" == "1" ]]; then
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait | tee "$LOGFILE"
  RC=${PIPESTATUS[0]}
else
  [[ -n "$APPLE_ID" && -n "$TEAM_ID" && -n "$APP_PWD" ]] || err "当 USE_PROFILE=0 时需设置 APPLE_ID/TEAM_ID/APP_PWD"
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APP_PWD" \
    --wait | tee "$LOGFILE"
  RC=${PIPESTATUS[0]}
fi
set -e
[[ $RC -eq 0 ]] || err "❌ Notarization failed. 查看日志: $LOGFILE"

info "✅ Notarization Accepted"

# 5) 钉订（staple）票据，并用 Gatekeeper 自检
info "Staple ticket to DMG"
xcrun stapler staple "$DMG_PATH"

info "Gatekeeper check"
spctl -a -vv "$DMG_PATH" || true

echo "✅ 完成。可分发 DMG：$DMG_PATH"
echo "📝 Notary log: $LOGFILE"
