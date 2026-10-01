export const ASCII_PRESETS=['.:-=+*#/@','·•。○','01','⭒✧✦⭑✶'];
export function withAsciiPreset(settings,characters){return {...settings,characters,...(characters===ASCII_PRESETS[2]?{columns:100}:{})};}
export const ASCII_RANGE_LOWS=[20,20,10,20];
export function withAsciiCoverage(settings,coverage){const low=100-Math.max(0,Math.min(100,coverage)),ranges=[...(settings.ranges||ASCII_RANGE_LOWS)];ranges[settings.metric]=low;return{...settings,low,high:100,ranges};}
export function withAsciiMetric(settings,metric){const ranges=[...(settings.ranges||ASCII_RANGE_LOWS)];ranges[settings.metric]=settings.low;return{...settings,metric,low:ranges[metric],high:100,ranges};}
