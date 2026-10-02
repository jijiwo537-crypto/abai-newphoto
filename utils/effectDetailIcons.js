// User-approved parameter icons, shared by every effect detail panel.
// Match the canonical label before translation so every language stays consistent.
const PARAMETER_ICONS = Object.freeze({
  '強度': 'blur_on',
  '範圍': 'tonality',
  '擴散': 'flare',
  '色相': 'palette',
  '色相 A': 'palette',
  '色相 B': 'palette',
  '角度': 'rotate_right',
  '方向': 'zoom_out_map',
  '顆粒': 'grain',
  '色差': 'filter_b_and_w',
  '對比': 'contrast',
  '長度': 'straighten',
  '位移': 'swap_horiz',
  '形狀': 'shapes',
  '密度': 'apps',
  '比例': 'pie_chart',
  '錯誤': 'broken_image',
  '變化': 'scatter_plot',
  '數量': 'apps',
  '抖動': 'waves',
  '掃描線': 'view_day',
  '格數': 'grid_view',
  '折射': 'filter_b_and_w',
});

export function effectDetailIcon(label, existingIcon) {
  return PARAMETER_ICONS[label] ?? existingIcon;
}
