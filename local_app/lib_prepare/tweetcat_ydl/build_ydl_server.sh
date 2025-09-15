#!/bin/bash
set -euo pipefail

### ---  ---
PYTHON="/usr/local/bin/python3.13"   # python.org  universal2 Python
APP_NAME="tweetcat_ydl_server"
ENTRY="main.py"                      #
DIST_DIR="dist"
PYI_TAG="v6.11.0"                    #
WORK_DIR=".pyi_universal2_boot"      #  gitignore
### ------------------------
err(){ echo " $*" >&2; exit 1; }
info(){ echo "==> $*"; }

# 0)
[[ -x "$PYTHON" ]] || err " $PYTHON python-3.13.x macOS universal2"
"$PYTHON" --version

#  Xcode  bootloader
if ! xcode-select -p >/dev/null 2>&1; then
    err " Xcode Command Line Toolsxcode-select --install"
fi

#  python  universal2 arm-only / x86_64-only
PY_FILE_OUT=$(file "$PYTHON")
echo "$PY_FILE_OUT"
echo "$PY_FILE_OUT" | grep -q "arm64" || err " $PYTHON  universal2 arm64"
echo "$PY_FILE_OUT" | grep -q "x86_64" || err " $PYTHON  universal2 x86_64"

# 1)
mkdir -p "$WORK_DIR"
if [[ ! -d "$WORK_DIR/pyinstaller" ]]; then
    info " PyInstaller $PYI_TAG..."
    git clone --depth=1 --branch "$PYI_TAG" https://github.com/pyinstaller/pyinstaller "$WORK_DIR/pyinstaller"
else
    info " $WORK_DIR/pyinstaller"
fi

# 2)  universal2 bootloader
info " PyInstaller bootloader (universal2)..."
pushd "$WORK_DIR/pyinstaller/bootloader" >/dev/null

#
"$PYTHON" ./waf distclean || true

#  universal2waf  x86_64 + arm64  fat
# export MACOSX_DEPLOYMENT_TARGET=11.0
"$PYTHON" ./waf all --universal2

popd >/dev/null

# 3)  bootloader  PyInstaller  Python
info " bootloader  PyInstaller..."
pushd "$WORK_DIR/pyinstaller" >/dev/null
"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install .
popd >/dev/null

# 4)
info "/yt-dlp, certifi ..."
"$PYTHON" -m pip install --upgrade yt-dlp certifi

# 5)    universal2
info " universal2 bootloader ..."
rm -rf build "__pycache__"
mkdir -p "$DIST_DIR"

"$PYTHON" -m PyInstaller \
    --onefile \
    --name "$APP_NAME" \
    --clean \
    --target-arch universal2 \
    --noconfirm \
    --hidden-import=yt_dlp \
    --collect-submodules yt_dlp \
    --collect-data yt_dlp \
    --collect-data certifi \
    "$ENTRY"

# 6)
[[ -f "dist/$APP_NAME" ]] || err " dist/$APP_NAME"
mv -f "dist/$APP_NAME" "$DIST_DIR/$APP_NAME"

info "$DIST_DIR/$APP_NAME"
ARCH_INFO=$(file "$DIST_DIR/$APP_NAME")
echo "$ARCH_INFO"

if echo "$ARCH_INFO" | grep -q "x86_64" && echo "$ARCH_INFO" | grep -q "arm64"; then
    echo "  Universal Binary (x86_64 + arm64)"
else
    err "  Universal Binary bootloader "
fi

# 7)  --version
info "..."
if "$DIST_DIR/$APP_NAME" --version >/dev/null 2>&1; then
    echo "  yt_dlp/certifi"
else
    err " $DIST_DIR/$APP_NAME "
fi

# 8) 部署到 App 资源目录
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEST="$DIR/../../TweetCatAppMac/TweetCatApp/Resources"
mkdir -p "$DEST"
cp -f "$DIST_DIR/$APP_NAME" "$DEST/$APP_NAME"

echo " ✅ 已部署到: $DEST/$APP_NAME"
