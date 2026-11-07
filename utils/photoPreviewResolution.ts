/**
 * 只改幾何時保留已經處理好的照片像素。只有螢幕像素真的需要時才變大，而且絕不超過來源本身。
 * 量化的是快取容量，不是幾何或影像座標
 */
export function photoPreviewCapacity(requested:number, retained:number, sourceSize:number, floor=1600):number {
  const available=Math.max(1,Math.ceil(sourceSize));
  return Math.min(available,Math.max(retained,Math.ceil(Math.max(floor,requested)/256)*256));
}
