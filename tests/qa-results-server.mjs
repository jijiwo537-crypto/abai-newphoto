// Local-only regression collector; never included in the production bundle.
import http from 'node:http';
import {appendFileSync} from 'node:fs';
const file=process.argv[2]||'/tmp/abai-qa-results.ndjson';
http.createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS'){res.end();return;}
 if(req.method!=='POST'||req.url!=='/results'){res.writeHead(404);res.end();return;}
 let body='';req.on('data',chunk=>{body+=chunk;if(body.length>2_000_000)req.destroy();});
 req.on('end',()=>{try{const report=JSON.parse(body);appendFileSync(file,JSON.stringify(report)+'\n');res.end('ok');console.log(report.kind,report.pass??report.passed??'received');}catch{res.writeHead(400);res.end();}});
}).listen(5192,'127.0.0.1',()=>console.log('QA collector listening 5192'));
