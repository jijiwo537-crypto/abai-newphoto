#!/bin/bash
# 在接著 Mac 的 iPhone 上跑 ABAI 壓力測試（要先用「更新ABAI到手機」裝好最新版）。
# App 會自己反覆做：創意拼圖 5 張＋無縫＋存檔、編輯＋濾鏡＋存檔，共 ROUNDS 輪（預設 8 輪，約 15～25 分鐘）。
# 跑的時候不要碰手機、不要鎖螢幕。跑完（或中途閃退後重開 App）到「設定 → 問題反饋 → 複製穩定性紀錄」，貼給開發者。
PHONE="${ABAI_PHONE:-00008110-000119E23C82801E}"
ROUNDS="${1:-8}"
if ! xcodebuild -version >/dev/null 2>&1; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi
echo "在 iPhone 上啟動 ABAI 壓力測試（$ROUNDS 輪）…"
if xcrun devicectl device process launch --device "$PHONE" --terminate-existing com.abai.photo -abaiQA "stress-$ROUNDS"; then
  echo "✓ 已開始。請讓手機保持亮著、不要操作，大約 $((ROUNDS * 2))～$((ROUNDS * 3)) 分鐘後完成。"
  echo "  完成後：App 裡「設定 → 問題反饋 → 複製穩定性紀錄」，貼給開發者。"
else
  echo "✗ 啟動失敗：請確認 iPhone 用線接著、已解鎖，而且已經用「更新ABAI到手機」裝好最新版。"
fi
[ -t 0 ] && read -r -p '按 Enter 關閉…' _
