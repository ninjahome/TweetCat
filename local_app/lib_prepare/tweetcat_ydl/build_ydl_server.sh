#!/bin/bash
set -euo pipefail

PYTHON="/usr/local/bin/python3.13"   # 官方 universal2 Python

APP_NAME="tweetcat_ydl_server"
DIST_DIR="dist"
ENTRY="main.py"

err(){ echo "❌ $*" >&2; exit 1; }
info(){ echo "==> $*"; }

[[ -x "$PYTHON" ]] || err "未找到 $PYTHON，请确认安装了官方 universal2 Python"

info "使用 Python: $PYTHON"
"$PYTHON" --version

# 可选：清理
if [[ "${1:-}" == "--clean" ]]; then
    info "清理旧的构建目录..."
    rm -rf build __pycache__ "${DIST_DIR:?}"/*
fi

mkdir -p "$DIST_DIR"

# 安装依赖
info "检查并安装必要依赖..."
"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install --upgrade pyinstaller yt-dlp

# 当前架构
ARCH=$(uname -m)
info "当前机器架构: $ARCH"

# 输出文件
OUT_ARCH_FILE="${DIST_DIR}/${APP_NAME}_${ARCH}"
FINAL="${DIST_DIR}/${APP_NAME}"

# 构建当前架构
info "构建 ${ARCH} 版本..."
arch -${ARCH} "$PYTHON" -m PyInstaller \
  --onefile \
  --name "${APP_NAME}_${ARCH}" \
  --clean \
  --noconfirm \
  --hidden-import=yt_dlp \
  --collect-submodules yt_dlp \
  --collect-data yt_dlp \
  "${ENTRY}"

[[ -f "$OUT_ARCH_FILE" ]] || err "构建失败: $OUT_ARCH_FILE"
info "已生成: $OUT_ARCH_FILE"
file "$OUT_ARCH_FILE"

# 检查是否能合并
OTHER_ARCH="x86_64"
if [[ "$ARCH" == "x86_64" ]]; then
    OTHER_ARCH="arm64"
fi
OTHER_FILE="${DIST_DIR}/${APP_NAME}_${OTHER_ARCH}"

if [[ -f "$OTHER_FILE" ]]; then
    info "发现 ${OTHER_ARCH} 版本，使用 lipo 合并为 Universal Binary..."
    lipo -create -output "$FINAL" "$OUT_ARCH_FILE" "$OTHER_FILE"
    info "合并完成: $FINAL"
    file "$FINAL"
else
    info "未找到 ${OTHER_ARCH} 版本，暂时只保留当前架构产物: $OUT_ARCH_FILE"
    cp "$OUT_ARCH_FILE" "$FINAL"
fi

# ✅ 验证
info "验证可执行文件..."
if "$FINAL" --version >/dev/null 2>&1; then
    echo "✅ 验证成功：$FINAL 可以运行，yt_dlp 已打包"
else
    err "验证失败：运行 $FINAL 出错"
fi

# 部署到 App 资源目录
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEST="$DIR/../../TweetCatAppMac/TweetCatApp/Resources"
mkdir -p "$DEST"
cp -f "$FINAL" "$DEST/$APP_NAME"

echo "✅ 已部署到: $DEST/$APP_NAME"
