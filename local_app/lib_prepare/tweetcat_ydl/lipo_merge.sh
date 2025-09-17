#!/bin/bash
set -euo pipefail

# 固定路径
X86_FILE="dist/tweetcat_ydl_server_x86_64"
ARM_FILE="dist/tweetcat_ydl_server_arm64"
DIST_OUT="dist/tweetcat_ydl_server"
DEST="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/../../TweetCatAppMac/TweetCatApp/Resources"
DEST_OUT="$DEST/tweetcat_ydl_server"

# 确保目标目录存在
mkdir -p "$DEST"

echo "==> 合并 $X86_FILE 和 $ARM_FILE 到 $DIST_OUT"
lipo -create -output "$DIST_OUT" "$X86_FILE" "$ARM_FILE"

echo "==> 合并完成 (dist):"
file "$DIST_OUT"

echo "==> 复制到 $DEST_OUT"
cp -f "$DIST_OUT" "$DEST_OUT"

echo "✅ 完成: $DEST_OUT"
