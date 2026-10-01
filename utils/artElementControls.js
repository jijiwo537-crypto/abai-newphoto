// First visits activate an element, not every subsequent visit. Keep this UI
// preference separate from the artwork's undoable on/off settings.
export function firstTrackingElementVisit(visited, key) {
 if (visited.has(key)) return false;
 visited.add(key);
 return true;
}
export function preciseAngle(value) {
 if (String(value).trim()==='') return null;
 const angle=Number(value);
 return Number.isFinite(angle) ? Math.round(Math.max(0,Math.min(360,angle))*10)/10 : null;
}
