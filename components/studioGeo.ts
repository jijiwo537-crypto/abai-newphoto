/* 人像、仿色照構圖顯示
 *
 * 這兩個工具在「原圖座標」上作畫（筆刷、修補、液化都記在原圖上），構圖（裁切、旋轉、翻轉、
 * 角度、梯形）是存檔時才套上去的 —— 不處理的話工具裡看到的一直是沒構圖的原圖，跟其他分頁、
 * 跟導出的成品對不起來。
 *
 * 做法：工具的畫布照舊是原圖座標，外面包一層用 CSS matrix3d 套上「同一份構圖矩陣」
 * （utils/compose 的 geoHomography，跟存檔走同一份幾何），外框只露出構圖後的範圍；
 * 手指位置用反矩陣換回原圖座標。工具裡的資料、存檔流程完全不動。 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { geoHomography, applyMat3, isGeoIdentity, type GeoParams, type GeoHomography } from '../utils/compose';

export interface StudioGeo {
  gh: GeoHomography | null;
  /** 構圖後外框（不含預覽縮放的版面尺寸）的 ref：拿來量寬度、換算手指座標 */
  boxRef: MutableRefObject<HTMLDivElement | null>;
  /** 包住畫布那一層的樣式（沒有構圖時 undefined） */
  wrapStyle: CSSProperties | undefined;
  /** 外框的比例（沒有構圖時 undefined，用工具原本的） */
  ratio: string | undefined;
  /** 撐開外框用的空白圖（跟構圖後一樣的比例） */
  sizer: string | undefined;
  clientToWork: (cx: number, cy: number) => [number, number] | null;
  workToClient: (x: number, y: number) => [number, number] | null;
}

export function useStudioGeo(geo: GeoParams | null | undefined, W: number, H: number): StudioGeo {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(0);
  const gh = useMemo(() => (geo && W > 0 && H > 0 && !isGeoIdentity(geo) ? geoHomography(W, H, geo) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geo && JSON.stringify(geo), W, H]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !gh) return;
    const upd = () => setBoxW(el.clientWidth);
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gh]);
  const ghRef = useRef(gh); ghRef.current = gh;
  return useMemo(() => {
    let wrapStyle: CSSProperties | undefined, ratio: string | undefined, sizer: string | undefined;
    if (gh) {
      ratio = `${gh.outW}/${gh.outH}`;
      sizer = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${gh.outW}" height="${gh.outH}"/>`)}`;
      const k = boxW > 0 ? boxW / gh.outW : 0;
      if (k > 0) {
        const h = gh.H, n = (v: number) => Number(v.toFixed(9));
        // K·H·K⁻¹（K＝版面縮放），CSS 的 matrix3d 是行優先
        const M = [h[0], h[1], h[2] * k, h[3], h[4], h[5] * k, h[6] / k, h[7] / k, h[8]];
        wrapStyle = {
          position: 'absolute', left: 0, top: 0, width: W * k, height: H * k, transformOrigin: '0 0',
          transform: `matrix3d(${n(M[0])},${n(M[3])},0,${n(M[6])},${n(M[1])},${n(M[4])},0,${n(M[7])},0,0,1,0,${n(M[2])},${n(M[5])},0,${n(M[8])})`,
        };
      } else wrapStyle = { position: 'absolute', left: 0, top: 0, width: 0, height: 0, visibility: 'hidden' };
    }
    const clientToWork = (cx: number, cy: number): [number, number] | null => {
      const g = ghRef.current, el = boxRef.current;
      if (!g || !el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return applyMat3(g.inv, (cx - r.left) * g.outW / r.width, (cy - r.top) * g.outH / r.height);
    };
    const workToClient = (x: number, y: number): [number, number] | null => {
      const g = ghRef.current, el = boxRef.current;
      if (!g || !el) return null;
      const r = el.getBoundingClientRect();
      const [ox, oy] = applyMat3(g.H, x, y);
      return [r.left + ox * r.width / g.outW, r.top + oy * r.height / g.outH];
    };
    return { gh, boxRef, wrapStyle, ratio, sizer, clientToWork, workToClient };
  }, [gh, boxW, W, H]);
}
