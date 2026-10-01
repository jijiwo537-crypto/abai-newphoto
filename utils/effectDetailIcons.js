// Reuse the established photo editor parameter icons. Unmatched parameters
// keep their existing effect definition; this does not create new artwork.
const PARAMETER_ICONS = Object.freeze({
  '強度': 'blur_on',
  '範圍': 'tonality',
  '擴散': 'flare',
  '色相': 'palette',
  '色相 A': 'palette',
  '色相 B': 'palette',
  '角度': 'rotate_right',
  '方向': 'rotate_right',
  '顆粒': 'grain',
  '對比': 'contrast',
});

export function effectDetailIcon(label, existingIcon) {
  return PARAMETER_ICONS[label] ?? existingIcon;
}
