/** 只是介面的順序，絕不改繪製的順序或存檔的特效 ID */
export function orderEffectCards<T>(items: readonly T[], idOf: (item: T) => string): T[] {
  const result = [...items];
  for (const [id, anchor] of [['fxExposureSpill', 'softLight'], ['fxLowfi', 'fxSpin']]) {
    const index = result.findIndex(item => idOf(item) === id);
    if (index < 0 || !result.some(item => idOf(item) === anchor)) continue;
    const [card] = result.splice(index, 1);
    result.splice(result.findIndex(item => idOf(item) === anchor) + 1, 0, card);
  }
  return result;
}
