import { loadCachedLut, saveCachedLut } from './lutStore';

export type CustomLut = { id: string; name: string; url: string };
const KEY = 'abai.editor.customLuts.v1';
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export const loadCustomLuts = (): CustomLut[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is CustomLut =>
      !!v && typeof v.id === 'string' && v.id.startsWith('user-lut-') &&
      typeof v.name === 'string' && v.url === `userlut:${v.id}`) : [];
  } catch { return []; }
};

const nextName = (list: CustomLut[]) => {
  const used = new Set(list.map(x => x.name));
  let n = 1;
  while (used.has(`自訂${n}`)) n++;
  return `自訂${n}`;
};

export const parseCube = (text: string): { data: Uint8ClampedArray; size: number } => {
  let size = 0;
  const values: number[] = [];
  let min = [0, 0, 0], max = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line || /^TITLE\s/i.test(line)) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0].toUpperCase();
    if (tag === 'LUT_3D_SIZE') { size = Number(parts[1]); continue; }
    if (tag === 'LUT_1D_SIZE') throw new Error('目前只支援 3D .cube 濾鏡');
    if (tag === 'DOMAIN_MIN' || tag === 'LUT_3D_INPUT_RANGE') {
      const nums = parts.slice(1).map(Number);
      if (tag === 'DOMAIN_MIN' && nums.length === 3) min = nums;
      else if (tag === 'LUT_3D_INPUT_RANGE' && nums.length === 2) { min = [nums[0], nums[0], nums[0]]; max = [nums[1], nums[1], nums[1]]; }
      continue;
    }
    if (tag === 'DOMAIN_MAX') { const nums = parts.slice(1).map(Number); if (nums.length === 3) max = nums; continue; }
    if (/^[A-Z_]/i.test(tag) && !/^[-+]?\d/.test(tag)) continue;
    if (parts.length < 3) throw new Error('濾鏡資料格式不完整');
    const rgb = parts.slice(0, 3).map(Number);
    if (rgb.some(v => !Number.isFinite(v))) throw new Error('濾鏡包含無效色彩數值');
    values.push(...rgb);
  }
  if (!Number.isInteger(size) || size < 2 || size > 64 || values.length !== size ** 3 * 3)
    throw new Error('請選擇 2～64 階的完整 3D .cube 濾鏡');
  if (min.some((v, i) => !Number.isFinite(v) || !Number.isFinite(max[i]) || max[i] <= v))
    throw new Error('濾鏡的輸入範圍無效');
  const source = new Uint8ClampedArray(values.length);
  for (let i = 0; i < values.length; i++) source[i] = Math.round(Math.max(0, Math.min(1, values[i])) * 255);
  if (min.every(v => v === 0) && max.every(v => v === 1)) return { data: source, size };
  // 將非標準輸入範圍重新取樣成編輯器使用的 0～1 網格。
  const data = new Uint8ClampedArray(source.length);
  const at = (r: number, g: number, b: number, c: number) => source[((b * size + g) * size + r) * 3 + c];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const xyz = [r, g, b].map((v, c) => Math.max(0, Math.min(size - 1, ((v / (size - 1) - min[c]) / (max[c] - min[c])) * (size - 1))));
    const lo = xyz.map(Math.floor), hi = xyz.map(v => Math.min(size - 1, Math.ceil(v))), t = xyz.map((v, c) => v - lo[c]);
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++)
        sum += at(dx ? hi[0] : lo[0], dy ? hi[1] : lo[1], dz ? hi[2] : lo[2], c)
          * (dx ? t[0] : 1 - t[0]) * (dy ? t[1] : 1 - t[1]) * (dz ? t[2] : 1 - t[2]);
      data[((b * size + g) * size + r) * 3 + c] = Math.round(sum);
    }
  }
  return { data, size };
};

const parseAtlas = async (file: File): Promise<{ data: Uint8ClampedArray; size: number }> => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('無法讀取濾鏡圖片')); img.src = url; });
    const size = img.naturalWidth / 8;
    if (img.naturalWidth !== img.naturalHeight || !Number.isInteger(size) || size < 2 || size > 64)
      throw new Error('濾鏡圖片需要是 8×8 方塊排列的正方形 LUT');
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const data = new Uint8ClampedArray(size ** 3 * 3);
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
      const x = (b % 8) * size + r, y = Math.floor(b / 8) * size + g;
      const source = (y * canvas.width + x) * 4, target = ((b * size + g) * size + r) * 3;
      data[target] = pixels[source]; data[target + 1] = pixels[source + 1]; data[target + 2] = pixels[source + 2];
    }
    canvas.width = canvas.height = 0;
    return { data, size };
  } finally { URL.revokeObjectURL(url); }
};

export const importCustomLut = async (file: File, existing: CustomLut[]) => {
  if (file.size > MAX_FILE_BYTES) throw new Error('濾鏡檔超過 32 MB');
  const ext = file.name.split('.').pop()?.toLowerCase();
  const lut = ext === 'cube' ? parseCube(await file.text())
    : ext === 'png' || ext === 'webp' ? await parseAtlas(file)
    : (() => { throw new Error('請選擇 .cube、PNG 或 WebP LUT 檔案'); })();
  const id = `user-lut-${crypto.randomUUID()}`;
  const entry = { id, name: nextName(existing), url: `userlut:${id}` };
  await saveCachedLut(id, entry.url, lut.data, lut.size);
  const check = await loadCachedLut(id, entry.url);
  if (!check) throw new Error('無法儲存濾鏡，請檢查手機可用空間');
  try { localStorage.setItem(KEY, JSON.stringify([...existing, entry])); }
  catch { throw new Error('無法保存濾鏡清單，請檢查手機可用空間'); }
  return { entry, ...lut };
};
