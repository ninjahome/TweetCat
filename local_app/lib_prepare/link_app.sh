#!/bin/bash
set -euo pipefail

DERIVED_DIR="$HOME/xcodedata/Derived Data"
TARGET_APP="${1:-}"                  # 可选：传入具体 .app 名字
TARGET_DIR="/Applications"

err(){ echo "❌ $*" >&2; exit 1; }
info(){ echo "==> $*"; }

[[ -d "$DERIVED_DIR" ]] || err "不存在目录: $DERIVED_DIR"

# 搜索函数：优先 Build/Products，排除 Index.noindex
find_apps() {
  find "$DERIVED_DIR" \
    \( -path "*/Index.noindex/*" -prune \) -o \
    \( -path "*/Build/Products/*/*.app" -type d -print0 \) 2>/dev/null \
  | xargs -0 ls -td 2>/dev/null || true
}

# 指定名字时也同样排除 Index.noindex
if [[ -n "$TARGET_APP" ]]; then
  info "在 $DERIVED_DIR 中查找 $TARGET_APP ..."
  APP_PATH="$(
    find "$DERIVED_DIR" \
      \( -path "*/Index.noindex/*" -prune \) -o \
      \( -path "*/Build/Products/*/$TARGET_APP" -type d -print0 \) 2>/dev/null \
    | xargs -0 ls -td | head -n1 || true
  )"
  [[ -n "$APP_PATH" ]] || err "未找到 $TARGET_APP in $DERIVED_DIR（试试不带参数自动探测）"
else
  info "未指定 .app 名称，自动探测最新构建产物 ..."
  APP_PATH="$(find_apps | head -n1 || true)"
  [[ -n "$APP_PATH" ]] || err "没有找到任何 .app。请先编译，或传入具体名字： ./link_app.sh 'YourApp.app'"
  TARGET_APP="$(basename "$APP_PATH")"
fi


info "找到构建产物: $APP_PATH"

TARGET="$TARGET_DIR/$TARGET_APP"
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  info "删除已有 $TARGET"
  rm -rf "$TARGET"
fi

info "创建软链接 $TARGET -> $APP_PATH"
ln -s "$APP_PATH" "$TARGET"

echo "✅ 完成：在 /Applications 中已链接 $TARGET_APP"
