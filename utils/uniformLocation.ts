// Uniform reflection belongs to program setup, not the per-frame render loop.
// Weak keys automatically release locations when a context/program is replaced.
const locations=new WeakMap<WebGLProgram,Map<string,WebGLUniformLocation|null>>();
export function uniformLocation(gl:WebGLRenderingContext,program:WebGLProgram,name:string){
 let cache=locations.get(program);if(!cache){cache=new Map();locations.set(program,cache);}
 if(!cache.has(name))cache.set(name,gl.getUniformLocation(program,name));
 return cache.get(name)!;
}
