// Run one owned build/test at a time, never kill unrelated apps or services.
// Example: node tests/memory-safe-run.mjs node --test tests/*.test.mjs
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args=process.argv.slice(2);
if(!args.length){console.error('Supply the build/test command.');process.exit(2);}
const lock=join(tmpdir(),'abai-memory-safe-qa.lock');
try{mkdirSync(lock);}catch{console.error('Another guarded task is running (or its lock needs inspection).');process.exit(2);}
const release=()=>{try{rmdirSync(lock);}catch{}};
process.on('exit',release);
const pressure=()=>{
 if(process.platform!=='darwin')throw new Error('This guard requires macOS memory_pressure.');
 const output=execFileSync('/usr/bin/memory_pressure',['-Q'],{encoding:'utf8',timeout:3000});
 const match=output.match(/memory free percentage:\s*(\d+)%/);
 if(!match)throw new Error('Cannot read memory pressure; refusing heavy work.');
 return Number(match[1]);
};
// Conservative early stop, below the user's 6 GB ceiling. RSS does not include
// every compressed/GPU allocation, so retain 1.5 GB of headroom as well as the
// system pressure check. Only stop the task launched by this wrapper.
const taskMemoryMb=()=>{
 const output=execFileSync('/bin/ps',['-axo','rss,comm'],{encoding:'utf8',timeout:3000});
 return output.split('\n').reduce((sum,line)=>{
  if(!/ChatGPT\.app|Simulator\.app|CoreSimulator|\/node(?:\s|$)|\/node_repl(?:\s|$)/.test(line))return sum;
  return sum+(Number(line.trim().split(/\s+/)[0])||0)/1024;
 },0);
};
let free;
try{free=pressure();}catch(error){console.error(error.message);process.exit(2);}
if(free<25){console.error(`Memory reserve ${free}% is below the 25% start threshold.`);process.exit(2);}
if(taskMemoryMb()>=4000){console.error('Task resident memory is above the 4 GB start threshold.');process.exit(2);}
console.log(`Memory reserve ${free}%; starting one guarded task.`);
const child=spawn(args[0],args.slice(1),{stdio:'inherit',detached:true});
let stopped=false;
const stop=(reason)=>{
 if(stopped||!child.pid)return;
 stopped=true;console.error(reason);
 // Only the process group created above, never Codex/browser/user processes.
 try{process.kill(-child.pid,'SIGTERM');}catch{}
};
const timer=setInterval(()=>{
 try{const current=pressure();if(current<20)stop(`Memory reserve fell to ${current}%; stopping this test.`);if(taskMemoryMb()>=4500)stop('Task resident memory reached 4.5 GB; stopping this test before the 6 GB ceiling.');}
 catch(error){stop(error.message);}
},2000);
process.on('SIGINT',()=>stop('Interrupted; stopping this test.'));
process.on('SIGTERM',()=>stop('Terminated; stopping this test.'));
child.on('error',error=>{console.error(error.message);clearInterval(timer);release();process.exitCode=2;});
child.on('exit',(code,signal)=>{clearInterval(timer);release();process.exitCode=stopped?2:code??(signal?1:0);});
