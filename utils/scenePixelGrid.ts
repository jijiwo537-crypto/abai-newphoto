/**
 * 共用的半開區間點陣邊界。相鄰的場景區域「一定」要把共用的邏輯邊緣交給這裡，不能各自取整寬度。
 * 像素中心落在 [left,right) 裡，這個像素才屬於那個區域
 */
export function scenePixelEdge(edge:number,scale=1,translation=0):number {
  return Math.ceil(edge*scale+translation-.5);
}
