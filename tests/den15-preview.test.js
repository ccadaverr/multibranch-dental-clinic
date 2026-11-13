import test from 'node:test'
import assert from 'node:assert/strict'
import {variableValue} from './support/source-behavior.js'
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
function fixture(reply) {
 const scope={signature:'synthetic',pending:false}, live={current:true}, previewContext={current:scope}, updates=[], calls=[]
 const show=variableValue('src/pages/Automations.jsx','show',{
  live,previewContext,scope,commandBusy:'',template:{key:'synthetic',revision:7},dirty:true,draft:{subject:'Reviewed subject',body:'Reviewed body'},
  setErr(){},setPreviewResult:v=>updates.push(v),previewMessageTemplate:(key,body)=>{calls.push({key,body});return reply()},
 },'TemplateEditor')
 return{show,scope,live,previewContext,updates,calls}
}
test('DEN-15 duplicate preview requests capture one exact draft',async()=>{
 const d=deferred(),f=fixture(()=>d.promise);const first=f.show();await f.show();assert.equal(f.calls.length,1)
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{key:'synthetic',body:{subject:'Reviewed subject',body:'Reviewed body'}})
 d.resolve({ok:true,data:{subject:'Reviewed subject',html:'<p>Reviewed body</p>'}});await first
 assert.equal(f.updates.at(-1).pending,false);assert.equal(f.updates.at(-1).data.subject,'Reviewed subject')
})
for(const change of ['new draft','new template revision','A to B to A','unmount']) test('DEN-15 '+change+' ignores pending preview',async()=>{
 const d=deferred(),f=fixture(()=>d.promise);const pending=f.show(),count=f.updates.length
 if(change==='unmount')f.live.current=false;else f.previewContext.current={signature:f.scope.signature,pending:false}
 d.resolve({ok:true,data:{subject:'STALE',html:'<p>STALE</p>'}});await pending;assert.equal(f.updates.length,count)
})
for(const result of [null,{ok:false},{ok:true,data:null},{ok:true,data:{subject:'Valid'}},{ok:true,data:{html:'<p>Valid</p>'}}]) test('DEN-15 incomplete/refused preview never becomes rendered HTML: '+JSON.stringify(result),async()=>{
 const f=fixture(async()=>result);await f.show();assert.equal(f.updates.at(-1).pending,false);assert.equal(f.updates.at(-1).data,null);assert.match(f.updates.at(-1).error,/Preview could not be loaded/)
})
test('DEN-15 thrown transport diagnostics are sanitized and preview is retryable',async()=>{
 let fail=true;const f=fixture(async()=>{if(fail)throw Error('SYNTHETIC_SECRET_SENTINEL');return{ok:true,data:{subject:'Recovered',html:'<p>Recovered</p>'}}})
 await f.show();assert.doesNotMatch(JSON.stringify(f.updates),/SYNTHETIC_SECRET_SENTINEL/);assert.equal(f.scope.pending,false)
 fail=false;await f.show();assert.equal(f.calls.length,2);assert.equal(f.updates.at(-1).data.subject,'Recovered')
})
