/** Only draw a fixed slot boundary when both neighbouring pages are at rest. */
export function settledSortSeams(
  poses: { index: number; x: number; scale: number }[],
  pageWidth: number,
  excluded: number | null,
): number[] {
  const occupied = new Set<number>();
  for (const pose of poses) {
    if (pose.index === excluded || Math.abs(pose.scale - 1) > 1e-6) continue;
    const slot = Math.round(pose.x / pageWidth);
    if (slot < 0 || slot >= poses.length || Math.abs(pose.x - slot * pageWidth) > 1e-6) continue;
    occupied.add(slot);
  }
  return [...occupied].filter(slot => slot > 0 && occupied.has(slot - 1)).sort((a, b) => a - b);
}
