/* 底片相機：每一台是一整套（曝光方式、底片曲線、色調、顆粒、光暈、鏡頭、閃光燈、焦段），
 * 按一下就換成那台相機。原生端的計算在 ios/App/App/ABAIFilm.swift（觀景窗與拍出來的照片共用）。
 *
 * 曝光：evMin～evMax 是這台相機能用的曝光（ISO 100 的 EV，EV = log2(光圈² ÷ 快門) − log2(ISO ÷ 100)）。
 *   ‧ 一次性相機只有一組（光圈 f/10、快門 1/125、ISO 400 → 約 11.6），所以室內會暗好幾格、大太陽下過曝。
 *   ‧ 自動的傻瓜相機有一段範圍（鏡頭最大光圈＋最慢快門 ～ 最小光圈＋最快快門），超出範圍才會暗／亮。
 * 參數都是照實體相機的規格算出來的，再用實拍校正。名字與調色都是 ABAI 自己的。 */

export interface FilmCamera {
  id: string;
  name: string;
  /** 一行說明（選的時候顯示） */
  note: string;
  evMin: number; evMax: number;
  /** 底片：反差、肩部（從幾格開始彎、最多再多幾格）、趾部（從幾格以下開始彎、最多再暗幾格） */
  gamma: number; knee: number; shoulder: number; toeStart: number; toe: number;
  /** 沖印補償：過曝每格印回幾成、曝光不足救回幾成（正片是 0：過曝就是過曝） */
  printOver: number; printUnder: number;
  chanGamma: [number, number, number];
  shadowTint: [number, number, number]; highlightTint: [number, number, number];
  saturation: number;
  mono?: boolean; monoMix?: [number, number, number];
  /** App 內建的濾鏡檔名（public/luts），空字串＝不套 */
  lut: string; lutAmount: number;
  grain: number; grainSize: number;
  halation: number; vignette: number; softCorners: number;
  /** 閃光燈把近處打到「剛好」再差幾格 */
  flashLevel: number;
  /** 固定焦段（一次性相機的定焦鏡）：只能用 1x、不能捏小框 */
  fixedFocal?: boolean;
}

/** EV（ISO 100）：光圈、快門（秒）、ISO */
const ev = (f: number, t: number, iso: number) => Math.log2((f * f) / t) - Math.log2(iso / 100);

export const FILM_CAMERAS: FilmCamera[] = [
  {
    id: 'disp400', name: '拋棄式 400', note: '固定曝光・晴天最好看，室內要開閃光燈',
    evMin: ev(10, 1 / 125, 400), evMax: ev(10, 1 / 125, 400),
    gamma: 1.0, knee: 2.0, shoulder: 2.5, toeStart: 3.0, toe: 2.6, printOver: 0.6, printUnder: 0.5,
    chanGamma: [0.98, 1.0, 1.05],
    shadowTint: [0.9, 1.05, 0.97], highlightTint: [1.05, 1.0, 0.93],
    saturation: 1.05,
    lut: 'f3.webp', lutAmount: 0.75,
    grain: 0.6, grainSize: 1.1,
    halation: 0.35, vignette: 0.55, softCorners: 0.7,
    flashLevel: -0.3, fixedFocal: true,
  },
  {
    id: 'ps200', name: '傻瓜 200', note: '自動曝光的隨身機・偏暖、顏色飽滿',
    evMin: ev(3.5, 1 / 30, 200), evMax: ev(16, 1 / 500, 200),
    gamma: 1.05, knee: 2.0, shoulder: 2.5, toeStart: 3.0, toe: 2.6, printOver: 0.6, printUnder: 0.5,
    chanGamma: [1.0, 1.0, 1.03],
    shadowTint: [0.96, 1.0, 1.03], highlightTint: [1.04, 1.01, 0.95],
    saturation: 1.05,
    lut: 'f4.webp', lutAmount: 0.75,
    grain: 0.35, grainSize: 1.0,
    halation: 0.2, vignette: 0.3, softCorners: 0.2,
    flashLevel: -0.5,
  },
  {
    id: 'night800', name: '夜拍 800', note: '高感光・粗顆粒、強光暈、偏冷',
    evMin: ev(2.8, 1 / 15, 800), evMax: ev(16, 1 / 1000, 800),
    gamma: 0.95, knee: 2.0, shoulder: 2.6, toeStart: 3.2, toe: 2.6, printOver: 0.6, printUnder: 0.55,
    chanGamma: [1.03, 1.0, 0.97],
    shadowTint: [0.93, 1.0, 1.09], highlightTint: [1.03, 0.99, 0.96],
    saturation: 0.98,
    lut: 'f11.webp', lutAmount: 0.7,
    grain: 0.85, grainSize: 1.3,
    halation: 0.7, vignette: 0.35, softCorners: 0.15,
    flashLevel: -0.6,
  },
  {
    id: 'slide100', name: '日光 100', note: '低感光正片・高反差、顏色濃，寬容度小',
    evMin: ev(2.8, 1 / 60, 100), evMax: ev(22, 1 / 1000, 100),
    gamma: 1.12, knee: 1.6, shoulder: 1.1, toeStart: 2.6, toe: 2.0, printOver: 0, printUnder: 0,
    chanGamma: [1.0, 1.0, 1.0],
    shadowTint: [0.97, 0.98, 1.06], highlightTint: [1.0, 1.0, 1.0],
    saturation: 1.12,
    lut: 'f7.webp', lutAmount: 0.7,
    grain: 0.2, grainSize: 0.85,
    halation: 0.12, vignette: 0.25, softCorners: 0,
    flashLevel: -0.5,
  },
  {
    id: 'bw400', name: '黑白 400', note: '黑白負片・加了黃色濾鏡的層次',
    evMin: ev(2.8, 1 / 30, 400), evMax: ev(16, 1 / 1000, 400),
    gamma: 1.1, knee: 2.0, shoulder: 2.5, toeStart: 3.0, toe: 2.6, printOver: 0.6, printUnder: 0.5,
    chanGamma: [1, 1, 1],
    shadowTint: [1, 1, 1], highlightTint: [1, 1, 1],
    saturation: 1,
    mono: true, monoMix: [0.42, 0.48, 0.1],
    lut: '', lutAmount: 0,
    grain: 0.75, grainSize: 1.15,
    halation: 0.05, vignette: 0.35, softCorners: 0.1,
    flashLevel: -0.5,
  },
];

export const filmCamera = (id: string | null | undefined) => FILM_CAMERAS.find(f => f.id === id) || null;

/** 日期戳記的字：底片相機那種「'25 11 23」 */
export const filmDateText = (d = new Date()) =>
  `'${String(d.getFullYear() % 100).padStart(2, '0')} ${String(d.getMonth() + 1).padStart(2, ' ')} ${String(d.getDate()).padStart(2, '0')}`;

/** 比「剛好」暗這麼多格以上就提示開閃光燈 */
export const LOW_LIGHT_DELTA = -2.3;
