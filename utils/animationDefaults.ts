/* 常駐動畫的預設值。面板上的數字都是 0～100；實際值在旁邊註明。
   2026-11 依「動畫預設值調整」網站調好的數值更新。 */
type IdleTarget = { symbol?: boolean; text?: boolean; image?: boolean; shape?: boolean; grid?: boolean; line?: boolean; glint?: boolean; scatter?: boolean };
export function idleDefaults(kind: string, target: IdleTarget) {
  const S = idleSpeedFromUi;
  // 一般文字（不含符號）
  if (target.text && !target.symbol) {
    if (kind === 'grid-wave') return { amp: 80, speed: 1.75 };                              // 波浪l：幅度 80
    if (kind === 'float') return { amp: 50, speed: S(50) };                                // 漂浮：速度 50（1.0）
    if (kind === 'breathe') return { amp: 30, speed: IDLE_SPEED_DEFAULT };                 // 縮放l：幅度 30
    if (kind === 'symbol-breathe2') return { amp: 50, speed: 1.25 };                       // 縮放ll：幅度 50
    if (kind === 'lab-T-L15') return { amp: 100, speed: S(90) };                          // 波浪ll：幅度 100、速度 90（1.64）
    if (kind === 'lab-T-L01') return { amp: 100, speed: rangedSpeedFromUi(kind, 90) };     // 呼吸：幅度 100、速度 90（2.72）
    if (kind === 'lab-T-L04') return { amp: 50, speed: S(100) };                          // 閃爍：速度 100（1.8）
    if (kind === 'lab-T-L20') return { amp: 40, speed: rangedSpeedFromUi(kind, 50) };     // 搖晃：幅度 40、速度 50（3.84）
  }
  // 符號
  if (target.symbol) {
    if (kind === 'symbol-breathe2') return { amp: 90, speed: 1.25 };                      // 縮放II：幅度 90
    if (kind === 'lab-S-L01') return { amp: 100, speed: rangedSpeedFromUi(kind, 90) };     // 呼吸：幅度 100、速度 90（2.27）
    if (kind === 'breathe') return { amp: 30, speed: S(50) };                              // 縮放I：速度 50（1.0）
    if (kind === 'lab-S-L03') return { amp: 100, speed: S(70) };                          // 搖擺：幅度 100、速度 70（1.32）
    if (kind === 'lab-S-L07') return { amp: 50, speed: S(50) };                           // 翻面：速度 50（1.0）
    if (kind === 'lab-S-L20') return { amp: 30, speed: rangedSpeedFromUi(kind, 50) };     // 搖晃：幅度 30、速度 50（3.84）
  }
  // 縮放II（文字）：速度 50（＝1.25）
  if (kind === 'symbol-breathe2') return { amp: 60, speed: 1.25 };
  // 星芒
  if (target.glint) {
    if (kind === 'glint-breathe') return { amp: 100, speed: glintSpeedFromUi(100) };      // 呼吸：速度 100（1.8）
    if (kind === 'breathe') return { amp: 100, speed: glintZoomSpeedFromUi(40) };         // 縮放I：速度 40（1.32）
    if (kind === 'wobble') return { amp: 80, speed: IDLE_SPEED_DEFAULT };                 // 搖擺：幅度 80
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
    const lineAmp: Record<string, number> = { float: 100, 'grid-wave': 100, breathe: 50, spin: 100, wobble: 50, orbit: 50, jitter: 40 };
    if (kind === 'orbit') return { amp: 50, speed: S(80) };                                // 繞圈：速度 80（1.48）
    if (kind === 'grid-wave') return { amp: 100, speed: .2 + 90 * .018 };
    return { amp: lineAmp[kind] ?? 20, speed: IDLE_SPEED_DEFAULT };
  }
  // 網格圖形
  if (target.grid) {
    if (kind === 'grid-wave') return { amp: 100, speed: .2 + 90 * .018 };                // 波浪：幅度 100
    if (kind === 'breathe') return { amp: 40, speed: IDLE_SPEED_DEFAULT };               // 縮放：幅度 40
  }
  // 一般圖形（不是網格、線條、星芒、散落邊框）
  if (target.shape && !target.grid && !target.line && !target.glint && !target.scatter) {
    if (kind === 'orbit') return { amp: 70, speed: IDLE_SPEED_DEFAULT };                 // 繞圈：幅度 70
  }
  // 波浪：圖形用 0.2～2.0 的刻度（90＝1.82），文字、圖片用 1.0～2.5 的刻度（50＝1.75）
  if (kind === 'grid-wave') return { amp: 50, speed: target.shape ? .2 + 90 * .018 : 1.75 };
  return { amp: kind === 'breathe' && target.symbol ? 30 : 50, speed: IDLE_SPEED_DEFAULT };
}

/** 圖案（一整群）各常駐動畫的預設：沒列出的欄位沿用圖案一開始的設定（幅度 100、速度 1.96）。 */
export const PATTERN_IDLE_DEFAULTS: Record<string, { amp?: number; speed?: number }> = {
  jitter: { amp: 60, speed: 1.48 },                           // 抖動：幅度 60、速度 80（1.48）
  breathe: { amp: 50 },                                       // 縮放：幅度 50
  spin: { speed: 1.32 },                                      // 旋轉：速度 70（1.32）
  'lab-P-L04': { amp: 50, speed: 1.8 },                       // 發光：幅度 50、速度＝原本刻度的 100（1.8）
  'lab-P-L07': { amp: 55 },                                   // 翻面：幅度 55
  'lab-P-L02': { speed: 1.5 },                                // 閃爍：速度 33（1.5，約 1.3 秒亮滅一次，跟原本的中間值一樣）
  'lab-P-L20': { amp: 50, speed: 1.24 + 5.2 * .35 },          // 搖晃：幅度 50、速度 35（3.06）
};

/** 有自己速度範圍的常駐動畫：滑桿 0～100 對應 [最小, 最大] 倍（線性）。 */
export const SPEED_RANGES: Record<string, [number, number]> = {
  /* 搖晃：面板 50 ＝ 舊刻度的 70（3.84）、100 ＝ 舊刻度的 120（6.44） */
  'lab-T-L20': [1.24, 6.44], 'lab-S-L20': [1.24, 6.44], 'lab-P-L20': [1.24, 6.44],
  /* 圖案閃爍：原本 1～2 倍，整條滑桿只差一倍，拉了也幾乎看不出差別。改成 0.5～3.5（一次亮滅約 3.9 秒～0.56 秒） */
  'lab-P-L02': [.5, 3.5],
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
export function entrySpeedDefaultUi(kind: string, target: { symbol?: boolean; line?: boolean; glint?: boolean; image?: boolean; plainShape?: boolean }): number | undefined {
  if (kind === 'spring' && (target.image || target.plainShape)) return 60;   // 圖片、一般圖形的流星
  if (target.symbol) return ({ 'lab-S-E04': 60, 'lab-S-E10': 50, 'lab-S-E03': 65 } as Record<string, number>)[kind];  // 足跡 60；旋轉 50；淡入 65
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

/* ── 共用滑桿 ──────────────────────────────────────────────────────
   幅度、速度（常駐）與速度（進場）是共用滑桿：每個物件一開始都是 50，換動畫時數字不變。
   滑桿在 50 時，每個動畫都正好是它自己的預設程度（例如舊版預設速度 80 的動畫，50 就是舊版的 80）。
   每移動 1 格，就等於在這個動畫原本的刻度上移動 1 格（靈敏度不變），所以：
     預設 80 的動畫：0 ＝ 原本的 30、50 ＝ 原本的 80、100 ＝ 原本的 130 —— 上限因此提高；
     預設 20 的動畫：0 ＝ 原本的 −30（往原本刻度以外延伸，碰到最低限度就停）、100 ＝ 原本的 70。
   超出原本 0～100 的部分沿用同一個刻度往外延伸（進場速度是等比刻度，其餘是線性）。 */
export const SHARED_MID = 50;
/** 共用滑桿的數字 → 這個動畫自己刻度上的位置（可以超出 0～100） */
export const fromShared = (s: number, def: number) => def + (Math.max(0, Math.min(100, s)) - SHARED_MID);
/** 這個動畫自己刻度上的位置 → 共用滑桿的數字（舊作品沒存位置時用） */
export const toShared = (u: number, def: number) => Math.max(0, Math.min(100, SHARED_MID + (u - def)));
/** 自己刻度上任意位置的實際值：0～100 內用原本的換算，超出的部分沿用同一刻度延伸 */
export const actualOnScale = (u: number, at: (v: number) => number, geometric: boolean) => {
  if (u >= 0 && u <= 100) return at(u);
  const a = at(0), b = at(100);
  if (geometric && a > 0 && b > 0) return a * Math.pow(b / a, u / 100);
  return a + (b - a) * u / 100;
};
/** 實際值的最低限度：幅度不小於 0、速度不小於 0.05 倍、進場時長不小於 0.05 秒 */
export const floorActual = (f: 'inSpeed' | 'amp' | 'speed', v: number) => f === 'amp' ? Math.max(0, v) : Math.max(.05, v);
