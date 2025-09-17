#!/bin/bash
set -euo pipefail

# 用法：
#   ./check_notary_status.sh <SubmissionID>
# 环境变量：
#   PROFILE   默认 notary-profile
#   INTERVAL  轮询间隔秒，默认 30

SUB="${1:-}"
PROFILE="${PROFILE:-notary-profile}"
INTERVAL="${INTERVAL:-30}"

[[ -n "$SUB" ]] || { echo "用法: $0 <SubmissionID>"; exit 1; }

echo "==> Submission ID: $SUB"
echo "==> Profile: $PROFILE"
echo "==> Polling every ${INTERVAL}s"

while true; do
  OUT="$(xcrun notarytool info "$SUB" --keychain-profile "$PROFILE" 2>&1 || true)"
  echo "$OUT"

  if echo "$OUT" | grep -q "status: Accepted"; then
    echo "✅ Accepted"
    break
  elif echo "$OUT" | grep -q "status: Invalid"; then
    echo "❌ Invalid"
    xcrun notarytool log "$SUB" --keychain-profile "$PROFILE" || true
    break
  else
    echo "⏳ In Progress... will re-check in ${INTERVAL}s"
    sleep "$INTERVAL"
  fi
done
