#!/bin/bash
set -euo pipefail

PYTHON="/usr/local/bin/python3.13"   # 官方 universal2 Python
APP_NAME="tweetcat_ydl_server"
DIST_DIR="dist"
ENTRY="main.py"
PYINSTALLER_SRC="pyinstaller"
PATCH_FILE="patch-extract-dir.diff"

err(){ echo "❌ $*" >&2; exit 1; }
info(){ echo "==> $*"; }

[[ -x "$PYTHON" ]] || err "未找到 $PYTHON，请确认安装了官方 universal2 Python"

info "使用 Python: $PYTHON"
"$PYTHON" --version

# 参数处理
CLEAN=0
for arg in "$@"; do
    case "$arg" in
        --clean) CLEAN=1 ;;
    esac
done

# 可选：清理
if [[ $CLEAN -eq 1 ]]; then
    info "清理旧的构建目录..."
    rm -rf build __pycache__
fi

mkdir -p "$DIST_DIR"
# 1. 检查 pyinstaller 源码是否存在
FIRST_CLONE=0
if [[ ! -d "$PYINSTALLER_SRC" ]]; then
    info "未找到 $PYINSTALLER_SRC,开始从 GitHub 下载..."
    git clone https://github.com/pyinstaller/pyinstaller.git "$PYINSTALLER_SRC"
    pushd "$PYINSTALLER_SRC" >/dev/null
    git checkout v6.16.0   # 🔑 固定版本，避免 upstream 改动
    popd >/dev/null
    FIRST_CLONE=1
fi

# 2. 只有第一次 clone 时才执行 patch
if [[ $FIRST_CLONE -eq 1 ]]; then
    if [[ -f "$PATCH_FILE" ]]; then
        pushd "$PYINSTALLER_SRC/bootloader" >/dev/null
        info "应用补丁 $PATCH_FILE..."
        git reset --hard        # 🔑 清理工作区
        git clean -fd           # 🔑 删除多余文件
        git apply "../../$PATCH_FILE" || err "应用补丁失败"
        git add -A
        git commit -m "Applied patch-extract-dir" || true   # 🔑 保存补丁，避免丢失
        popd >/dev/null
    else
        err "未找到补丁文件 $PATCH_FILE"
    fi
else
    info "已存在 $PYINSTALLER_SRC, 跳过补丁应用"
fi

# 3. 编译 bootloader
pushd "$PYINSTALLER_SRC/bootloader" >/dev/null
info "编译定制 bootloader..."
python3 ./waf distclean all || err "bootloader 编译失败"
popd >/dev/null

# 如果 pip 安装 hatchling 失败（SSL 错误或下载不到），可以先手动执行：
#   python -m pip install hatchling -i https://pypi.tuna.tsinghua.edu.cn/simple

# 4. 安装本地 pyinstaller（优先使用我们刚编译的 bootloader）
info "安装本地 pyinstaller..."
pushd "$PYINSTALLER_SRC" >/dev/null
"$PYTHON" -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple build hatchling
"$PYTHON" -m build --wheel --no-isolation
WHEEL_FILE=$(ls dist/pyinstaller-*.whl | head -n 1 || true)
[[ -f "$WHEEL_FILE" ]] || err "未找到生成的 PyInstaller wheel"
"$PYTHON" -m pip install "$WHEEL_FILE"
popd >/dev/null
"$PYTHON" -m pip install --upgrade yt-dlp certifi


# 5. 构建 onefile（根据当前机器架构决定）
HOST_ARCH=$(uname -m)
ARCH_LIST=()

if [[ "$HOST_ARCH" == "x86_64" ]]; then
    ARCH_LIST=("x86_64")   # Intel Mac 只编译 x86_64
elif [[ "$HOST_ARCH" == "arm64" ]]; then
    ARCH_LIST=("arm64")    # Apple Silicon Mac 只编译 arm64
else
    err "未知架构: $HOST_ARCH"
fi

for ARCH in "${ARCH_LIST[@]}"; do
    OUT_ARCH_FILE="${DIST_DIR}/${APP_NAME}_${ARCH}"
    info "构建 ${ARCH} 版本..."

    arch -${ARCH} "$PYTHON" -m PyInstaller \
      --onefile \
      --name "${APP_NAME}_${ARCH}" \
      --clean \
      --noconfirm \
      --hidden-import=yt_dlp \
      --collect-submodules yt_dlp \
      --collect-data yt_dlp \
      --collect-data certifi \
      "${ENTRY}"

    [[ -f "$OUT_ARCH_FILE" ]] || err "构建失败: $OUT_ARCH_FILE"
    info "已生成: $OUT_ARCH_FILE"
    file "$OUT_ARCH_FILE"
done

# 6. lipo 合并
FINAL="${DIST_DIR}/${APP_NAME}"
X86_FILE="${DIST_DIR}/${APP_NAME}_x86_64"
ARM_FILE="${DIST_DIR}/${APP_NAME}_arm64"

if [[ -f "$X86_FILE" && -f "$ARM_FILE" ]]; then
    info "使用 lipo 合并为 Universal Binary..."
    lipo -create -output "$FINAL" "$X86_FILE" "$ARM_FILE"
    info "合并完成: $FINAL"
elif [[ -f "$X86_FILE" ]]; then
    info "仅找到 x86_64 构建，复制为最终结果..."
    cp "$X86_FILE" "$FINAL"
elif [[ -f "$ARM_FILE" ]]; then
    info "仅找到 arm64 构建，复制为最终结果..."
    cp "$ARM_FILE" "$FINAL"
else
    err "未找到任何可用的构建产物"
fi

file "$FINAL"

# 7. 验证
info "验证可执行文件..."
if "$FINAL" --version >/dev/null 2>&1; then
    echo "✅ 验证成功：$FINAL 可以运行，yt_dlp 已打包"
else
    err "验证失败：运行 $FINAL 出错"
fi

# 8. 部署到 App 资源目录
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEST="$DIR/../../TweetCatAppMac/TweetCatApp/Resources"
mkdir -p "$DEST"
cp -f "$FINAL" "$DEST/$APP_NAME"

echo "✅ 已部署到: $DEST/$APP_NAME"
