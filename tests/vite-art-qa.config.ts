import {defineConfig,mergeConfig} from 'vite';
import base from '../vite.config';
export default defineConfig(env=>mergeConfig(typeof base==='function'?base(env):base,{server:{hmr:false,port:5193}}));
