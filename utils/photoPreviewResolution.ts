/** Keep already processed photo pixels through geometry-only edits. Grow only
 * when screen pixels actually require it, and never exceed the source itself.
 * Quantization is of cache capacity, not of geometry or image coordinates. */
export function photoPreviewCapacity(requested:number, retained:number, sourceSize:number, floor=1600):number {
  const available=Math.max(1,Math.ceil(sourceSize));
  return Math.min(available,Math.max(retained,Math.ceil(Math.max(floor,requested)/256)*256));
}
