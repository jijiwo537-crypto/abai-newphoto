/* 常駐動畫的預設值。面板上的數字都是 0～100；實際值在旁邊註明。
   2026-11 依「動畫預設值調整」網站調好的數值更新。 */
type IdleTarget = { symbol?: boolean; text?: boolean; image?: boolean; shape?: boolean; grid?: boolean; line?: boolean; glint?: boolean; scatter?: boolean };
export function idleDefaults(kind: string, target: IdleTarget) {
  const S = idleSpeedFromUi;
  // 一般文字（不含符號）
  if (target.text && !target.symbol) {
    if (kind === 'grid-wave') return { amp: 80, speed: 1.75 };                              // 波浪l：幅度 80
    if (kind === 'lab-T-L15') return { amp: 100, speed: S(90) };                          // 波浪ll：幅度 100、速度 90（1.64）
    if (kind === 'lab-T-L01') return { amp: 100, speed: IDLE_SPEED_DEFAULT };             // 呼吸：幅度 100
    if (kind === 'lab-T-L04') return { amp: 50, speed: S(100) };                          // 閃爍：速度 100（1.8）
    if (kind === 'lab-T-L20') return { amp: 50, speed: rangedSpeedFromUi(kind, 50) };     // 失焦：速度 50（2.8）
  }
  // 符號
  if (target.symbol) {
    if (kind === 'symbol-breathe2') return { amp: 90, speed: 1.25 };                      // 縮放II：幅度 90
    if (kind === 'lab-S-L01') return { amp: 100, speed: IDLE_SPEED_DEFAULT };             // 呼吸：幅度 100
    if (kind === 'lab-S-L03') return { amp: 100, speed: S(70) };                          // 搖擺：幅度 100、速度 70（1.32）
    if (kind === 'lab-S-L07') return { amp: 50, speed: S(50) };                           // 翻面：速度 50（1.0）
    if (kind === 'lab-S-L20') return { amp: 40, speed: rangedSpeedFromUi(kind, 50) };     // 失焦：幅度 40、速度 50（2.8）
  }
  // 縮放II（文字）：速度 50（＝1.25）
  if (kind === 'symbol-breathe2') return { amp: 60, speed: 1.25 };
  // 星芒
  if (target.glint) {
    if (kind === 'glint-breathe') return { amp: 100, speed: glintSpeedFromUi(100) };      // 呼吸：速度 100（1.8）
    if (kind === 'breathe') return { amp: 100, speed: glintZoomSpeedFromUi(40) };         // 縮放I：速度 40（1.32）
    if (kind === 'wobble') return { amp: 70, speed: IDLE_SPEED_DEFAULT };                 // 搖擺：幅度 70
  }
  // 星芒的縮放II：幅度拉滿，速度 80
  if (kind === 'glint-breathe' || kind === 'glint-rays') return { amp: 100, speed: glintSpeedFromUi(GLINT_SPEED_UI_DEFAULT) };
  // 星芒的閃爍：跟發光的閃爍一樣（速度 0.84 ＝ 面板上的 0）
  if (kind === 'glint-blink') return { amp: 100, speed: .84 };
  if (kind === 'image-breathe' && target.image) return { amp: 100, speed: (70 + 70 * 1.8) / 100 };
  // 圖片的繞圈：速度 70（1.32）
  if (kind === 'orbit' && target.image) return { amp: 50, speed: S(70) };
  // 散落邊框
  if (target.scatter) {
    if (kind === 'scatter-breathe') return { amp: 90, speed: 2.5 };                       // 呼吸：幅度 80（90）、速度 100（2.5）
    if (kind === 'jitter') return { amp: 40, speed: IDLE_SPEED_DEFAULT };                 // 抖動：幅度 40
  }
  // 線條
  if (target.line) {
    const lineAmp: Record<string, number> = { float: 70, 'grid-wave': 100, breathe: 50, spin: 100, wobble: 50, orbit: 50 };
    if (kind === 'grid-wave') return { amp: 100, speed: .2 + 90 * .018 };
    return { amp: lineAmp[kind] ?? 20, speed: IDLE_SPEED_DEFAULT };
  }
  // 波浪：圖形用 0.2～2.0 的刻度（90＝1.82），文字、圖片用 1.0～2.5 的刻度（50＝1.75）
  if (kind === 'grid-wave') return { amp: 50, speed: target.shape ? .2 + 90 * .018 : 1.75 };
  return { amp: kind === 'breathe' && target.symbol ? 30 : 50, speed: IDLE_SPEED_DEFAULT };
}

/** 有自己速度範圍的常駐動畫：滑桿 0～100 對應 [最小, 最大] 倍（線性）。 */
export const SPEED_RANGES: Record<string, [number, number]> = {
  'lab-T-L20': [.2, 5.4], 'lab-S-L20': [.2, 5.4], 'lab-P-L20': [.2, 5.4],   // 失焦
  'lab-P-L02': [1, 2],                                                        // 圖案閃爍
  'lab-T-L01': [.2, 3],                                                       // 文字呼吸
  'lab-S-L01': [.2, 2.5],                                                     // 符號呼吸
};
export const hasSpeedRange = (id: string) => id in SPEED_RANGES;
export const rangedSpeedToUi = (id: string, speed: number) => {
  const [lo, hi] = SPEED_RANGES[id];
  return Math.round(Math.max(0, Math.min(100, (speed - lo) / (hi - lo) * 100)));
};
export const rangedSpeedFromUi = (id: string, ui: number) => {
  const [lo, hi] = SPEED_RANGES[id];
  return lo + (hi - lo) * Math.max(0, Math.min(100, ui)) / 100;
};

/** 進場動畫的速度預設（面板 0～100）；沒列出的照一般預設 70。 */
export function entrySpeedDefaultUi(kind: string, target: { symbol?: boolean; line?: boolean; glint?: boolean }): number | undefined {
  if (target.symbol) return ({ 'lab-S-E04': 50, 'lab-S-E10': 50, 'lab-S-E03': 65 } as Record<string, number>)[kind];  // 足跡、旋轉 50；淡入 65
  if (target.line && kind === 'draw') return 30;      // 線條畫筆
  if (target.glint && kind === 'fade') return 90;     // 星芒淡入
  return undefined;
}

/* ── 動畫滑桿一律顯示 0～100 ───────────────────────────────────────
   內部存的值不變（舊作品打開來動起來一模一樣），只是面板上的刻度換算成 0～100。 */
const clampUi = (u: number) => Math.max(0, Math.min(100, u));

/** 常駐動畫的一般速度：內部倍率 0.2～1.8（舊面板 20～180） */
export const idleSpeedToUi = (speed: number) => Math.round(clampUi((speed * 100 - 20) / 1.6));
export const idleSpeedFromUi = (ui: number) => (20 + clampUi(ui) * 1.6) / 100;
/** 預設速度：舊的 0.9 換算是 43.75，取最接近的 0 結尾 40（＝0.84） */
export const IDLE_SPEED_DEFAULT = idleSpeedFromUi(40);

/** 星芒呼吸、縮放II 的速度：0.5～1.8（舊刻度 50～180），預設 80（舊的 160 換算 84.6，取 0 結尾） */
export const glintSpeedToUi = (speed: number) => Math.round(clampUi((speed * 100 - 50) / 1.3));
export const glintSpeedFromUi = (ui: number) => (50 + clampUi(ui) * 1.3) / 100;
export const GLINT_SPEED_UI_DEFAULT = 80;

/** 星芒縮放I 的速度：1.0～1.8（0 ＝ 一般刻度的 50） */
export const glintZoomSpeedToUi = (speed: number) => Math.round(clampUi((speed * 100 - 100) / .8));
export const glintZoomSpeedFromUi = (ui: number) => (100 + clampUi(ui) * .8) / 100;

/** 星芒閃爍的速度：0.84～4.04（＝發光刻度的 20～120），面板顯示 0～100；預設 0.84 剛好是 0 */
export const blinkSpeedToUi = (speed: number) => Math.round(clampUi((speed * 100 - 84) / 3.2));
export const blinkSpeedFromUi = (ui: number) => (84 + clampUi(ui) * 3.2) / 100;

/** 起始（延遲）：0～3 秒 */
export const delayToUi = (delay: number) => Math.round(clampUi(delay / .03));
export const delayFromUi = (ui: number) => clampUi(ui) * .03;

/** 虛線描邊的常駐動畫速度：內部 20～180（舊面板就是這個數），預設 100 剛好是 50 */
export const dashSpeedToUi = (v: number) => Math.round(clampUi((v - 20) / 1.6));
export const dashSpeedFromUi = (ui: number) => Math.round(20 + clampUi(ui) * 1.6);

/** 循環間隔：0～20 秒；預設 8 秒剛好是 40 */
export const holdToUi = (sec: number) => Math.round(clampUi(sec / .2));
export const holdFromUi = (ui: number) => clampUi(ui) * .2;
