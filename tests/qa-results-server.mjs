import {createServer} from 'node:http';
createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.method!=='POST'||req.url!=='/results'){res.writeHead(404);res.end();return;}
 let body='',oversized=false;
 req.on('data',chunk=>{if(oversized)return;body+=chunk;if(body.length>256000){oversized=true;body='';res.writeHead(413);res.end();}});
 req.on('end',()=>{
  if(oversized)return;
  try{const r=JSON.parse(body);console.log(JSON.stringify({kind:r.kind,phase:r.phase,pass:r.pass,error:r.error,failures:r.checks?.filter(c=>!c.pass),metrics:r.metrics,samples:r.samples?.map(s=>({kind:s.kind,id:s.id,ms:s.ms,mean:s.mean,max:s.max,releaseMs:s.releaseMs,slowFrames:s.slowFrames}))}));res.end('ok');}
  catch{res.writeHead(400);res.end();}
 });
}).listen(5192,'127.0.0.1',()=>console.log('QA result receiver listening on 5192'));
