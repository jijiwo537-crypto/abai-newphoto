export function idleDefaults(kind: string, target: { symbol?: boolean; text?: boolean; image?: boolean; shape?: boolean; grid?: boolean; line?: boolean }) {
  if (kind === 'symbol-breathe2') return { amp: 60, speed: 1.2 };
  if (kind === 'image-breathe' && target.image) return { amp: 100, speed: (70 + 70 * 1.8) / 100 };
  if (kind === 'grid-wave') return { amp: target.grid ? 50 : 30, speed: target.shape ? 1.8 : 1.75 };
  return { amp: target.line ? 20 : kind === 'breathe' && target.symbol ? 30 : 50, speed: .9 };
}
