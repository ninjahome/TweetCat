#!/bin/bash
set -euo pipefail

# ============ 配置 ============
APP_NAME="${APP_NAME:-tweetcat_ydl_server}"
ENTRY="${ENTRY:-main.py}"                  # 你的入口脚本
DIST_DIR="${DIST_DIR:-dist}"
BUILD_DIR="${BUILD_DIR:-.pyox_build}"      # 中间产物目录（gitignore）
PY_VERSION="${PY_VERSION:-3.13}"           # 嵌入的 Python 版本
MIN_MACOS="${MACOSX_DEPLOYMENT_TARGET:-11.0}"

# Xcode 资源目录（和你原脚本一致，可按需修改）
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEST="${DEST:-$DIR/../../TweetCatAppMac/TweetCatApp/Resources}"

# ============ 检查依赖 ============
have() { command -v "$1" >/dev/null 2>&1; }
err(){ echo "ERROR: $*" >&2; exit 1; }
info(){ echo "==> $*"; }

have xcode-select || err "需要 Xcode Command Line Tools"
xcode-select -p >/dev/null || err "请先安装 Xcode CLT: xcode-select --install"

have rustup || err "需要 Rust 工具链，请安装 rustup/cargo"
have lipo   || err "缺少 lipo（Xcode 自带）"
have file   || err "缺少 file 命令"

# PyOxidizer 本体（建议用 cargo 安装，稳定）
if ! have pyoxidizer; then
  info "安装 PyOxidizer ..."
  cargo install pyoxidizer
fi

# 安装交叉编译 target
info "安装 Rust macOS targets（如已安装会跳过）"
rustup target add aarch64-apple-darwin || true
rustup target add x86_64-apple-darwin  || true

# ============ 准备工程骨架 ============
info "准备构建目录：$BUILD_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$DIST_DIR"

# 1) 拷贝你的入口脚本
cp -f "$ENTRY" "$BUILD_DIR/__entry__.py"

# 2) 生成一个最小 __main__.py，通过 runpy 执行你的入口模块
cat > "$BUILD_DIR/__main__.py" <<'PY'
import runpy
# 运行同目录下的 __entry__.py，作为应用入口
runpy.run_path("__entry__.py", run_name="__main__")
PY

# 3) 生成 PyOxidizer 配置（.pyoxidizer.bzl）
cat > "$BUILD_DIR/.pyoxidizer.bzl" <<PYB
def make_exe():
    # 选择内置 Python 版本
    dist = default_python_distribution(flavor = "standalone_dynamic", python_major = ${PY_VERSION.split('.')[0]}, python_minor = ${PY_VERSION.split('.')[1]})

    # 打包策略（不做字节码优化，便于调试；要更小可以调高）
    policy = dist.make_python_packaging_policy()
    policy.bytecode_opt_level = 0
    policy.include_test = False
    policy.include_sources = True
    policy.include_distribution_resources = False

    # 解释器配置
    cfg = dist.make_python_interpreter_config()
    cfg.run_command = None
    # 我们会设置 "运行模块" 到 __main__，由它去 run __entry__.py

    exe = dist.to_python_executable(
        name = "${APP_NAME}",
        packaging_policy = policy,
        config = cfg,
    )

    # 通过 pip 从 PyPI 拉纯 Python 依赖（yt-dlp/certifi 都是纯 Python，很友好）
    # 如需锁定版本，写成 "yt-dlp==YYYY.MM.DD"
    resources = dist.pip_install([
        "yt-dlp",
        "certifi",
    ])

    # 把第三方依赖加入可执行文件的 Python 资源
    exe.add_python_resources(resources)

    # 把我们刚才生成的 __main__.py 和 __entry__.py 加进去
    exe.add_python_resource(
        dist.make_python_resource_from_source(
            module_name = "__main__",
            source_file = "__main__.py",
        )
    )
    exe.add_python_resource(
        dist.make_python_resource_from_source(
            module_name = "__entry__",
            source_file = "__entry__.py",
        )
    )

    # 将入口设为 __main__ 模块
    exe.set_run_module("__main__")

    # 如果你需要把外部二进制（如 ffmpeg）一起塞进可执行文件外侧目录：
    # 可以考虑用 bundle_resources_to_directory() 额外生成旁挂资源，这里先不做。

    return exe

def make_dist():
    # 产出一个包含单一可执行文件的分发产物
    exe = make_exe()
    return exe.to_distribution()
PYB

# 4) 环境变量
export MACOSX_DEPLOYMENT_TARGET="${MIN_MACOS}"

# ============ 编译两个架构 ============
pushd "$BUILD_DIR" >/dev/null

info "用 PyOxidizer 编译 arm64 ..."
pyoxidizer build \
  --release \
  --target-triple aarch64-apple-darwin

ARM_BIN="$(find build -type f -path "*/aarch64-apple-darwin/*/${APP_NAME}" -print -quit)"
[[ -f "$ARM_BIN" ]] || err "未找到 arm64 可执行文件"

info "用 PyOxidizer 编译 x86_64 ..."
pyoxidizer build \
  --release \
  --target-triple x86_64-apple-darwin

X64_BIN="$(find build -type f -path "*/x86_64-apple-darwin/*/${APP_NAME}" -print -quit)"
[[ -f "$X64_BIN" ]] || err "未找到 x86_64 可执行文件"

popd >/dev/null

# ============ lipo 合并为 universal2 ============
UNIV_BIN="$DIST_DIR/$APP_NAME"
info "合并为 universal2: $UNIV_BIN"
lipo -create "$ARM_BIN" "$X64_BIN" -output "$UNIV_BIN"

ARCH_INFO=$(file "$UNIV_BIN")
echo "$ARCH_INFO"
echo "$ARCH_INFO" | grep -q "arm64"   || err "合并失败：缺少 arm64"
echo "$ARCH_INFO" | grep -q "x86_64"  || err "合并失败：缺少 x86_64"
info "✅ Universal Binary (arm64 + x86_64) 完成"

# ============ 运行自检（可选） ============
info "执行 --version 自检（若你的 main.py 支持该参数会更好）"
if "$UNIV_BIN" --version >/dev/null 2>&1; then
  info "可执行文件能正常启动（--version）"
else
  info "可执行文件已生成（未检测到 --version 输出，属于正常情况）"
fi

# ============ 部署到 Xcode 资源目录 ============
mkdir -p "$DEST"
cp -f "$UNIV_BIN" "$DEST/$APP_NAME"
info "✅ 已部署到: $DEST/$APP_NAME"

echo
echo "完成："
echo "  可执行文件: $UNIV_BIN"
echo "  目标目录  : $DEST/$APP_NAME"
