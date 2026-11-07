// uniform 的反射屬於程式建立時的設定，不在每格的繪製迴圈裡做。用弱參照當鍵，
// context 或程式換掉時位置會自動釋放
const locations=new WeakMap<WebGLProgram,Map<string,WebGLUniformLocation|null>>();
export function uniformLocation(gl:WebGLRenderingContext,program:WebGLProgram,name:string){
 let cache=locations.get(program);if(!cache){cache=new Map();locations.set(program,cache);}
 if(!cache.has(name))cache.set(name,gl.getUniformLocation(program,name));
 return cache.get(name)!;
}
