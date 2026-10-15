/* 常駐動畫的預設值：面板上（0～100）一律是 0 結尾的整數 */
export function idleDefaults(kind: string, target: { symbol?: boolean; text?: boolean; image?: boolean; shape?: boolean; grid?: boolean; line?: boolean; glint?: boolean }) {
  // 縮放II（文字、符號）：速度 50（＝1.25）
  if (kind === 'symbol-breathe2') return { amp: 60, speed: 1.25 };
  // 星芒的呼吸、縮放II：幅度拉滿，速度 80
  if (kind === 'glint-breathe' || kind === 'glint-rays') return { amp: 100, speed: glintSpeedFromUi(GLINT_SPEED_UI_DEFAULT) };
  // 星芒的縮放I：幅度拉滿，速度 70（＝1.56）
  if (kind === 'breathe' && target.glint) return { amp: 100, speed: glintZoomSpeedFromUi(70) };
  // 星芒的閃爍：跟發光的閃爍一樣（速度 0.84 ＝ 面板上的 0）
  if (kind === 'glint-blink') return { amp: 100, speed: .84 };
  if (kind === 'image-breathe' && target.image) return { amp: 100, speed: (70 + 70 * 1.8) / 100 };
  // 波浪：圖形用 0.2～2.0 的刻度（90＝1.82），文字、圖片用 1.0～2.5 的刻度（50＝1.75）
  if (kind === 'grid-wave') return { amp: target.grid ? 50 : 30, speed: target.shape ? .2 + 90 * .018 : 1.75 };
  return { amp: target.line ? 20 : kind === 'breathe' && target.symbol ? 30 : 50, speed: IDLE_SPEED_DEFAULT };
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
