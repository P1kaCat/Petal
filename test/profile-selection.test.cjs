const test=require('node:test');
const assert=require('node:assert/strict');
const {LatestSelection}=require('../src/profile-selection.js');
test('a delayed older loader response never replaces the newest version selection',async()=>{
  const resolvers=new Map(),rendered=[];
  const selection=new LatestSelection(v=>new Promise(resolve=>resolvers.set(v,resolve)),v=>rendered.push(v));
  const old=selection.select('24w14a'),latest=selection.select('1.21.1');
  resolvers.get('1.21.1')({choices:[{id:'fabric',version:'0.16.9'}]});await latest;
  resolvers.get('24w14a')({choices:[{id:'vanilla',version:'24w14a'}]});await old;
  assert.equal(rendered.length,1);assert.equal(rendered[0].version,'1.21.1');
  assert.equal(rendered[0].data.choices[0].id,'fabric');
});
test('an obsolete failure is ignored while the active request reports its error',async()=>{
  const rejectors=new Map(),rendered=[];
  const selection=new LatestSelection(v=>new Promise((resolve,reject)=>rejectors.set(v,reject)),v=>rendered.push(v));
  const old=selection.select('old'),latest=selection.select('new');
  rejectors.get('old')(new Error('old outage'));await old;assert.equal(rendered.length,0);
  rejectors.get('new')(new Error('current outage'));await latest;
  assert.equal(rendered[0].error,'current outage');
});
