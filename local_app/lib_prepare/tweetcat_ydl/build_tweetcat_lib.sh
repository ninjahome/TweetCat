#!/bin/bash
set -euo pipefail

PYTHON="/usr/local/bin/python3.13"   # 官方 universal2 Python
APP_NAME="tweetcat_ydl_server"
DIST_DIR="dist"
ENTRY="main.py"
DEST="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/../../TweetCatAppMac/TweetCatApp/Resources"

DO_CLEAN="no"
JOBS=""   # 默认空，Nuitka 会自己用满 CPU

# 参数解析
while [[ $# -gt 0 ]]; do
  case "$1" in
    clean) DO_CLEAN="yes" ;;
    -j) shift; JOBS="--jobs=$1" ;;
    *) echo "⚠️ 未知参数: $1" ;;
  esac
  shift || true
done

err(){ echo "❌ $*" >&2; exit 1; }
info(){ echo "==> $*"; }

[[ -x "$PYTHON" ]] || err "未找到 $PYTHON，请确认安装了官方 universal2 Python"

info "使用 Python: $PYTHON"
"$PYTHON" --version

# 关键：把包的父目录加入 PYTHONPATH（当前在 tweetcat_ydl/ 内）
export PYTHONPATH="$(cd ..; pwd):${PYTHONPATH:-}"
info "已设置 PYTHONPATH=$PYTHONPATH"


# 当前架构
ARCH=$(uname -m)
OUT_NAME="${APP_NAME}_${ARCH}"
OUT_FILE="${DIST_DIR}/${OUT_NAME}"
FINAL="${DIST_DIR}/${APP_NAME}"


# 强制禁用 yt_dlp 懒加载抽取器
export YTDLP_NO_LAZY_EXTRACTORS=1
info "已设置 YTDLP_NO_LAZY_EXTRACTORS=1"

if [[ "$DO_CLEAN" == "yes" ]]; then
  info "清理旧的构建目录..."
  rm -rf build __pycache__
  # 确定另一架构
    if [[ "$ARCH" == "x86_64" ]]; then
      OTHER_ARCH="arm64"
    else
      OTHER_ARCH="x86_64"
    fi
    OTHER_FILE="${DIST_DIR}/${APP_NAME}_${OTHER_ARCH}"

    # 删除 dist 下所有内容，但保留另一架构的二进制
    shopt -s nullglob
    for f in "${DIST_DIR}"/*; do
      if [[ "$f" == "$OTHER_FILE" ]]; then
        info "保留另一架构产物: $f"
      else
        rm -rf "$f"
        info "已删除: $f"
      fi
    done
    shopt -u nullglob
fi

mkdir -p "$DIST_DIR"

# 安装依赖（清华镜像）
PIP_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
info "检查并安装必要依赖 (镜像: $PIP_INDEX_URL)..."
"$PYTHON" -m pip install --upgrade pip setuptools wheel -i "$PIP_INDEX_URL"
"$PYTHON" -m pip install --upgrade \
  nuitka ordered-set zstandard certifi \
  mutagen brotli pycryptodomex websockets \
  -i "$PIP_INDEX_URL"

# certifi 数据目录
CERTIFI_DIR=$("$PYTHON" -c "import certifi, os; print(os.path.dirname(certifi.__file__))")
[[ -d "$CERTIFI_DIR" ]] || err "未找到 certifi 目录"
info "发现 certifi 目录: $CERTIFI_DIR"

info "构建当前架构: $ARCH (jobs: ${JOBS:-auto})"

COMMON_FLAGS=(
  --onefile
  ${JOBS}
  --output-dir="$DIST_DIR"
  --output-filename="${OUT_NAME}"
  --include-package=yt_dlp
  --include-package=yt_dlp.postprocessor
  --include-package=yt_dlp.networking
  --include-package=tweetcat_ydl
  --include-package=yt_dlp.extractor.common
  --include-package=yt_dlp.extractor.youtube
  --include-data-dir="${CERTIFI_DIR}=certifi"
  --nofollow-import-to=yt_dlp.extractor.lazy_extractors
  --verbose
  --show-modules
)

"$PYTHON" -m nuitka \
  "${COMMON_FLAGS[@]}" \
  "$ENTRY"

[[ -f "$OUT_FILE" ]] || err "构建失败: $OUT_FILE"
info "已生成: $OUT_FILE"
file "$OUT_FILE"

# 合并 Universal（如另一架构已存在）
if [[ "$ARCH" == "x86_64" ]]; then
  OTHER_ARCH="arm64"
else
  OTHER_ARCH="x86_64"
fi
OTHER_FILE="${DIST_DIR}/${APP_NAME}_${OTHER_ARCH}"

if [[ -f "$OTHER_FILE" ]]; then
  info "发现 ${OTHER_ARCH} 版本，使用 lipo 合并为 Universal Binary..."
  lipo -create -output "$FINAL" "$OUT_FILE" "$OTHER_FILE"
  info "合并完成: $FINAL"
else
  info "未发现 ${OTHER_ARCH} 版本，当前架构产物作为最终结果"
  cp "$OUT_FILE" "$FINAL"
fi

file "$FINAL"

# 提示是否为 Universal Binary
if file "$FINAL" | grep -q "universal"; then
  echo "🍎 最终产物是 Universal Binary ✅"
else
  echo "⚠️ 最终产物不是 Universal Binary（当前架构: $ARCH）"
fi

# 部署到 Xcode 资源目录
mkdir -p "$DEST"
cp -f "$FINAL" "$DEST/$APP_NAME"

echo "✅ 已部署到: $DEST/$APP_NAME"
