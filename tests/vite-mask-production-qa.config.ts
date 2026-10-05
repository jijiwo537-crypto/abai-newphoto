import {defineConfig,mergeConfig} from 'vite';
import path from 'node:path';
import base from '../vite.config';
// Production React/runtime, with only the scene's read-only QA measurements.
// This is not the deployment build; none of these QA pages ship to production.
export default defineConfig(env=>mergeConfig(typeof base==='function'?base(env):base,{
 define:{'import.meta.env.DEV':'true'},
 build:{target:'esnext',outDir:'/tmp/abai-v35-production-qa',rollupOptions:{input:{
  masks:path.resolve('backdrop-mask-qa.html'),
  interaction:path.resolve('backdrop-mask-ui-qa.html'),
  photos:path.resolve('creative-photo-qa.html'),
  spatial:path.resolve('photo-spatial-qa.html'),
  seam:path.resolve('creative-seam-qa.html'),
 }}},
 preview:{host:'0.0.0.0',port:5199},
}));
