#!/bin/bash
set -e

APP_NAME="tweetcat_ydl_server"
DIST_DIR="dist"

# 检测是否需要 clean
if [ "$1" = "--clean" ]; then
    echo "==> 清理旧的构建目录..."
    rm -rf build __pycache__ "${DIST_DIR:?}"/*
fi

# 检测当前架构
ARCH=$(python3 -c "import platform; print(platform.machine())")

echo "==> 当前 Python 架构: $ARCH"

# 生成带架构后缀的目标文件
OUTFILE="${DIST_DIR}/${APP_NAME}_${ARCH}"

# 确保 dist 目录存在
mkdir -p "$DIST_DIR"

# 构建当前架构
echo "==> 构建 ${ARCH} 版本..."
python3 -m PyInstaller -F -n "${APP_NAME}_${ARCH}" tweetcat_ydl_server.py

# 合并逻辑
FINAL="${DIST_DIR}/${APP_NAME}"

OTHER_ARCH=""
if [ "$ARCH" = "x86_64" ]; then
    OTHER_ARCH="arm64"
elif [ "$ARCH" = "arm64" ]; then
    OTHER_ARCH="x86_64"
fi

OTHER_FILE="${DIST_DIR}/${APP_NAME}_${OTHER_ARCH}"

if [ -f "$OTHER_FILE" ]; then
    echo "==> 发现 ${OTHER_ARCH} 版本，使用 lipo 合并..."
    lipo -create -output "$FINAL" "$OUTFILE" "$OTHER_FILE"
else
    echo "==> 未发现 ${OTHER_ARCH} 版本，直接使用 ${ARCH} 版本"
    cp "$OUTFILE" "$FINAL"
fi

echo "==> 完成: $FINAL"
file "$FINAL"

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEST="$DIR/../TweetCatAppMac/TweetCatApp/Resources"
mv -f "$FINAL" "$DEST/$APP_NAME"