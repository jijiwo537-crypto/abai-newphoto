// 第一次進來時啟用元素，之後不會每次都啟用。這個介面偏好跟作品裡可以復原的開關設定分開存
export function firstTrackingElementVisit(visited, key) {
 if (visited.has(key)) return false;
 visited.add(key);
 return true;
}
export function preciseAngle(value) {
 if (String(value).trim()==='') return null;
 const angle=Number(value);
 return Number.isFinite(angle) ? Math.round(Math.max(0,Math.min(360,angle))) : null;
}
