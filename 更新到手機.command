#!/bin/bash
# 從 GitHub main 建立隔離的暫存工作樹；失敗時不會改動手機上已安裝的版本。
set -Eeuo pipefail

REPO="$(cd "$(dirname "$0")" && pwd -P)"
BRANCH=main
LOG="${ABAI_UPDATE_LOG:-$HOME/Desktop/ABAI更新紀錄.txt}"
TEAM="${ABAI_TEAM:-}"
PHONE="${ABAI_PHONE:-00008110-000119E23C82801E}"
TEMP=''
WORK=''
STAGE='初始化'

mkdir -p "$(dirname "$LOG")"
exec > >(tee "$LOG") 2>&1

cleanup() {
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    git -C "$REPO" worktree remove --force "$WORK" >/dev/null 2>&1 || true
  fi
  if [ -n "$TEMP" ]; then
    case "$TEMP" in /tmp/abai-phone.*) rm -rf -- "$TEMP" ;; esac
  fi
}
on_error() {
  local code=$?
  trap - ERR
  echo
  echo "✗ $STAGE 失敗（代碼 $code）。手機上的舊版沒有被替換。"
  if [ -n "$TEMP" ] && [ -f "$TEMP/xcodebuild.log" ]; then
    echo '── Xcode 錯誤 ──'
    grep -E 'error:|BUILD FAILED|No profiles for|No Account for Team' "$TEMP/xcodebuild.log" | head -35 || true
    echo '── 最後訊息 ──'
    tail -20 "$TEMP/xcodebuild.log"
  fi
  echo "完整紀錄：$LOG"
  if [ -t 0 ] && [ "${ABAI_CI:-0}" != 1 ]; then read -r -p '按 Enter 關閉…' _; fi
  exit "$code"
}
trap cleanup EXIT
trap on_error ERR

echo "開始：$(date '+%Y-%m-%d %H:%M:%S')"
STAGE='環境檢查'
[ -d "$REPO/.git" ]
git -C "$REPO" remote get-url origin | grep -q 'jijiwo537-crypto/abai-newphoto'
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.abai-node/bin:$PATH"
command -v node >/dev/null
command -v npm >/dev/null
command -v xcrun >/dev/null
if ! xcodebuild -version >/dev/null 2>&1; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi
xcodebuild -version >/dev/null
if [ "${ABAI_CI:-0}" != 1 ]; then
  [ -n "$TEAM" ] || TEAM="$(cat "$HOME/.abai-team-id" 2>/dev/null || true)"
  [ -n "$TEAM" ] || { echo '找不到開發團隊 ID；請在桌面啟動「更新ABAI到手機.command」。'; false; }
  xcrun devicectl list devices | grep -q "$PHONE"
fi

STAGE='下載 GitHub 最新版本'
git -C "$REPO" fetch --quiet origin "$BRANCH"
SHA="$(git -C "$REPO" rev-parse "origin/$BRANCH")"
TEMP="$(mktemp -d /tmp/abai-phone.XXXXXX)"
WORK="$TEMP/source"
git -C "$REPO" worktree add --detach "$WORK" "$SHA"
ln -s "$REPO/node_modules" "$WORK/node_modules"
echo "版本：${SHA:0:12}（GitHub main）"
cd "$WORK"

STAGE='檢查套件'
npm ls --depth=0 >/dev/null 2>&1 || { echo '本機 node_modules 與最新專案不符；請先更新套件。'; false; }
STAGE='網頁建置'
npm run build
STAGE='iOS 同步'
npx cap sync ios

STAGE='Xcode 編譯'
if [ "${ABAI_CI:-0}" = 1 ]; then
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
    -destination 'generic/platform=iOS' -derivedDataPath "$TEMP/derived" \
    CODE_SIGNING_ALLOWED=NO build > "$TEMP/xcodebuild.log" 2>&1
else
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
    -destination "id=$PHONE" -derivedDataPath "$TEMP/derived" \
    -allowProvisioningUpdates "DEVELOPMENT_TEAM=$TEAM" build > "$TEMP/xcodebuild.log" 2>&1
fi
grep -E '\*\* BUILD SUCCEEDED \*\*' "$TEMP/xcodebuild.log"

if [ "${ABAI_CI:-0}" = 1 ]; then
  echo "✓ 最新版 ${SHA:0:12} 的 iOS 編譯通過"
  exit 0
fi

STAGE='安裝到 iPhone'
APP="$TEMP/derived/Build/Products/Debug-iphoneos/App.app"
[ -d "$APP" ]
xcrun devicectl device install app --device "$PHONE" "$APP"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")
xcrun devicectl device process launch --device "$PHONE" "$BUNDLE_ID" || echo '已安裝；手機鎖定時請解鎖後自行開啟。'
echo "✓ 完成！iPhone 已更新到 GitHub main ${SHA:0:12}"
echo "完整紀錄：$LOG"
if [ -t 0 ]; then read -r -p '按 Enter 關閉…' _; fi
