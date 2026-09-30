type Point = { x: number; y: number };
export const isIdentityCurve = (points: Point[]) => points.length === 2
  && points[0].x === 0 && points[0].y === 0
  && points[1].x === 255 && points[1].y === 255;

/** Sample the same mapping used by the LUT, including flat endpoint extensions. */
export function boundedCurvePath(points: Point[], sample: (x: number, p: Point[]) => number): string {
  const p = [...points].sort((a, b) => a.x - b.x);
  let path = '';
  for (let step = 0; step <= 400; step++) {
    const x = step / 2;
    const y = 200 - Math.max(0, Math.min(255, sample(x / 200 * 255, p))) / 255 * 200;
    path += `${step ? ' L' : 'M'} ${x} ${y}`;
  }
  return path;
}
