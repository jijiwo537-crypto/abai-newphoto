/* 點陣文字「線稿版」在背景執行緒算：疊線 → 黑色擴張 → 明暗門檻 → 點字。
   主畫面完全不卡（拖輪廓滑桿時滑桿照樣順），而且閒下來時先把目前輪廓值的前後幾格算好，
   下一格拖到時直接拿現成的。演算法跟主畫面是同一份（dotArtCore），結果逐字相同。 */
import { canvas, ctx2d, overlayLines, erodedLuma, thresholdEroded, toBraille, type Cvs, type Eroded } from './dotArtCore';

interface Job { id: number; lines: number; thicken: number; level: number; width: number }

let base: Cvs | null = null, la: Cvs | null = null;
const pre = new Map<number, Cvs>();
const eroded = new Map<string, Eroded>();
const braille = new Map<string, string[]>();
let job: Job | null = null, spec: { lines: number; thicken: number }[] = [], scheduled = false, lastLines = -1;

/** 最近用的排到最後；超過上限就丟最舊的（畫布順便還額度） */
const touch = <K, V>(m: Map<K, V>, k: K, v: V, max: number, free?: (v: V) => void) => {
  m.delete(k); m.set(k, v);
  while (m.size > max) { const [ok, ov] = m.entries().next().value as [K, V]; m.delete(ok); free?.(ov); }
};
const fromBitmap = (b: ImageBitmap) => { const c = canvas(b.width, b.height); ctx2d(c).drawImage(b, 0, 0); b.close(); return c; };

function erodedFor(lines: number, thicken: number): Eroded {
  const k = `${lines}|${thicken}`;
  let e = eroded.get(k);
  if (e) { touch(eroded, k, e, 6); return e; }
  let p = pre.get(lines);
  if (!p) { p = overlayLines(base!, la, lines); }
  touch(pre, lines, p, 3, c => { c.width = c.height = 0; });
  e = erodedLuma(p, thicken);
  touch(eroded, k, e, 6);
  return e;
}

function run() {
  scheduled = false;
  if (!base) return;
  if (job) {
    const j = job; job = null;
    try {
      const k = `${j.lines}|${j.thicken}|${j.level}|${j.width}`;
      let full = braille.get(k);
      if (!full) {
        const img = thresholdEroded(erodedFor(j.lines, j.thicken), j.level);
        full = toBraille(img, 128, j.width);
        img.width = img.height = 0;
      }
      touch(braille, k, full, 48);
      (self as any).postMessage({ id: j.id, ok: true, full });
      // 往剛剛拖的方向多算兩格、反方向一格
      const dir = lastLines < 0 || j.lines >= lastLines ? 1 : -1;
      lastLines = j.lines;
      spec = [j.lines + dir, j.lines + 2 * dir, j.lines - dir]
        .filter(l => l >= 0 && l <= 20 && (l === 0 || la))
        .map(l => ({ lines: l, thicken: j.thicken }));
    } catch (e) { (self as any).postMessage({ id: j.id, ok: false, error: String(e) }); }
  } else if (spec.length) {
    const s = spec.shift()!;
    try { erodedFor(s.lines, s.thicken); } catch { spec = []; }
  }
  if (job || spec.length) schedule();
}
const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(run, 0); } };

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    base = fromBitmap(m.base); la = null; lastLines = -1;
    pre.forEach(c => { c.width = c.height = 0; }); pre.clear(); eroded.clear(); braille.clear(); spec = [];
    (self as any).postMessage({ id: m.id, ok: true });
  } else if (m.type === 'lineArt') {
    la = fromBitmap(m.la);
    // 之前是「不疊線」的結果，疊線之後全部要重算
    pre.forEach((c, k) => { if (k > 0) { c.width = c.height = 0; pre.delete(k); } });
    eroded.forEach((_, k) => { if (!k.startsWith('0|')) eroded.delete(k); });
    braille.forEach((_, k) => { if (!k.startsWith('0|')) braille.delete(k); });
    (self as any).postMessage({ id: m.id, ok: true });
  } else if (m.type === 'render') {
    if (job) (self as any).postMessage({ id: job.id, ok: true, skipped: true });   // 被更新的值取代
    job = m; schedule();
  }
};
