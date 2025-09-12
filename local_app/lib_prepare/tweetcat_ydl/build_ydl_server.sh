#!/bin/bash
set -e

APP_NAME="tweetcat_ydl_server"
DIST_DIR="dist"
ENTRY="main.py"                # 新入口

# 可选：清理
if [ "$1" = "--clean" ]; then
    echo "==> 清理旧的构建目录..."
    rm -rf build __pycache__ "${DIST_DIR:?}"/*
fi

# 当前架构
ARCH=$(python3 -c "import platform; print(platform.machine())")
echo "==> 当前 Python 架构: $ARCH"

# 生成带架构后缀的目标文件名
OUT_BASENAME="${APP_NAME}_${ARCH}"
OUTFILE="${DIST_DIR}/${OUT_BASENAME}"

# 确保 dist 目录存在
mkdir -p "$DIST_DIR"

# 构建（单文件）
echo "==> 构建 ${ARCH} 版本..."
python3 -m PyInstaller \
  --onefile \
  --name "${OUT_BASENAME}" \
  --clean \
  --noconfirm \
  --collect-submodules yt_dlp \
  --collect-data yt_dlp \
  "${ENTRY}"

# PyInstaller 在 dist 下会生成 ${OUT_BASENAME} 可执行文件
if [ ! -f "${OUTFILE}" ]; then
  # 在某些 PyInstaller 版本中，输出会是 dist/${OUT_BASENAME}（无后缀）
  # 统一重命名为我们预期的 OUTFILE
  if [ -f "dist/${OUT_BASENAME}" ]; then
    mv "dist/${OUT_BASENAME}" "${OUTFILE}"
  else
    echo "!! 未找到构建产物 dist/${OUT_BASENAME}" >&2
    exit 1
  fi
fi

# 合并逻辑（若 dist 中已有另一架构的成品）
FINAL="${DIST_DIR}/${APP_NAME}"

OTHER_ARCH=""
if [ "$ARCH" = "x86_64" ]; then
    OTHER_ARCH="arm64"
elif [ "$ARCH" = "arm64" ]; then
    OTHER_ARCH="x86_64"
fi

OTHER_FILE="${DIST_DIR}/${APP_NAME}_${OTHER_ARCH}"

if [ -n "$OTHER_ARCH" ] && [ -f "$OTHER_FILE" ]; then
    echo "==> 发现 ${OTHER_ARCH} 版本，使用 lipo 合并为通用二进制..."
    lipo -create -output "$FINAL" "$OUTFILE" "$OTHER_FILE"
else
    echo "==> 未发现 ${OTHER_ARCH} 版本，直接使用 ${ARCH} 版本"
    cp "$OUTFILE" "$FINAL"
fi

echo "==> 完成: $FINAL"
file "$FINAL"

# 部署到 App 资源目录
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEST="$DIR/../../TweetCatAppMac/TweetCatApp/Resources"
mkdir -p "$DEST"
mv -f "$FINAL" "$DEST/$APP_NAME"

echo "==> 已部署到: $DEST/$APP_NAME"
