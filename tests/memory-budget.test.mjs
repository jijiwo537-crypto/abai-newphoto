import test from 'node:test';
import assert from 'node:assert/strict';
import {registerBudget,enforceBudget,budgetUsed} from '../utils/memoryBudget.ts';

const holder=(items,evictable=true)=>({
 bytes:()=>items.reduce((n,i)=>n+i.bytes,0),
 oldestIdle:()=>evictable&&items.length?Math.min(...items.map(i=>i.idleAt)):Infinity,
 evictIdle:()=>{if(!evictable||!items.length)return false;const i=items.reduce((a,b)=>a.idleAt<=b.idleAt?a:b);items.splice(items.indexOf(i),1);return true;},
});

test('evicts the longest-idle item across caches until back under budget',()=>{
 const a=[{bytes:40,idleAt:3},{bytes:40,idleAt:1}],b=[{bytes:40,idleAt:2}],pinned=[{bytes:50,idleAt:0}];
 const off=[registerBudget('a',holder(a)),registerBudget('b',holder(b)),registerBudget('pinned',holder(pinned,false))];
 assert.equal(budgetUsed(),170);
 assert.equal(enforceBudget(100),2);
 assert.deepEqual(a.map(i=>i.idleAt),[3]);
 assert.equal(b.length,0);
 assert.equal(pinned.length,1,'items in use are never evicted');
 off.forEach(f=>f());
});

test('stops when nothing idle is left, even if still over budget',()=>{
 const pinned=[{bytes:500,idleAt:0}];
 const off=registerBudget('pinned',holder(pinned,false));
 assert.equal(enforceBudget(100),0);
 assert.equal(budgetUsed(),500);
 off();
});
