/* 「拼圖」分類：傳統拼圖片。每一邊是 凸(1)／凹(-1)／平(0)，順序上、右、下、左。
   路徑撐滿整個框（凸出去的圓頭也算在框裡），所以框拉多大，拼圖就多大。 */
export const PUZZLE_PIECES: Record<string, [number, number, number, number]> = {
  'puzzle-standard': [-1, 1, -1, 1],   // 標準片
  'puzzle-3out': [1, 1, -1, 1],        // 三凸一凹
  'puzzle-2adj': [1, 1, -1, -1],       // 相鄰兩凸
  'puzzle-1out': [1, -1, -1, -1],      // 一凸三凹
  'puzzle-edge': [-1, 1, 0, 1],          // 邊片
  'puzzle-corner': [1, -1, 0, 0],      // 角片
};
export const isPuzzleKind = (k?: string) => !!k && k in PUZZLE_PIECES;
/** 圓頭凸出去的深度（相對於本體邊長） */
const TAB = 0.30;
/* 一條邊的形狀：從 (0,0) 走到 (1,0)，y 往負是往外凸 */
const C: [number, number][] = [[.35, 0], [.40, 0], [.42, -.05], [.38, -.12], [.33, -.22], [.40, -.30], [.50, -.30],
  [.60, -.30], [.67, -.22], [.62, -.12], [.58, -.05], [.60, 0], [.65, 0]];
/** 高÷寬：讓本體是正方形 */
export const puzzleRatio = (kind: string) => {
  const e = PUZZLE_PIECES[kind]; if (!e) return 1;
  const out = (s: number) => (s > 0 ? TAB : 0);
  return (1 + out(e[0]) + out(e[2])) / (1 + out(e[1]) + out(e[3]));
};
export const puzzlePathD = (kind: string, w: number, h: number) => {
  const e = PUZZLE_PIECES[kind] || PUZZLE_PIECES['puzzle-standard'];
  const out = (s: number) => (s > 0 ? TAB : 0);
  const bw = w / (1 + out(e[1]) + out(e[3])), bh = h / (1 + out(e[0]) + out(e[2]));
  const x0 = out(e[3]) * bw, y0 = out(e[0]) * bh;
  const p: [number, number][] = [[x0, y0], [x0 + bw, y0], [x0 + bw, y0 + bh], [x0, y0 + bh]];
  const f = (n: number) => String(Math.round(n * 1000) / 1000);
  let d = `M ${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 0; i < 4; i++) {
    const P = p[i], Q = p[(i + 1) % 4], s = e[i];
    const dx = Q[0] - P[0], dy = Q[1] - P[1];
    // 外法線（順時針走）：(dy, -dx)，再除以長度後乘回本體邊長，所以只用 dx、dy 就好
    const L = Math.hypot(dx, dy), nx = dy / L, ny = -dx / L;
    /* 凸凹的大小跟著「垂直於這條邊」的本體邊長走，拉扁時圓頭也跟著扁 */
    const depth = i % 2 === 0 ? bh : bw;
    const pt = ([x, y]: [number, number]) => `${f(P[0] + dx * x + nx * -y * s * depth)} ${f(P[1] + dy * x + ny * -y * s * depth)}`;
    if (s) {
      d += ` L ${pt(C[0])}`;
      for (let j = 1; j < C.length; j += 3) d += ` C ${pt(C[j])} ${pt(C[j + 1])} ${pt(C[j + 2])}`;
    }
    d += ` L ${f(Q[0])} ${f(Q[1])}`;
  }
  return d + ' Z';
};

/** 按鈕小圖用：本體方形固定大小 body、置中在 size×size 裡，凸出去的圓頭往外長。
    這樣不管有幾個凸，每顆按鈕中間的方形都一樣大。回傳路徑與位移。 */
export const puzzleGlyph = (kind: string, size: number, body: number) => {
  const e = PUZZLE_PIECES[kind] || PUZZLE_PIECES['puzzle-standard'];
  const out = (v: number) => (v > 0 ? TAB : 0);
  const w = body * (1 + out(e[1]) + out(e[3])), h = body * (1 + out(e[0]) + out(e[2]));
  return { d: puzzlePathD(kind, w, h), x: (size - body) / 2 - out(e[3]) * body, y: (size - body) / 2 - out(e[0]) * body };
};
