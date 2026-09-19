/** v1 stored a one-logical-pixel spacer between pages. v2 pages share an edge. */
export const CLASSIC_COORDINATE_VERSION = 2;

export function joinLegacyPages<T extends { coordinateVersion?: number; pageWidth?: number;
  pages: unknown[]; floatingImages?: any[]; brushStrokes?: any[] }>(state: T, fallbackWidth: number): T {
  if ((state.coordinateVersion ?? 1) >= CLASSIC_COORDINATE_VERSION) return state;
  const width = state.pageWidth && state.pageWidth > 0 ? state.pageWidth : fallbackWidth;
  if (!(width > 0)) throw new Error('Invalid classic page width');
  const page = (x: number) => Math.max(0, Math.min(state.pages.length - 1, Math.floor(x / (width + 1))));
  return { ...state, coordinateVersion: CLASSIC_COORDINATE_VERSION,
    floatingImages: (state.floatingImages || []).map(f => ({ ...f,
      x: f.x - page(f.x + f.width / 2),
    })),
    brushStrokes: (state.brushStrokes || []).map(s => ({ ...s,
      points: s.points.map((p: any) => ({ ...p, x: p.x - page(p.x) })),
    })),
  };
}
