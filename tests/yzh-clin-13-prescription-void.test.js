// CLIN-13: actual pre-JSX dialog/controller code and isolated hook cells.
// Synthetic transport only; React/modal behavior is verified separately in MCP.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {setImmediate} from 'node:timers/promises'
const source=readFileSync(new URL('../src/pages/ServerPrescriptions.jsx',import.meta.url),'utf8').replaceAll('\r\n','\n')
const prefix=source.slice(source.indexOf('const firstError'),source.indexOf('const TONE'))+"\nconst TONE={Draft:'draft',Issued:'issued',Void:'void'};\n"
const modern=source.includes('function PrescriptionDialogBody(')
const helperStart=source.indexOf('const rxVoidLedgers')
const helpers=helperStart<0?'':source.slice(helperStart,source.indexOf('export function PrescriptionDialog(',helperStart)).replace('const rxVoidLedgers = new WeakMap()','')
const sharedLedgers=new WeakMap()
const bodyStart=source.indexOf(modern?'function PrescriptionDialogBody(':'export function PrescriptionDialog(')
const bodyEnd=source.indexOf('  return <Modal',bodyStart)
assert(bodyStart>0&&bodyEnd>bodyStart,'Review prescription dialog extraction after source changes')
const bodyCode=source.slice(bodyStart,bodyEnd).replace('export function','function')+"return {p,error,reason,voiding,busy,doVoid,setReason,setVoiding,reload:typeof reload==='function'?reload:null,voidError:typeof voidError==='undefined'?'':voidError};\n}\n"+(modern?'PrescriptionDialogBody':'PrescriptionDialog')
const outerStart=source.indexOf('export function PrescriptionDialog('),outerEnd=source.indexOf('  return <PrescriptionDialogBody',outerStart)
const outerCode=modern?source.slice(outerStart,outerEnd).replace('export function','function')+'return {key:scope.key,isCurrent,dismiss,ledger};\n}\nPrescriptionDialog':null
const wire=v=>JSON.parse(JSON.stringify(v))
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const issued=(id='A',extra={})=>({id,number:'RX-SYNTHETIC-'+id,status:'Issued',revision:2,patient:{id:'patient-'+id,name:'Synthetic '+id},visit:'visit-'+id,branch:'Synthetic branch',dentist:'Synthetic dentist',can_void:true,can_edit:false,voided:null,lines:[],...extra})
const voided=(id='A',extra={})=>issued(id,{status:'Void',revision:3,can_void:false,voided:{at:'2026-11-10T14:00:00Z',reason:'Synthetic correction'},...extra})
const ok=data=>({ok:true,data})
const defaultAuth=()=>1
function hooks(code,api){
 const cells=[],passive=[],layout=[];let cursor=0,value
 const useState=initial=>{const i=cursor++;cells[i]??={value:typeof initial==='function'?initial():initial};return [cells[i].value,next=>{cells[i].value=typeof next==='function'?next(cells[i].value):next}]}
 const useRef=initial=>{const i=cursor++;cells[i]??={value:{current:initial}};return cells[i].value}
 const effect=(run,deps,queue=passive)=>{const i=cursor++,old=cells[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){old?.cleanup?.();cells[i]={deps};queue.push(()=>{cells[i].cleanup=run()})}}
 const useLayoutEffect=(run,deps)=>effect(run,deps,layout)
 const component=runInNewContext(prefix+helpers+code,{useState,useRef,useEffect:effect,useLayoutEffect,React:{useState,useRef,useEffect:effect,useLayoutEffect},rxVoidLedgers:sharedLedgers,...api})
 return {render(props){cursor=0;value=component(props);for(const run of layout.splice(0))run();for(const run of passive.splice(0))run();return value},unmount(){for(const cell of cells)cell?.cleanup?.()}}
}
function dialog({respond=async()=>ok(voided()),read=async id=>ok(issued(id)),auth=()=>1}={}){
 const calls=[],reads=[],feedback=[],changed=[],closed=[]
 const api={prescription:id=>{reads.push(id);return read(id)},voidPrescription:(id,reason)=>{calls.push({id,reason});return respond(id,reason)}}
 let props={id:'A',getAuthGeneration:auth,toast:(...args)=>feedback.push(args),onChanged:()=>changed.push(true),onClose:()=>closed.push(true)},body,outer,key,value
 const root=outerCode?hooks(outerCode,api):null
 const render=patch=>{props={...props,...patch};outer=root?.render(props)
  if(!body||outer&&outer.key!==key){body?.unmount();body=hooks(bodyCode,api);key=outer?.key}
  value=body.render({...props,...(outer?{ledger:outer.ledger,isCurrent:outer.isCurrent,onClose:outer.dismiss}:{})});return value}
 render()
 return {render,calls,reads,feedback,changed,closed,get value(){return value},async flush(){await setImmediate();return render()},fill(){value.setReason('  Synthetic correction  ');value.setVoiding(true);render()},close(){(outer?.dismiss||props.onClose)()},unmount(){body.unmount();root?.unmount()}}
}

test('CLIN-13 same-tick duplicate Void dispatches one original command',async()=>{
 const held=deferred(),d=dialog({respond:()=>held.promise});await d.flush();d.fill()
 const command=d.value.doVoid();const duplicate=d.value.doVoid();assert.equal(d.calls.length,1)
 held.resolve(ok(voided()));await Promise.all([command,duplicate]);assert.deepEqual(d.calls,[{id:'A',reason:'Synthetic correction'}]);d.unmount()
})
test('CLIN-13 rejected Void releases busy and reports uncertainty without blindly retrying',async()=>{
 const d=dialog({respond:async()=>{throw Error('Synthetic network outage')}});await d.flush();d.fill()
 await assert.doesNotReject(()=>d.value.doVoid());d.render();assert.equal(d.value.busy,false);assert.match(d.value.voidError||d.value.error,/confirm|Reload/i)
 await d.value.doVoid();assert.equal(d.calls.length,1);d.unmount()
})
test('CLIN-13 mismatched success ID never replaces the submitted prescription',async()=>{
 const d=dialog({respond:async()=>ok(voided('B'))});await d.flush();d.fill();await d.value.doVoid();d.render()
 assert.equal(d.value.p.id,'A');assert.deepEqual(d.feedback,[]);assert.equal(d.changed.length,0);d.unmount()
})
test('CLIN-13 A -> B -> A cannot adopt the original Void completion',async()=>{
 const held=deferred(),d=dialog({respond:()=>held.promise});await d.flush();d.fill();const command=d.value.doVoid()
 d.render({id:'B'});await d.flush();d.render({id:'A'});await d.flush()
 held.resolve(ok(voided()));await command;await d.flush();assert.deepEqual(d.feedback,[]);assert.equal(d.changed.length,0);assert.equal(d.value.p,null);assert.match(d.value.error,/verified state/);d.unmount()
})
test('CLIN-13 dismissal invalidates completion synchronously before unmount cleanup',async()=>{
 const held=deferred(),d=dialog({respond:()=>held.promise});await d.flush();d.fill();const command=d.value.doVoid();d.close()
 held.resolve(ok(voided()));await command;assert.equal(d.closed.length,1);assert.deepEqual(d.feedback,[]);assert.equal(d.changed.length,0);d.unmount()
})
test('CLIN-13 same-account auth generation replacement suppresses Void adoption',async()=>{
 let generation=1;const held=deferred(),d=dialog({auth:()=>generation,respond:()=>held.promise});await d.flush();d.fill();const command=d.value.doVoid()
 generation=2;held.resolve(ok(voided()));await command;assert.deepEqual(d.feedback,[]);assert.equal(d.changed.length,0);d.unmount()
})
test('CLIN-13 wrong prescription detail ID is an unavailable view',async()=>{
 const d=dialog({read:async()=>ok(issued('B'))});await d.flush();assert.equal(d.value.p,null);assert.ok(d.value.error);d.unmount()
})

for(const patch of [{status:'Issued'},{revision:2},{revision:null},{patient:{id:'other'}},{visit:'other'},{number:'other'},{can_void:true},{voided:null},{voided:{at:'synthetic',reason:'Different reason'}}])test('CLIN-13 rejects unexpected Void response '+JSON.stringify(patch),async()=>{
 const d=dialog({respond:async()=>ok(voided('A',patch))});await d.flush();d.fill();await d.value.doVoid();d.render()
 assert.equal(d.value.p.status,'Issued');assert.equal(d.value.busy,false);assert.deepEqual(d.feedback,[]);assert.equal(d.changed.length,0);assert.match(d.value.voidError,/could not be confirmed/)
 await d.value.doVoid();assert.equal(d.calls.length,1);d.unmount()
})
for(const result of [{ok:false,kind:'network'},{ok:false,kind:'server'},null])test('CLIN-13 uncertain Void remains protected after an unchanged authoritative read '+JSON.stringify(result),async()=>{
 const d=dialog({respond:async()=>result});await d.flush();d.fill();await d.value.doVoid();d.render();assert.equal(d.value.busy,false)
 await d.value.reload();d.render();await d.value.doVoid();assert.equal(d.calls.length,1);assert.deepEqual(d.feedback,[]);d.unmount()
})
for(const kind of ['validation','forbidden'])test('CLIN-13 confirmed '+kind+' refusal preserves reason and releases the pending latch',async()=>{
 let result={ok:false,kind,message:'Synthetic refusal'};const d=dialog({respond:async()=>result});await d.flush();d.fill();await d.value.doVoid();d.render()
 assert.equal(d.value.busy,false);assert.equal(d.value.reason,'  Synthetic correction  ');assert.match(d.value.voidError,/Synthetic refusal/)
 result=ok(voided());await d.value.doVoid();d.render();assert.equal(d.calls.length,2);assert.equal(d.feedback.length,1);assert.equal(d.value.p.status,'Void');d.unmount()
})
test('CLIN-13 valid Void success adopts exact identity and cannot replay its old command closure',async()=>{
 const d=dialog();await d.flush();d.fill();const old=d.value.doVoid;await old();d.render()
 assert.equal(d.value.p.id,'A');assert.equal(d.value.p.status,'Void');assert.equal(d.value.p.revision,3);assert.equal(d.feedback.length,1);assert.equal(d.changed.length,1);await old();assert.equal(d.calls.length,1);d.unmount()
})
test('CLIN-13 recovery requires a matching positive Void record, and refreshes without a success claim',async()=>{
 let record=issued();const d=dialog({respond:async()=>({ok:false,kind:'network'}),read:async()=>ok(record)});await d.flush();d.fill();await d.value.doVoid();d.render()
 record=voided();await d.value.reload();d.render();assert.equal(d.value.p.status,'Void');assert.deepEqual(d.feedback,[]);assert.equal(d.changed.length,1);await d.value.doVoid();assert.equal(d.calls.length,1);d.unmount()
})
test('CLIN-13 failed and malformed recovery do not release the unknown Void operation',async()=>{
 let result=ok(issued());const d=dialog({respond:async()=>({ok:false,kind:'network'}),read:async()=>result});await d.flush();d.fill();await d.value.doVoid();d.render()
 for(const response of [{ok:false,kind:'server',message:'Synthetic outage'},null,ok(voided('B')),ok(issued())]){result=response;await d.value.reload();d.render();await d.value.doVoid();assert.equal(d.calls.length,1)}d.unmount()
})
test('CLIN-13 pending Void survives close/reopen in the same provider lifetime',async()=>{
 const held=deferred(),auth=()=>1,old=dialog({auth,respond:()=>held.promise});await old.flush();old.fill();const command=old.value.doVoid();old.close();old.unmount()
 const next=dialog({auth});await next.flush();next.fill();await next.value.doVoid();assert.equal(next.calls.length,0)
 held.resolve(ok(voided()));await command;await next.flush();assert.deepEqual(old.feedback,[]);assert.equal(next.calls.length,0);next.unmount()
})
test('CLIN-13 read initiated before Void settlement cannot restore an old Issued projection',async()=>{
 const read=deferred(),write=deferred();let initial=true;const d=dialog({read:async()=>initial?ok(issued()):read.promise,respond:()=>write.promise});await d.flush();d.fill();const command=d.value.doVoid()
 initial=false;const loading=d.value.reload();write.resolve({ok:false,kind:'network'});await command;read.resolve(ok(issued()));await loading;d.render()
 assert.equal(d.value.p,null);assert.match(d.value.error,/settled after/);await d.value.doVoid();assert.equal(d.calls.length,1);d.unmount()
})
test('CLIN-13 a stale issued read cannot regress a previously verified Void record',async()=>{
 let result=ok(issued());const d=dialog({read:async()=>result});await d.flush();d.fill();await d.value.doVoid();d.render()
 result=ok(issued());await d.value.reload();d.render();assert.equal(d.value.p,null);assert.match(d.value.error,/verified state/);await d.value.doVoid();assert.equal(d.calls.length,1);d.unmount()
})
test('CLIN-13 detail rejection is an error with an explicit successful reload path',async()=>{
 let fail=true;const d=dialog({read:async()=>{if(fail)throw Error('Synthetic outage');return ok(issued())}});await d.flush();assert.equal(d.value.p,null);assert.ok(d.value.error)
 fail=false;await d.value.reload();d.render();assert.equal(d.value.p.id,'A');assert.equal(d.value.error,'');d.unmount()
})
for(const patch of [{id:'B'},{revision:null},{status:'Unknown'}])test('CLIN-13 malformed detail stays unavailable '+JSON.stringify(patch),async()=>{
 const d=dialog({read:async()=>ok(issued('A',patch))});await d.flush();assert.equal(d.value.p,null);assert.ok(d.value.error);d.unmount()
})
test('CLIN-13 no auth reader cannot transmit Void, while an issued readonly detail remains viewable',async()=>{
 const d=dialog({auth:undefined}); // The factory default is a valid synthetic reader.
 d.render({getAuthGeneration:null});await d.flush();d.fill();await d.value.doVoid();d.render();assert.equal(d.calls.length,0);assert.match(d.value.voidError,/authentication/);d.unmount()
})
test('CLIN-13 newer detail reload owns data when an older read returns last',async()=>{
 const old=deferred(),fresh=deferred();let reads=0;const d=dialog({read:()=>++reads===1?old.promise:fresh.promise})
 const load=d.value.reload();fresh.resolve(ok(issued()));await load;old.resolve(ok(voided()));await d.flush();assert.equal(d.value.p.status,'Issued');d.unmount()
})

test('CLIN-13 rerenders cannot bypass the pending Void guard',async()=>{
 const held=deferred(),d=dialog({respond:()=>held.promise});await d.flush();d.fill();const command=d.value.doVoid();d.render();await d.value.doVoid();d.render();await d.value.doVoid()
 assert.equal(d.calls.length,1);held.resolve(ok(voided()));await command;d.unmount()
})
test('CLIN-13 switching to B resets editor state while A retains its transmitted target',async()=>{
 const held=deferred(),d=dialog({respond:async id=>id==='A'?held.promise:ok(voided('B'))});await d.flush();d.fill();const a=d.value.doVoid()
 d.render({id:'B'});await d.flush();assert.equal(d.value.busy,false);assert.equal(d.value.reason,'');d.fill();await d.value.doVoid()
 held.resolve(ok(voided()));await a;d.render();assert.deepEqual(d.calls.map(c=>c.id),['A','B']);assert.equal(d.value.p.id,'B');assert.equal(d.feedback.length,1);d.unmount()
})
test('CLIN-13 a dismissed refusal cannot emit stale failure feedback',async()=>{
 const held=deferred(),d=dialog({respond:()=>held.promise});await d.flush();d.fill();const command=d.value.doVoid();d.close()
 held.resolve({ok:false,kind:'validation',message:'Synthetic refusal'});await command;d.render();assert.deepEqual(d.feedback,[]);assert.equal(d.value.voidError,'');d.unmount()
})
test('CLIN-13 only an eligible Issued record and a valid reason can begin Void',async()=>{
 let record=issued('A',{can_void:false});const d=dialog({read:async()=>ok(record)});await d.flush();d.fill();await d.value.doVoid();assert.equal(d.calls.length,0)
 record=issued();await d.value.reload();d.render();d.value.setReason('  ');d.render();await d.value.doVoid();assert.equal(d.calls.length,0);d.unmount()
})
