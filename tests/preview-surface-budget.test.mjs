import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'abai-surface-budget-'));
try {
  const out = join(dir, 'budget.mjs');
  await build({ entryPoints: ['utils/previewSurfaceBudget.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out });
  const { previewSurfaceDpr, previewEffectLongEdge } = await import(pathToFileURL(out));
  for (const [w, h] of [[500, 667], [2000, 2700], [8000, 11000], [12000, 300]]) {
    const dpr = previewSurfaceDpr(w, h, 8);
    assert.ok(w * dpr <= 4096 && h * dpr <= 4096, `${w}x${h}: edge budget`);
    assert.ok(w * h * dpr * dpr <= 8_000_001, `${w}x${h}: pixel budget`);
  }
  const first = previewSurfaceDpr(2000, 2700, 8);
  const next = previewSurfaceDpr(4000, 5400, 8);
  assert.ok(Math.abs(2000 * first - 4000 * next) < 1, 'large uniform scaling keeps backing width stable');
  assert.equal(previewEffectLongEdge(3000), previewEffectLongEdge(3001), 'large effect texture is not rebuilt each frame');
  assert.equal(previewEffectLongEdge(1e9), 3072, 'effect texture has a fixed upper bound');
  console.log('preview canvas dimensions and stable large-scale textures passed');
} finally { await rm(dir, { recursive: true, force: true }); }
