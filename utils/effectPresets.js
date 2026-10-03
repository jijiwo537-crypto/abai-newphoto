/** Shared by activation and thumbnails. No separate exaggerated demo settings. */
export const LEGACY_EFFECT_PRESETS = {
 softLight:{soft:100,softThreshold:80},
 halation:{fringeIntensity:100,fringeSize:10,fringeFeather:100,fringeHue:8},
 lightLeak:{leakOpacity:100,leakAngle:45,leakHue:15},
 blur:{blur:40},
 colorNoise:{grain:0,colorNoise:40,colorNoise2:0},
};
export function effectPreset(id,definitions,blur=40){
 if(id==='blur')return {blur};
 if(LEGACY_EFFECT_PRESETS[id])return {...LEGACY_EFFECT_PRESETS[id]};
 const d=definitions.find(d=>d.id===id);
 return d?{...Object.fromEntries(d.params.map(p=>[p.id,p.def])),[d.id]:d.onAmount??100}:{};
}
