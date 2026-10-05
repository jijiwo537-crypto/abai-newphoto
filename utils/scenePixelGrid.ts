/** Shared half-open raster boundary. Adjacent scene regions MUST pass their
 * common logical edge here, rather than independently rounding their widths.
 * A pixel belongs to [left,right) exactly when its centre is in that region. */
export function scenePixelEdge(edge:number,scale=1,translation=0):number {
  return Math.ceil(edge*scale+translation-.5);
}
