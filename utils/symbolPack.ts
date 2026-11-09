/* 「新增符號」自動排列（排序工具用）。
 *
 * 為什麼要在手機上算：每顆符號的寬度取決於字型。iPhone 用 PingFang，電腦沒有，
 * 在電腦上量好的寬度拿到 iPhone 上會差幾點 —— 原本剛好擠滿的一排就會把最後一顆擠到下一排，
 * 變成「一排只有一顆短符號、右邊空一大塊」。所以寬度一律用這台手機上實際畫出來的按鈕寬度。
 *
 * 規則：
 *  - 由上到下：一般符號 → 顏文字 → 邊框（邊框越長越下面）。
 *  - 每一排盡量排滿：同一區先用「最佳適配」裝箱，再隨機擾動幾千次挑空白最少的。
 *  - 顏文字一定集中在一起，中間不插別的符號。
 *  - 邊框排完還有一大塊空白的排（> fillOver），從一般符號裡挑剛好放得下的補上。
 *  - 最後用跟瀏覽器一樣的「由左到右、放不下就換行」模擬一次，確認排出來就是算的樣子。 */

export interface PackInput {
  /** 每顆的按鈕寬度（實際畫出來的，含內距與外框） */
  widths: number[];
  /** 每顆屬於哪一區：0＝一般、1＝顏文字、2＝邊框 */
  group: number[];
  /** 一排可用的寬度 */
  cap: number;
  /** 按鈕之間的間距 */
  gap: number;
  /** 邊框／顏文字的排，空白超過這麼多才拿一般符號去補 */
  fillOver?: number;
  tries?: number;
}

export function packSymbols(o: PackInput): { order: number[]; rowGaps: number[] } {
  const { widths: w, group, gap: G } = o;
  /* 留 2 點的安全邊：小數點的進位差，不會因為差 0.5 點就整顆被擠下去 */
  const CAP = o.cap - 2;
  const fillOver = o.fillOver ?? 75, tries = o.tries ?? 1500;
  const ids = w.map((_, i) => i);
  const used = (r: number[]) => r.reduce((s, i) => s + w[i], 0) + G * (r.length - 1);
  const room = (r: number[]) => CAP - used(r);
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const bestFit = (items: number[]) => {
    const bins: number[][] = [];
    for (const i of items) {
      let best: number[] | null = null, bl = Infinity;
      for (const b of bins) { const l = room(b) - G - w[i]; if (l >= 0 && l < bl) { bl = l; best = b; } }
      if (best) best.push(i); else bins.push([i]);
    }
    return bins;
  };
  const search = (list: number[]) => {
    if (!list.length) return [] as number[][];
    let best: number[][] = [], bc = Infinity;
    for (let t = 0; t < tries; t++) {
      const items = list.slice().sort((a, b) => (w[b] - w[a]) * (1 + (t ? 0.4 * (rnd() - 0.5) : 0)));
      const bins = bestFit(items);
      // 空白取平方：寧可每排都差一點，也不要有一排空很大；排數也算成本（越少越好）
      const c = bins.reduce((s, r) => s + Math.max(0, room(r)) ** 2, 0) + bins.length * 3000;
      if (c < bc) { bc = c; best = bins.map(r => r.slice()); }
    }
    return best;
  };
  let plain = ids.filter(i => group[i] === 0);
  const brows = search(ids.filter(i => group[i] === 2));
  const krows = search(ids.filter(i => group[i] === 1));
  const fill = (rows: number[][]) => {
    for (const r of rows.slice().sort((a, b) => room(b) - room(a))) {
      if (room(r) <= fillOver) continue;
      for (;;) {
        let pick = -1, pw = -1;
        for (const i of plain) if (w[i] + G <= room(r) && w[i] > pw) { pw = w[i]; pick = i; }
        if (pick < 0) break;
        r.push(pick); plain = plain.filter(i => i !== pick);
      }
    }
  };
  /* 顏文字一定要排在一起：只拿一般符號去補邊框的排，顏文字的排不插別的符號 */
  fill(brows);
  const prows = search(plain);
  const widest = (r: number[], g?: number) => Math.max(...r.filter(i => g === undefined || group[i] === g).map(i => w[i]));
  prows.sort((a, b) => widest(a) - widest(b));
  krows.sort((a, b) => widest(a, 1) - widest(b, 1));
  brows.sort((a, b) => widest(a, 2) - widest(b, 2));
  // 每一排：本區的放前面（由短到長），補進來的一般符號放後面
  const inRow = (r: number[], g?: number) => r.sort((a, b) => (g === undefined ? 0 : Number(group[b] === g) - Number(group[a] === g)) || w[a] - w[b]);
  prows.forEach(r => inRow(r)); krows.forEach(r => inRow(r, 1)); brows.forEach(r => inRow(r, 2));
  const order = [...prows, ...krows, ...brows].flat();
  // 用瀏覽器的換行規則模擬，回報每一排右邊剩多少
  const rowGaps: number[] = [];
  let line = 0, n = 0;
  for (const i of order) {
    if (n && line + G + w[i] > o.cap) { rowGaps.push(o.cap - line); line = w[i]; n = 1; }
    else { line = n ? line + G + w[i] : w[i]; n++; }
  }
  if (n) rowGaps.push(o.cap - line);
  return { order, rowGaps };
}
