#!/bin/bash
# 在自己的 Mac 上準備好「用 Xcode 裝到 iPhone 測試」：
#   ./ios/prepare-device.sh            ← 在專案根目錄執行
#   ./ios/prepare-device.sh com.你的名字   ← 免費帳號用不了 com.abai.photo 時，換成自己的 Bundle ID 開頭
#
# 做的事情跟雲端打包一模一樣：套上部署用的版面修正 → 安裝套件 → 打包網頁 → 同步到 iOS 專案，
# 最後把修正撤回（原始碼保持乾淨），再打開 Xcode。
set -euo pipefail
cd "$(dirname "$0")/.."

command -v xcodebuild >/dev/null || { echo "找不到 Xcode：請先從 App Store 安裝 Xcode 16 以上，並打開一次同意授權"; exit 1; }
XV=$(xcodebuild -version | head -1 | awk '{print $2}' | cut -d. -f1)
[ "${XV:-0}" -ge 16 ] || { echo "Xcode 版本太舊（需要 16 以上，因為用到 iOS 18 的功能）"; exit 1; }
command -v node >/dev/null || { echo "找不到 Node.js：請安裝 Node 22（https://nodejs.org）"; exit 1; }

PATCH=.github/deploy-layout.patch
applied=0
if git apply --check "$PATCH" 2>/dev/null; then git apply "$PATCH"; applied=1; fi
cleanup() { if [ "$applied" = 1 ]; then git apply -R "$PATCH" || true; fi; }
trap cleanup EXIT

# 鎖定檔是在 Linux 產生的，缺 Mac 版的建置元件（npm 的老問題），所以這裡不照鎖定檔裝
cp package-lock.json /tmp/abai-package-lock.json 2>/dev/null || true
rm -f package-lock.json
npm install --no-audit --no-fund
cp /tmp/abai-package-lock.json package-lock.json 2>/dev/null || git checkout -- package-lock.json
npm run build
npx cap sync ios

# 免費帳號：Bundle ID 必須是你自己的。只寫進本機的 xcconfig，不改專案檔、不會被提交
if [ "${1:-}" != "" ]; then
  cat > ios/debug.local.xcconfig <<EOF
// 這台 Mac 自己用的設定（不提交）：免費開發者帳號要用自己的 Bundle ID
ABAI_BUNDLE_ID = $1.abai
ABAI_EDIT_BUNDLE_ID = $1.abai.edit
EOF
  echo "已設定 Bundle ID：$1.abai（相簿編輯擴充：$1.abai.edit）"
fi

echo
echo "準備好了。接下來在 Xcode："
echo "  1. 左上角選 App 這個 scheme，裝置選你的 iPhone（用線接上、手機上按「信任」）"
echo "  2. 點左邊的 App 專案 → TARGETS 的 App 與 ABAIEdit → Signing & Capabilities → Team 選你的 Apple ID"
echo "  3. 按 ▶ 執行。第一次裝好後，iPhone 的「設定 → 一般 → VPN 與裝置管理」信任這個開發者"
echo "     （iOS 16 以上還要打開「設定 → 隱私權與安全性 → 開發者模式」，會重新開機一次）"
open ios/App/App.xcodeproj
