#!/bin/bash
set -e

# 当前目录
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 目标目录
DEST="$DIR/../TweetCatApp/TweetCatApp/Resources"

echo "合并 ffmpeg..."
lipo -create \
  "$DIR/ffmpeg-darwin-arm64" \
  "$DIR/ffmpeg-darwin-x64" \
  -output "$DIR/ffmpeg"

chmod +x "$DIR/ffmpeg"
lipo -info "$DIR/ffmpeg"

echo "合并 ffprobe..."
lipo -create \
  "$DIR/ffprobe-darwin-arm64" \
  "$DIR/ffprobe-darwin-x64" \
  -output "$DIR/ffprobe"

chmod +x "$DIR/ffprobe"
lipo -info "$DIR/ffprobe"

# 移动到 Xcode 工程的 Resources/Tools
echo "移动文件到 $DEST ..."
mkdir -p "$DEST"
mv -f "$DIR/ffmpeg" "$DEST/ffmpeg"
mv -f "$DIR/ffprobe" "$DEST/ffprobe"

# 验证执行情况
echo "验证 ffmpeg ..."
"$DEST/ffmpeg" -version | head -n 3

echo "验证 ffprobe ..."
"$DEST/ffprobe" -version | head -n 3

echo "✅ 已生成并移动通用二进制到:"
echo "   $DEST/ffmpeg"
echo "   $DEST/ffprobe"
echo "✅ 验证完成，以上输出显示版本信息即代表可用"