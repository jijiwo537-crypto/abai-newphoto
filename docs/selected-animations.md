# Selected animation integration

Source: ABAI Effects Lab II, version 20, source commit 51ee4beff4e2503610d892fd49183e9856962fb0.
Recovered locally at /Users/abai/Developer/abai-effects-lab-recovered.

The selected catalog lives in utils/selectedAnimations.ts. Only those 28 IDs are added to the target's animation panel. IDs are prefixed with lab- in persisted motion configurations so existing animation IDs and defaults remain intact.

Cross-page collage preview and export call paintClassicAnimatedVector. Creative collage preview and export call the same drawObject / hole placement pipeline. Text and symbols reuse complete-string shaping and existing glyph-layer geometry; they do not reflow each frame. Pattern wave offsets are applied before connection coordinates are calculated. Pattern glow is reused from the existing cached glow renderer.

The recovery status toast was removed from App.tsx; draft recovery still runs.

Validation: node tests/selected-animations.test.mjs; production Vite build; native iOS build.
