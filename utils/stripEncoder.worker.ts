/// <reference lib="webworker" />
/* 分段編碼器（背景執行緒）：一次收一段（幾十列）的像素，邊收邊壓，整張圖從頭到尾都不需要放在一張畫布裡。
 * 用在超過手機畫布上限（iPhone 約 1677 萬像素）的原尺寸存檔。
 *
 * JPEG：標準 baseline、4:4:4（色彩不降取樣）、品質可設（存檔用 100）。
 * PNG ：無損；用瀏覽器內建的 CompressionStream('deflate') 串流壓縮。
 *
 * 訊息：{type:'start', fmt, w, h, quality} → 多次 {type:'rows', data(RGBA), rows} → {type:'end'} → 回 {type:'done', blob} */

let enc: { push(d: Uint8ClampedArray, rows: number): void; end(): Promise<Blob> } | null = null;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'start') enc = m.fmt === 'png' ? pngEncoder(m.w, m.h) : jpegEncoder(m.w, m.h, m.quality ?? 100);
    else if (m.type === 'rows') enc!.push(new Uint8ClampedArray(m.data), m.rows);
    else if (m.type === 'end') { const blob = await enc!.end(); enc = null; (self as any).postMessage({ type: 'done', blob }); }
  } catch (err) { (self as any).postMessage({ type: 'error', error: String(err) }); }
};

/* ───────────── JPEG ───────────── */
const ZIGZAG = [0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53,
  10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63];
const STD_Y = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const STD_C = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
// 標準霍夫曼表（ITU T.81 Annex K）
const DC_L_NRC = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], DC_L_VAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_L_NRC = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_L_VAL = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];
const DC_C_NRC = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], DC_C_VAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_C_NRC = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_C_VAL = [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];

/** 霍夫曼碼表：值 → [碼, 長度] */
function huffTable(nrc: number[], vals: number[]): [number, number][] {
  const t: [number, number][] = [];
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let j = 0; j < nrc[len]; j++) { t[vals[k++]] = [code, len]; code++; }
    code <<= 1;
  }
  return t;
}

function jpegEncoder(W: number, H: number, quality: number) {
  const chunks: Uint8Array[] = [];
  let buf = new Uint8Array(1 << 20), pos = 0;
  const flush = () => { if (pos) { chunks.push(buf.slice(0, pos)); pos = 0; } };
  const byte = (b: number) => { if (pos === buf.length) flush(); buf[pos++] = b; };
  const word = (w: number) => { byte((w >> 8) & 255); byte(w & 255); };
  let bitBuf = 0, bitCnt = 0;
  const bits = (code: number, len: number) => {
    // 碼最長 16 位，這裡最多累積 23 位就吐出，不會溢位
    bitBuf = (bitBuf << len) | (code & ((1 << len) - 1)); bitCnt += len;
    while (bitCnt >= 8) {
      const b = (bitBuf >> (bitCnt - 8)) & 255;
      byte(b); if (b === 0xff) byte(0);
      bitCnt -= 8; bitBuf &= (1 << bitCnt) - 1;
    }
  };

  // 量化表（品質 1～100，IJG 的縮放法）
  const q = Math.max(1, Math.min(100, quality)), sf = q < 50 ? 5000 / q : 200 - q * 2;
  const qY = new Int32Array(64), qC = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    qY[ZIGZAG[i]] = Math.max(1, Math.min(255, Math.floor((STD_Y[i] * sf + 50) / 100)));
    qC[ZIGZAG[i]] = Math.max(1, Math.min(255, Math.floor((STD_C[i] * sf + 50) / 100)));
  }
  // AAN 快速 DCT 的縮放併進量化除數
  const aan = [1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.5411961, 0.275899379];
  const fdY = new Float32Array(64), fdC = new Float32Array(64);
  for (let r = 0, k = 0; r < 8; r++) for (let c = 0; c < 8; c++, k++) {
    fdY[k] = 1 / (qY[ZIGZAG[k]] * aan[r] * aan[c] * 8);
    fdC[k] = 1 / (qC[ZIGZAG[k]] * aan[r] * aan[c] * 8);
  }
  const ydc = huffTable(DC_L_NRC, DC_L_VAL), yac = huffTable(AC_L_NRC, AC_L_VAL);
  const cdc = huffTable(DC_C_NRC, DC_C_VAL), cac = huffTable(AC_C_NRC, AC_C_VAL);

  // 檔頭
  word(0xffd8);
  word(0xffe0); word(16); for (const c of [0x4a, 0x46, 0x49, 0x46, 0]) byte(c); byte(1); byte(1); byte(0); word(1); word(1); byte(0); byte(0);
  word(0xffdb); word(132);
  byte(0); for (let i = 0; i < 64; i++) byte(qY[i]);
  byte(1); for (let i = 0; i < 64; i++) byte(qC[i]);
  word(0xffc0); word(17); byte(8); word(H); word(W); byte(3);
  for (const [id, tq] of [[1, 0], [2, 1], [3, 1]]) { byte(id); byte(0x11); byte(tq); }   // 4:4:4
  word(0xffc4); word(0x01a2);
  for (const [cls, nrc, vals] of [[0x00, DC_L_NRC, DC_L_VAL], [0x10, AC_L_NRC, AC_L_VAL], [0x01, DC_C_NRC, DC_C_VAL], [0x11, AC_C_NRC, AC_C_VAL]] as const) {
    byte(cls); for (let i = 1; i <= 16; i++) byte(nrc[i]); for (const v of vals) byte(v);
  }
  word(0xffda); word(12); byte(3);
  byte(1); byte(0x00); byte(2); byte(0x11); byte(3); byte(0x11);
  byte(0); byte(0x3f); byte(0);

  const blk = new Float32Array(64), out = new Int32Array(64);
  const dct = (fd: Float32Array) => {
    const d = blk;
    for (let i = 0; i < 64; i += 8) {
      const t0 = d[i] + d[i + 7], t7 = d[i] - d[i + 7], t1 = d[i + 1] + d[i + 6], t6 = d[i + 1] - d[i + 6];
      const t2 = d[i + 2] + d[i + 5], t5 = d[i + 2] - d[i + 5], t3 = d[i + 3] + d[i + 4], t4 = d[i + 3] - d[i + 4];
      let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
      d[i] = t10 + t11; d[i + 4] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781; d[i + 2] = t13 + z1; d[i + 6] = t13 - z1;
      t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433, z2 = 0.5411961 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      d[i + 5] = z13 + z2; d[i + 3] = z13 - z2; d[i + 1] = z11 + z4; d[i + 7] = z11 - z4;
    }
    for (let i = 0; i < 8; i++) {
      const t0 = d[i] + d[i + 56], t7 = d[i] - d[i + 56], t1 = d[i + 8] + d[i + 48], t6 = d[i + 8] - d[i + 48];
      const t2 = d[i + 16] + d[i + 40], t5 = d[i + 16] - d[i + 40], t3 = d[i + 24] + d[i + 32], t4 = d[i + 24] - d[i + 32];
      let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
      d[i] = t10 + t11; d[i + 32] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781; d[i + 16] = t13 + z1; d[i + 48] = t13 - z1;
      t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433, z2 = 0.5411961 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      d[i + 40] = z13 + z2; d[i + 24] = z13 - z2; d[i + 8] = z11 + z4; d[i + 56] = z11 - z4;
    }
    // 基準 JPEG 的係數範圍：DC 由差值編碼（最多 11 位）、AC 最多 10 位（±1023）
    for (let i = 0; i < 64; i++) { const v = Math.round(d[i] * fd[i]); out[ZIGZAG[i]] = i ? (v > 1023 ? 1023 : v < -1023 ? -1023 : v) : v; }
  };
  const cat = (v: number) => { let a = v < 0 ? -v : v, n = 0; while (a) { n++; a >>= 1; } return n; };
  const pred = [0, 0, 0];
  const encodeBlock = (comp: number, fd: Float32Array, dcT: [number, number][], acT: [number, number][]) => {
    dct(fd);
    const diff = out[0] - pred[comp]; pred[comp] = out[0];
    const dn = cat(diff); bits(dcT[dn][0], dcT[dn][1]); if (dn) bits(diff < 0 ? diff - 1 : diff, dn);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = out[k];
      if (v === 0) { run++; continue; }
      while (run > 15) { bits(acT[0xf0][0], acT[0xf0][1]); run -= 16; }
      const n = cat(v), sym = (run << 4) | n;
      bits(acT[sym][0], acT[sym][1]); bits(v < 0 ? v - 1 : v, n);
      run = 0;
    }
    if (run) bits(acT[0][0], acT[0][1]);
  };

  // 收到的列先湊滿 8 列再編一排區塊
  const band = new Uint8ClampedArray(W * 8 * 4);
  let bandRows = 0, rowsDone = 0;
  const yb = new Float32Array(64), cbB = new Float32Array(64), crB = new Float32Array(64);
  const encodeBand = (rows: number) => {
    for (let bx = 0; bx < W; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const sy = Math.min(y, rows - 1);
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(bx + x, W - 1), o = (sy * W + sx) * 4, r = band[o], g = band[o + 1], b = band[o + 2], k = y * 8 + x;
          yb[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          cbB[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          crB[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      blk.set(yb); encodeBlock(0, fdY, ydc, yac);
      blk.set(cbB); encodeBlock(1, fdC, cdc, cac);
      blk.set(crB); encodeBlock(2, fdC, cdc, cac);
    }
  };
  return {
    push(d: Uint8ClampedArray, rows: number) {
      let r = 0;
      while (r < rows) {
        const take = Math.min(8 - bandRows, rows - r);
        band.set(d.subarray(r * W * 4, (r + take) * W * 4), bandRows * W * 4);
        bandRows += take; r += take;
        if (bandRows === 8) { encodeBand(8); bandRows = 0; rowsDone += 8; }
      }
    },
    async end() {
      if (bandRows) { encodeBand(bandRows); rowsDone += bandRows; bandRows = 0; }
      if (bitCnt) bits(0x7f, 8 - bitCnt);   // 補 1
      word(0xffd9); flush();
      return new Blob(chunks as BlobPart[], { type: 'image/jpeg' });
    },
  };
}

/* ───────────── PNG ───────────── */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(parts: Uint8Array[]) { let c = 0xffffffff; for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const head = new Uint8Array(8), t = new TextEncoder().encode(type);
  new DataView(head.buffer).setUint32(0, data.length); head.set(t, 4);
  const crc = new Uint8Array(4); new DataView(crc.buffer).setUint32(0, crc32([t, data]));
  return [head, data, crc];
}
function pngEncoder(W: number, H: number) {
  const cs = new (self as any).CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const compressed: Uint8Array[] = [];
  const reading = (async () => { const r = cs.readable.getReader(); for (;;) { const { value, done } = await r.read(); if (done) break; compressed.push(value); } })();
  return {
    push(d: Uint8ClampedArray, rows: number) {
      // 每列：濾波類型 1（Sub，跟左邊相減，壓縮比好很多）＋ RGB
      const rowLen = W * 3 + 1, out = new Uint8Array(rowLen * rows);
      for (let y = 0; y < rows; y++) {
        const o = y * rowLen; out[o] = 1;
        let pr = 0, pg = 0, pb = 0;
        for (let x = 0; x < W; x++) {
          const s = (y * W + x) * 4, r = d[s], g = d[s + 1], b = d[s + 2], t = o + 1 + x * 3;
          out[t] = (r - pr) & 255; out[t + 1] = (g - pg) & 255; out[t + 2] = (b - pb) & 255;
          pr = r; pg = g; pb = b;
        }
      }
      writer.write(out);
    },
    async end() {
      await writer.close(); await reading;
      const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
      dv.setUint32(0, W); dv.setUint32(4, H); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
      let n = 0; for (const c of compressed) n += c.length;
      const idat = new Uint8Array(n); let p = 0; for (const c of compressed) { idat.set(c, p); p += c.length; }
      const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunk('IHDR', ihdr), ...chunk('IDAT', idat), ...chunk('IEND', new Uint8Array(0))];
      return new Blob(parts as BlobPart[], { type: 'image/png' });
    },
  };
}
