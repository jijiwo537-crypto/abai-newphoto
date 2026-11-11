/* 使用者自己存的「調整組合」（預設）：濾鏡＋所有整體調整（曝光、色調、曲線、HSL、色輪、特效…）。
 * 不含遮色片與構圖（那些是跟著某一張照片的位置走的，套到別張照片上沒有意義）。
 * 存在這支裝置上（localStorage），很小：一個預設只是一組數字。 */
const KEY = 'abai.editor.presets.v1';
export const MAX_PRESETS = 30;

export interface UserPreset {
  id: string;
  /** 第幾個存的（顯示成「預設 1」「預設 2」…，刪掉中間的也不重新編號） */
  n: number;
  lutId: string;
  /** 整體調整的參數（已拿掉遮色片相關欄位） */
  params: Record<string, unknown>;
  flags: { soft: boolean; blur: boolean; grain: boolean; halation: boolean; softMan: boolean; blurMan: boolean; grainMan: boolean; halationMan: boolean };
}

/** 從整包編輯參數裡只留「整體調整」：mask 開頭的（遮色片）一律不存 */
export const presetParamsOf = (p: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(p)) if (!k.startsWith('mask')) out[k] = p[k];
  return JSON.parse(JSON.stringify(out));
};

export function loadPresets(): UserPreset[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => x && typeof x.id === 'string' && x.params && typeof x.lutId === 'string') : [];
  } catch { return []; }
}
export function storePresets(list: UserPreset[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_PRESETS))); return true; } catch { return false; }
}
export const nextPresetNumber = (list: UserPreset[]) => list.reduce((m, p) => Math.max(m, p.n || 0), 0) + 1;
