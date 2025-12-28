#!/bin/bash

# 版本号递增脚本
# 每次运行将版本号的最后一位（构建版本）增加1

# 定义文件路径
PACKAGE_JSON="package.json"
MANIFEST_JSON="dist/manifest.json"
SERVER_JSON="tweetcat-x402-worker/tweetcattips/package.json"

# 检查文件是否存在
if [ ! -f "$PACKAGE_JSON" ]; then
    echo "错误: $PACKAGE_JSON 文件不存在"
    exit 1
fi

if [ ! -f "$MANIFEST_JSON" ]; then
    echo "错误: $MANIFEST_JSON 文件不存在"
    exit 1
fi

if [ ! -f "$SERVER_JSON" ]; then
    echo "错误: $SERVER_JSON 文件不存在"
    exit 1
fi

# 从 package.json 中提取当前版本
CURRENT_VERSION=$(grep -o '"version": *"[^"]*"' "$PACKAGE_JSON" | head -1 | cut -d'"' -f4)

if [ -z "$CURRENT_VERSION" ]; then
    echo "错误: 无法从 $PACKAGE_JSON 中提取版本号"
    exit 1
fi

echo "当前版本: $CURRENT_VERSION"

# 分割版本号
IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION"

# 检查版本号格式是否正确
if [ ${#VERSION_PARTS[@]} -ne 3 ]; then
    echo "错误: 版本号格式不正确，应为 major.minor.patch"
    exit 1
fi

# 增加构建版本号（最后一位）
MAJOR=${VERSION_PARTS[0]}
MINOR=${VERSION_PARTS[1]}
PATCH=$((VERSION_PARTS[2] + 1))

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "新版本: $NEW_VERSION"

# 更新 package.json 中的版本号
if command -v jq >/dev/null 2>&1; then
    # 如果系统安装了 jq，使用 jq 来更新（更安全的方法）
    jq --arg new_version "$NEW_VERSION" '.version = $new_version' "$PACKAGE_JSON" > temp.json && mv temp.json "$PACKAGE_JSON"
    jq --arg new_version "$NEW_VERSION" '.version = $new_version' "$MANIFEST_JSON" > temp.json && mv temp.json "$MANIFEST_JSON"
    jq --arg new_version "$NEW_VERSION" '.version = $new_version' "$SERVER_JSON" > temp.json && mv temp.json "$SERVER_JSON"
else
    # 如果没有 jq，使用 sed 来更新
    sed -i.bak -E "s/\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"/\"version\": \"$NEW_VERSION\"/g" "$PACKAGE_JSON"
    sed -i.bak -E "s/\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"/\"version\": \"$NEW_VERSION\"/g" "$MANIFEST_JSON"
    sed -i.bak -E "s/\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"/\"version\": \"$NEW_VERSION\"/g" "$SERVER_JSON"

    # 清理备份文件
    rm -f "$PACKAGE_JSON.bak" "$MANIFEST_JSON.bak" "$SERVER_JSON.bak"
fi

# 验证更新
UPDATED_PACKAGE_VERSION=$(grep -o '"version": *"[^"]*"' "$PACKAGE_JSON" | head -1 | cut -d'"' -f4)
UPDATED_MANIFEST_VERSION=$(grep -o '"version": *"[^"]*"' "$MANIFEST_JSON" | head -1 | cut -d'"' -f4)
UPDATED_MANIFEST_VERSION=$(grep -o '"version": *"[^"]*"' "$SERVER_JSON" | head -1 | cut -d'"' -f4)

if [ "$UPDATED_PACKAGE_VERSION" = "$NEW_VERSION" ] && [ "$UPDATED_MANIFEST_VERSION" = "$NEW_VERSION" ]; then
    echo "✅ 版本号已成功更新为: $NEW_VERSION"
    echo "✅ $PACKAGE_JSON 版本: $UPDATED_PACKAGE_VERSION"
    echo "✅ $MANIFEST_JSON 版本: $UPDATED_MANIFEST_VERSION"
    echo "✅ $SERVER_JSON 版本: $UPDATED_MANIFEST_VERSION"
else
    echo "❌ 版本号更新失败"
    echo "package.json 版本: $UPDATED_PACKAGE_VERSION"
    echo "manifest.json 版本: $UPDATED_MANIFEST_VERSION"
    exit 1
fi