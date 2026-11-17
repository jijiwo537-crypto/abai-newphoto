#!/bin/bash
# 在 Mac 上「點兩下」就把最新修改裝到接著線（或同 Wi-Fi 已配對）的 iPhone 上。
# 步驟：抓最新程式碼 → 打包網頁並同步到 iOS（ios/prepare-device.sh）→ 編譯 → 安裝 → 打開 App。
# 第一次用之前，要先照 ios/prepare-device.sh 的說明在 Xcode 選好 Team、成功按 ▶ 裝過一次。
set -euo pipefail
cd "$(dirname "$0")"
BRANCH=claude/sleepy-mccarthy-2mabxh
say() { echo; echo "▶ $*"; }
fail() { echo; echo "✗ $*"; read -n1 -rsp "按任意鍵關閉…"; exit 1; }
trap 'fail "失敗了，請把上面的訊息截圖給 Claude（完整紀錄在桌面的 ABAI更新紀錄.txt）"' ERR
# 全部輸出同時存一份到桌面，失敗時可以直接把這個檔案給 Claude
exec > >(tee "$HOME/Desktop/ABAI更新紀錄.txt") 2>&1
echo "開始：$(date)　macOS $(sw_vers -productVersion 2>/dev/null)"

# 只裝了「命令列工具」或 xcode-select 指錯地方時，xcodebuild 不能用：直接指到 Xcode.app（不需要密碼）
if ! xcodebuild -version >/dev/null 2>&1; then
  XA=$(ls -d /Applications/Xcode.app 2>/dev/null || ls -d /Applications/Xcode*.app 2>/dev/null | sort -V | tail -1)
  [ -n "$XA" ] || fail "找不到 Xcode.app：請從 App Store 安裝 Xcode"
  export DEVELOPER_DIR="$XA/Contents/Developer"
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  xcodebuild -version 2>&1 | awk 'NR<=3'
  fail "Xcode 還不能用：請打開 Xcode 一次，按「同意」授權條款、等它裝完元件，再點一次這個檔案"
fi
echo "$(xcodebuild -version 2>/dev/null | awk 'NR==1')（$(xcode-select -p 2>/dev/null) → ${DEVELOPER_DIR:-預設}）"

say "1/5 抓最新程式碼"
git fetch -q origin "$BRANCH"
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH" "origin/$BRANCH"
# Xcode 選 Team 會改到專案檔：先收起來、更新完再放回去
git pull -q --rebase --autostash origin "$BRANCH"
echo "  目前版本：$(git log -1 --format='%h %s')"

say "2/5 打包網頁、同步到 iOS"
# 點兩下開的視窗不會載入 ~/.zshrc，常見的 Node 安裝位置要自己加進來
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.abai-node/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  echo "  這台 Mac 沒有 Node.js（打包網頁要用），自動下載一份放在 ~/.abai-node（不需要密碼）…"
  ARCH=$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64)
  V=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -oE "node-v[0-9.]+-darwin-$ARCH.tar.gz" | awk 'NR==1')
  [ -n "$V" ] || fail "下載 Node.js 失敗，請檢查網路"
  rm -rf "$HOME/.abai-node" && mkdir -p "$HOME/.abai-node"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$V" | tar -xz -C "$HOME/.abai-node" --strip-components 1
  hash -r
fi
echo "  Node.js：$(node -v)"
ABAI_NO_OPEN=1 ./ios/prepare-device.sh

say "3/5 找 iPhone"
if [ "${ABAI_CI:-}" = 1 ]; then   # 雲端測試用：沒有手機，只確認能編譯出 iPhone 版
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "generic/platform=iOS" \
    -derivedDataPath "$PWD/ios/build-device" CODE_SIGNING_ALLOWED=NO -quiet build
  echo "✓ CI：iPhone 版編譯成功"; exit 0
fi
# 用 devicectl 的 JSON 找 iPhone（有線或 Wi-Fi 都算）；Wi-Fi 的手機有時要幾秒才出現，最多等 60 秒
find_iphone() {
  local J; J=$(mktemp); xcrun devicectl list devices --json-output "$J" >/dev/null 2>&1 || true
  node -e '
    let d = []; try { d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.devices || []; } catch {}
    const ok = d.filter(x => (x.hardwareProperties || {}).platform === "iOS" && (x.connectionProperties || {}).pairingState === "paired");
    // 優先：已經連上的（tunnel connected）> 有線 > Wi-Fi
    const score = x => { const c = x.connectionProperties || {}; return ((x.hardwareProperties || {}).deviceType === "iPhone" ? 8 : 0) + (c.tunnelState === "connected" ? 4 : 0) + (c.transportType === "wired" ? 2 : c.transportType === "localNetwork" ? 1 : 0); };
    ok.sort((a, b) => score(b) - score(a));
    const x = ok.find(x => score(x) > 0) || ok[0];
    if (x) console.log(x.identifier + "\t" + ((x.deviceProperties || {}).name || "iPhone") + "\t" + ((x.connectionProperties || {}).transportType || "?"));
  ' "$J"
  rm -f "$J"
}
INFO=""
for i in $(seq 1 12); do
  INFO=$(find_iphone)
  [ -n "$INFO" ] && break
  [ "$i" = 1 ] && echo "  還沒看到手機，等它出現（請解鎖手機、保持螢幕亮著）…"
  sleep 5
done
if [ -z "$INFO" ]; then
  echo "  ── 這台 Mac 目前看得到的裝置 ──"; xcrun devicectl list devices 2>&1 | sed 's/^/  /'
  fail "找不到 iPhone。請用線接上一次並解鎖手機（第一次一定要接線，手機上若跳出「要信任這部電腦嗎」請按信任），再點一次這個檔案"
fi
DEV=$(printf '%s' "$INFO" | cut -f1)
echo "  手機：$(printf '%s' "$INFO" | cut -f2)（$(printf '%s' "$INFO" | cut -f3 | sed 's/wired/有線/;s/localNetwork/Wi-Fi/')）"

say "4/5 編譯（第一次比較久）"
# 簽名用的 Team：自動找（不用打開 Xcode 選）。順序：之前存的 → 舊版專案檔/未存檔備份裡的 → 鑰匙圈裡的開發者憑證
TEAM_FILE="$HOME/.abai-team-id"
TEAM=$(cat "$TEAM_FILE" 2>/dev/null || true)
pick() { grep -oE 'DEVELOPMENT_TEAM = [A-Z0-9]{10}' | awk 'NR==1' | awk '{print $3}'; }
[ -n "$TEAM" ] || TEAM=$(git show '舊版備份:ios/App/App.xcodeproj/project.pbxproj' 2>/dev/null | pick || true)
[ -n "$TEAM" ] || TEAM=$(git stash list --format=%gd 2>/dev/null | while read s; do git show "$s:ios/App/App.xcodeproj/project.pbxproj" 2>/dev/null | pick; done | awk 'NR==1')
[ -n "$TEAM" ] || TEAM=$(security find-certificate -a -c "Apple Development" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | grep -oE 'OU ?= ?[A-Z0-9]{10}' | awk 'NR==1' | grep -oE '[A-Z0-9]{10}$' || true)
[ -n "$TEAM" ] || fail "找不到你的開發者 Team：請先打開 Xcode → 上方選單 Xcode → Settings → Accounts，確認有登入你的 Apple ID"
echo "$TEAM" > "$TEAM_FILE"
echo "  Team：$TEAM"
DD="$PWD/ios/build-device"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination "generic/platform=iOS" -derivedDataPath "$DD" -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" -quiet build
APP=$(ls -d "$DD"/Build/Products/Debug-iphoneos/*.app | awk 'NR==1')

say "5/5 安裝並打開"
xcrun devicectl device install app --device "$DEV" "$APP"
BID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")
xcrun devicectl device process launch --device "$DEV" "$BID" >/dev/null 2>&1 || echo "  （手機鎖著所以沒自動打開，解鎖後自己點開就好）"

trap - ERR
echo; echo "✓ 完成！手機上的 App 已經是最新版：$(git log -1 --format='%h')"
read -n1 -rsp "按任意鍵關閉…"
