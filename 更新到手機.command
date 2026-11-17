#!/bin/bash
# 在 Mac 上「點兩下」就把最新修改裝到接著線（或同 Wi-Fi 已配對）的 iPhone 上。
# 步驟：抓最新程式碼 → 打包網頁並同步到 iOS（ios/prepare-device.sh）→ 編譯 → 安裝 → 打開 App。
# 第一次用之前，要先照 ios/prepare-device.sh 的說明在 Xcode 選好 Team、成功按 ▶ 裝過一次。
set -euo pipefail
cd "$(dirname "$0")"
BRANCH=claude/sleepy-mccarthy-2mabxh
say() { echo; echo "▶ $*"; }
fail() { echo; echo "✗ $*"; read -n1 -rsp "按任意鍵關閉…"; exit 1; }
trap 'fail "失敗了，請把上面的訊息截圖給 Claude"' ERR

say "1/5 抓最新程式碼"
git fetch -q origin "$BRANCH"
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH" "origin/$BRANCH"
# Xcode 選 Team 會改到專案檔：先收起來、更新完再放回去
git pull -q --rebase --autostash origin "$BRANCH"
echo "  目前版本：$(git log -1 --format='%h %s')"

say "2/5 打包網頁、同步到 iOS"
ABAI_NO_OPEN=1 ./ios/prepare-device.sh

say "3/5 找 iPhone"
DEV=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /(available|connected)/ {for(i=1;i<=NF;i++) if($i ~ /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/) {print $i; exit}}')
[ -n "$DEV" ] || fail "找不到 iPhone：用線接上、解鎖手機，並確認已在 Xcode 裝過一次"
echo "  裝置：$DEV"

say "4/5 編譯（第一次比較久）"
DD="$PWD/ios/build-device"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination "generic/platform=iOS" -derivedDataPath "$DD" -allowProvisioningUpdates \
  -quiet build
APP=$(ls -d "$DD"/Build/Products/Debug-iphoneos/*.app | head -1)

say "5/5 安裝並打開"
xcrun devicectl device install app --device "$DEV" "$APP"
BID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")
xcrun devicectl device process launch --device "$DEV" "$BID" >/dev/null 2>&1 || echo "  （手機鎖著所以沒自動打開，解鎖後自己點開就好）"

trap - ERR
echo; echo "✓ 完成！手機上的 App 已經是最新版：$(git log -1 --format='%h')"
read -n1 -rsp "按任意鍵關閉…"
