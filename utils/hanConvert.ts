/* 文字的簡繁自動轉換：選到「（簡）」字體（只有簡體字身）→ 整段轉簡體；選其他中文字體 → 整段轉繁體（台灣用字）。
   字典（opencc-js）很大，打開文字面板時就在背景先載好，點字體時直接同步轉換，沒有延遲。 */
import { FONTS } from './fonts';

type Conv = (s: string) => string;
let toS: Conv | null = null, toT: Conv | null = null;
let loading: Promise<void> | null = null;

export function preloadHanConvert(): Promise<void> {
  if (!loading) {
    loading = Promise.all([import('opencc-js/t2cn'), import('opencc-js/cn2t')]).then(([a, b]: any[]) => {
      toS = a.Converter({ from: 'tw', to: 'cn' });
      toT = b.Converter({ from: 'cn', to: 'tw' });
    }).catch(() => { loading = null; });
  }
  return loading;
}

/** 這個字體要的字形：'s' 簡體、't' 繁體、null 不是中文字體（不轉） */
export function scriptOfFont(name: string): 's' | 't' | null {
  const f = FONTS.find(x => x.name === name);
  if (!f || f.category !== 'zh') return null;
  return f.label.includes('（簡）') ? 's' : 't';
}

/** 同步轉換；字典還沒載好時回傳 null（呼叫端等 preloadHanConvert 之後再轉） */
export function convertForFontSync(name: string, text: string): string | null {
  const sc = scriptOfFont(name);
  if (!sc || !text) return text;
  const c = sc === 's' ? toS : toT;
  return c ? c(text) : null;
}

export async function convertForFont(name: string, text: string): Promise<string> {
  const r = convertForFontSync(name, text);
  if (r !== null) return r;
  await preloadHanConvert();
  return convertForFontSync(name, text) ?? text;
}
