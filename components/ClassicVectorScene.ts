/** One coordinate system and one screen-density surface per stacking run.
 * Interaction DOM is deliberately not used to measure or place object ink.
 * Pinch, scroll and animation all repaint the same logical scene coordinates.
 */
export type SceneEntry = {
  z: number;
  opacity?: number | (() => number);
  animateUntil?: number;
  paint: (ctx: CanvasRenderingContext2D, pixelsPerUnit: number) => void;
};

export class ClassicVectorScene {
  private entries = new Map<string, SceneEntry>();
  private surfaces: HTMLCanvasElement[] = [];
  private host: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;
  private frame = 0;
  private alphaSurface: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private scale = () => 1;

  attach(host: HTMLElement, viewport: HTMLElement, scale: () => number) {
    this.detach();
    this.host = host;
    this.viewport = viewport;
    this.scale = scale;
    viewport.addEventListener('scroll', this.invalidate, { passive: true });
    // Geometry changes must repaint before the same frame is composited. Queuing
    // another rAF here leaves the old inverse scale visible for one frame.
    host.parentElement?.addEventListener('abai-preview-transform', this.flush);
    this.observer = new ResizeObserver(this.invalidate);
    this.observer.observe(viewport);
    this.invalidate();
    return () => this.detach();
  }

  set(id: string, entry: SceneEntry) {
    this.entries.set(id, entry);
    this.invalidate();
  }

  remove(id: string) {
    this.entries.delete(id);
    this.invalidate();
  }

  invalidate = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.draw);
  };

  flush = () => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.draw();
  };

  private detach() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.viewport?.removeEventListener('scroll', this.invalidate);
    this.host?.parentElement?.removeEventListener('abai-preview-transform', this.flush);
    this.observer?.disconnect();
    this.surfaces.forEach(canvas => { canvas.remove(); canvas.width = canvas.height = 1; });
    this.surfaces = [];
    if (this.alphaSurface) this.alphaSurface.width = this.alphaSurface.height = 1;
    this.alphaSurface = null;
    this.host = this.viewport = null;
  }

  private draw = () => {
    this.frame = 0;
    const host = this.host, viewport = this.viewport;
    if (!host || !viewport) return;
    const k = Math.max(.0001, this.scale());
    const hr = host.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    // Keep the same supersampling during gestures, animation and at rest.
    const dpr = Math.max(1, window.devicePixelRatio || 1) * 1.5;
    // Constant screen-sized backing stores, never object-sized textures. A large
    // object therefore does not allocate a huge bitmap or change resolution on up.
    const w = Math.max(1, Math.ceil(vr.width + 64));
    const h = Math.max(1, Math.ceil(vr.height + 64));
    const x = (vr.left - hr.left - 32) / k;
    const y = (vr.top - hr.top - 32) / k;
    const entries = [...this.entries.values()].sort((a, b) => a.z - b.z);
    const barriers = [...host.children, ...host.querySelectorAll('[data-layout-wrapper]')]
      .filter(node => !(node instanceof HTMLCanvasElement && node.dataset.classicScene))
      .filter(node => !(node as HTMLElement).dataset.classicSceneHit)
      .map(node => Number((node as HTMLElement).style.zIndex)).filter(Number.isFinite);
    const runs: SceneEntry[][] = [];
    for (const entry of entries) {
      const run = runs[runs.length - 1];
      if (!run || barriers.some(z => z > run[run.length - 1].z && z <= entry.z)) runs.push([entry]);
      else run.push(entry);
    }
    while (this.surfaces.length > runs.length) {
      const canvas = this.surfaces.pop()!;
      canvas.remove(); canvas.width = canvas.height = 1;
    }
    runs.forEach((run, i) => {
      let canvas = this.surfaces[i];
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.dataset.classicScene = String(i);
        canvas.style.cssText = 'position:absolute;pointer-events:none;transform-origin:0 0;max-width:none;';
        host.appendChild(canvas);
        this.surfaces[i] = canvas;
      }
      canvas.style.left = `${x}px`;
      canvas.style.top = `${y}px`;
      // Give the bitmap its final on-screen dimensions through layout, not a
      // second compositing transform. In WebKit, zoom + inverse transform can
      // rasterize the bitmap at the intermediate (especially smaller) size.
      canvas.style.width = `${w / k}px`;
      canvas.style.height = `${h / k}px`;
      canvas.style.transform = 'none';
      canvas.style.zIndex = String(run[0].z);
      const pw = Math.ceil(w * dpr), ph = Math.ceil(h * dpr);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      // CSS layout is rounded by WebKit; map the actual surface rectangle back
      // onto scene coordinates instead of assuming requested CSS values stuck.
      const rect = canvas.getBoundingClientRect();
      const sx = pw / Math.max(.0001, rect.width);
      const sy = ph / Math.max(.0001, rect.height);
      const matrix: [number, number, number, number, number, number] =
        [sx * k, 0, 0, sy * k, (hr.left - rect.left) * sx, (hr.top - rect.top) * sy];
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pw, ph);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(...matrix);
      for (const entry of run) {
        const opacity = Math.max(0, Math.min(1,
          typeof entry.opacity === 'function' ? entry.opacity() : entry.opacity ?? 1));
        if (opacity === 0) continue;
        ctx.save();
        if (opacity < 1) {
          const scratch = this.alphaSurface ?? (this.alphaSurface = document.createElement('canvas'));
          if (scratch.width !== pw) scratch.width = pw;
          if (scratch.height !== ph) scratch.height = ph;
          const sg = scratch.getContext('2d')!;
          sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, pw, ph);
          sg.save();
          sg.setTransform(...matrix);
          entry.paint(sg, dpr * k);
          sg.restore();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = opacity;
          ctx.drawImage(scratch, 0, 0);
        } else entry.paint(ctx, dpr * k);
        ctx.restore();
      }
    });
    if (entries.some(entry => (entry.animateUntil ?? 0) > performance.now())) this.invalidate();
  };
}
