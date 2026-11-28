#!/bin/bash
# 在接著 Mac 的 iPhone 上跑 ABAI 全面驗證（要先用「更新ABAI到手機」裝好最新版）。
# 一輪就把每個工具最容易出事的情況做一次：修圖 4800 萬像素、批量、創意拼圖（無縫＋整體特效）、美顏、仿色、藝術效果、跨頁拼圖。
# 預設 1 輪（約 10～15 分鐘）；想順便抓「越用越吃記憶體」就多跑幾輪，例如拖進終端機後加 3。
# 跑的時候不要碰手機、不要鎖螢幕。跑完到「設定 → 問題反饋 → 複製穩定性紀錄」，貼給開發者。
PHONE="${ABAI_PHONE:-00008110-000119E23C82801E}"
ROUNDS="${1:-1}"
if ! xcodebuild -version >/dev/null 2>&1; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi
echo "在 iPhone 上啟動 ABAI 全面驗證（$ROUNDS 輪）…"
if xcrun devicectl device process launch --device "$PHONE" --terminate-existing com.abai.photo -abaiQA "full-$ROUNDS"; then
  echo "✓ 已開始。請讓手機保持亮著、不要操作，大約 $((ROUNDS * 10))～$((ROUNDS * 15)) 分鐘後完成。"
  echo "  最後一行出現「全面驗證結束」就是跑完了。到 App 的「設定 → 問題反饋 → 複製穩定性紀錄」，貼給開發者。"
else
  echo "✗ 啟動失敗：請確認 iPhone 用線接著、已解鎖，而且已經用「更新ABAI到手機」裝好最新版。"
fi
[ -t 0 ] && read -r -p '按 Enter 關閉…' _
