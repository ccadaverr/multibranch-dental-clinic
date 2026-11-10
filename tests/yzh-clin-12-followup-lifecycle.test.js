// CLIN-12: actual pre-JSX controllers, synthetic hook cells and deferred APIs.
// No React DOM, server authorization, cross-tab cookie or real booking acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {setImmediate} from 'node:timers/promises'
const source=readFileSync(new URL('../src/pages/ServerFollowups.jsx',import.meta.url),'utf8').replaceAll('\r\n','\n')
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>=0&&b>a,from);return source.slice(a,b)}
const helpers=slice('const firstError','// One selection lifetime')
const listCode=slice('function useFollowupList(','/**')
const rowCode=slice('function FollowupRow(','  return <li')+'return {act, error, busy, setNote, note, setClosing, closing, setBooking, bookingToken, closeBooking, ownsBooking, bookingStore};\n}'
const panelCode=slice('function PatientFollowupPanel(','  return <section')+'return {add, err, busy, f, setF, setReasonCategory, setCustomReason, customReason, setAdding, adding, rows, error, load, reload, needsReload};\n}'
const reasons=slice('const STANDARD_REASONS','/** The follow-up tasks')
const wire=x=>JSON.parse(JSON.stringify(x))
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const task=(patient='A',extra={})=>({id:'task-'+patient,patient:{id:patient},branch:{id:'b1'},status:'Open',revision:['Contacted','Booked','Closed'].includes(extra.status)?2:1,can_contact:true,can_close:true,...extra})
const ok=data=>({ok:true,data})
const syntheticAuth=()=>1
const operations=()=>({tasks:new Map(),creates:new Map(),verified:new Map(),settlement:0})
function hooks(code,name,globals,initial,{deferEffects=false}={}){
 const cells=[],effects=[],layoutEffects=[];let cursor=0,props=initial,value
 const state=initial=>{const i=cursor++;cells[i]??={value:typeof initial==='function'?initial():initial};return [cells[i].value,x=>{cells[i].value=typeof x==='function'?x(cells[i].value):x}]}
 const ref=x=>{const i=cursor++;cells[i]??={value:{current:x}};return cells[i].value}
 const memo=(fn,deps)=>{const i=cursor++,old=cells[i];if(!old||deps.some((d,j)=>d!==old.deps[j]))cells[i]={deps,value:fn};return cells[i].value}
 const effect=(run,deps,queue=effects)=>{const i=cursor++,old=cells[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){old?.cleanup?.();cells[i]={deps};queue.push(()=>{cells[i].cleanup=run()})}}
 const React={useRef:ref,useState:state,useCallback:memo,useEffect:effect,useLayoutEffect:(run,deps)=>effect(run,deps,layoutEffects)}
 const fn=runInNewContext(helpers+listCode+reasons+code+'\n'+name,{React,useState:state,useEffect:effect,...globals})
 const render=patch=>{props={...props,...patch};cursor=0;value=fn(props);for(const run of layoutEffects.splice(0))run();if(!deferEffects)for(const run of effects.splice(0))run();return value}
 render()
 return {render,flushEffects(count=effects.length){for(const run of effects.splice(0,count))run()},get value(){return value},unmount(){for(const cell of cells)cell?.cleanup?.()}}
}
function row({respond=async()=>ok(task('A',{status:'Contacted'})),current=()=>true,record=task(),reload=async()=>true,pendingTasks=operations(),auth=syntheticAuth,deferEffects=false}={}){
 const calls=[],feedback=[];let reloads=0
 const h=hooks(rowCode,'FollowupRow',{updateFollowup:(id,body)=>{calls.push({id,body:wire(body)});return respond(id,body)}},{pendingTasks,t:record,role:'staff',owner:false,store:{getAuthGeneration:auth},toast:(...args)=>feedback.push(args),isCurrent:current,onChanged:()=>{reloads++;return reload()}},{deferEffects})
 return {...h, get value(){return h.value},calls,feedback,get reloads(){return reloads}}
}
function panel({respond=async()=>ok(task()),read=async()=>ok([]),lifetime,auth=syntheticAuth,deferEffects=false}={}){
 const calls=[],feedback=[],reads=[]
 const h=hooks(panelCode,'PatientFollowupPanel',{createFollowup:body=>{calls.push(wire(body));return respond(body)},patientFollowups:id=>{reads.push(id);return read(id)}},{patientId:'A',branches:[{id:'b1'}],role:'staff',lifetime,store:{getAuthGeneration:auth},toast:(...a)=>feedback.push(a)},{deferEffects})
 return {...h,get value(){return h.value},calls,feedback,reads}
}
const submit=e=>e.value.add({preventDefault(){}})
function list(read,lifetime=null){return hooks('', 'props => useFollowupList(props.key, props.read, props.patient, props.owner, props.lifetime)',{}, {key:'A',patient:'A',owner:false,read,lifetime})}

test('CLIN-12 read A -> B -> A rejects both obsolete requests and preserves latest rows',async()=>{
 const a=deferred(),b=deferred(),latest=deferred();const e=list(()=>a.promise)
 e.render({key:'B',patient:'B',read:()=>b.promise});e.render({key:'A',patient:'A',read:()=>latest.promise})
 const finish=e.value.load();latest.resolve(ok([task('A')]));await finish;e.render()
 a.resolve(ok([task('A',{id:'obsolete'})]));b.resolve(ok([task('B')]))
 // Drain the finite VM/host mock microtask chain; no elapsed-time delay.
 await setImmediate();e.render();assert.equal(e.value.rows[0].id,'task-A');e.unmount()
})
test('CLIN-12 late A read cannot populate B, and newest reload owns data',async()=>{
 const old=deferred(),fresh=deferred();const e=list(()=>old.promise)
 e.render({key:'B',patient:'B',read:()=>fresh.promise});const done=e.value.load()
 fresh.resolve(ok([task('B')]));await done;old.resolve(ok([task('A')]))
 await setImmediate();e.render();assert.equal(e.value.rows[0].patient.id,'B');e.unmount()
})
for(const result of [ok([task('B')]),ok([task('A',{branch:{}})]),null,{ok:false,kind:'forbidden'},{ok:false,kind:'unauthenticated'},{ok:false,kind:'server'}])test('CLIN-12 invalid/denied read remains an error: '+JSON.stringify(result),async()=>{
 const e=list(async()=>result);await e.value.load();e.render();assert.equal(e.value.rows,null);assert.ok(e.value.error);e.unmount()
})
test('CLIN-12 read rejection supports explicit reload to a genuine empty list',async()=>{
 let fail=true;const e=list(async()=>{if(fail)throw Error('offline');return ok([])})
 await e.value.load();e.render();assert.ok(e.value.error);fail=false;await e.value.load();e.render();assert.equal(e.value.error,'');assert.deepEqual(wire(e.value.rows),[]);e.unmount()
})
for(const action of ['contacted','close'])test('CLIN-12 same-tick '+action+' and competing action remain latched across renders',async()=>{
 const held=deferred(),e=row({respond:()=>held.promise});const work=e.value.act(action,{note:'Synthetic closure'})
 await e.value.act(action);e.render();await e.value.act(action==='close'?'contacted':'close')
 assert.equal(e.calls.length,1);assert.equal(e.calls[0].id,'task-A');held.resolve(ok(task('A',{status:action==='close'?'Closed':'Contacted'})));await work;assert.equal(e.feedback.length,1);e.unmount()
})
for(const mode of ['unmount','A-B-A'])test('CLIN-12 obsolete '+mode+' mutation keeps submitted target and suppresses feedback',async()=>{
 const held=deferred();let current=true;const e=row({respond:()=>held.promise,current:()=>current});const work=e.value.act('contacted')
 if(mode==='unmount')e.unmount();else current=false // Old scope stays invalid even when a new A scope exists.
 held.resolve(ok(task('A',{status:'Contacted'})));await work
 assert.deepEqual(e.calls,[{id:'task-A',body:{action:'contacted'}}]);assert.deepEqual(e.feedback,[]);assert.equal(e.reloads,0);e.unmount()
})
for(const patch of [{id:'other'},{patient:{id:'B'}},{branch:{id:'b2'}},{status:'Open'}])test('CLIN-12 rejects update identity/status mismatch '+JSON.stringify(patch),async()=>{
 const e=row({respond:async()=>ok(task('A',{status:'Contacted',...patch}))});await e.value.act('contacted');e.render();assert.ok(e.value.error);assert.deepEqual(e.feedback,[]);e.unmount()
})
for(const failure of [{ok:false,kind:'network'},{ok:false,kind:'server'},null,'throw'])test('CLIN-12 uncertain update requires reload before another mutation '+JSON.stringify(failure),async()=>{
 const e=row({respond:async()=>{if(failure==='throw')throw Error('offline');return failure}})
 await e.value.act('contacted');e.render();assert.match(e.value.error,/Reload/);await e.value.act('close',{note:'Synthetic'});assert.equal(e.calls.length,1);e.unmount()
})
test('CLIN-12 add same-tick duplicates stay latched after rerender and snapshot payload',async()=>{
 const held=deferred(),e=panel({respond:()=>held.promise});const work=submit(e);await submit(e);e.render();await submit(e)
 assert.equal(e.calls.length,1);assert.deepEqual(e.calls[0],{patient_id:'A',reason:'Post-Op Check',branch_ref:'b1',due_on:e.value.f.due_on})
 held.resolve(ok(task()));await work;assert.equal(e.feedback.length,1);e.unmount()
})
for(const failure of [{ok:false,kind:'network'},{ok:false,kind:'server'},ok(task('B')),ok(task('A',{branch:{id:'b2'}})),null])test('CLIN-12 uncertain create cannot be blindly repeated '+JSON.stringify(failure),async()=>{
 const e=panel({respond:async()=>failure});await submit(e);e.render();assert.match(e.value.err,/Reload/);await submit(e);assert.equal(e.calls.length,1);assert.deepEqual(e.feedback,[]);e.unmount()
})
test('CLIN-12 late create cannot adopt B or a newer A editor',async()=>{
 const held=deferred(),old=panel({respond:()=>held.promise});const work=submit(old);old.unmount()
 const newer=panel();newer.value.setCustomReason('New draft');newer.render()
 held.resolve(ok(task()));await work;assert.deepEqual(old.feedback,[]);assert.equal(newer.value.customReason,'New draft');assert.equal(old.reads.length,1);newer.unmount()
})
for(const kind of ['validation','forbidden'])test('CLIN-12 confirmed '+kind+' failure retains draft without success feedback',async()=>{
 const e=panel({respond:async()=>({ok:false,kind,message:'Synthetic refusal'})});e.value.setReasonCategory('Other');e.value.setCustomReason('Synthetic draft');e.render()
 await submit(e);e.render();assert.equal(e.value.customReason,'Synthetic draft');assert.ok(e.value.err);assert.deepEqual(e.feedback,[]);e.unmount()
})
test('CLIN-12 booking token invalidates old callback after close and reopen',()=>{
 const e=row();const first={};e.value.bookingToken.current=first;e.value.setBooking(first);e.render();const old=e.value
 assert.equal(old.ownsBooking(),true);old.closeBooking();const second={};old.bookingToken.current=second;old.setBooking(second);e.render()
 assert.equal(old.ownsBooking(),false);assert.equal(e.value.ownsBooking(),true);old.bookingStore.toast('Obsolete');assert.deepEqual(e.feedback,[]);e.unmount();assert.equal(e.value.ownsBooking(),false)
})

test('CLIN-12 reload cannot unlock an in-flight Add, even if begun before Add',async()=>{
 const read=deferred(),write=deferred(),e=panel({read:()=>read.promise,respond:()=>write.promise})
 const reload=e.value.reload(),work=submit(e)
 read.resolve(ok([]));await reload;e.render();await e.value.reload();await submit(e)
 assert.equal(e.calls.length,1)
 write.resolve({ok:false,kind:'network'});await work;e.render();await submit(e);assert.equal(e.calls.length,1);e.unmount()
})
test('CLIN-12 failed recovery stays blocked; even an empty authoritative read cannot clear an uncertain Add',async()=>{
 let readFails=true;const e=panel({respond:async()=>({ok:false,kind:'network'}),read:async()=>readFails?{ok:false,kind:'server'}:ok([])})
 await submit(e);e.render();await e.value.reload();e.render();await submit(e);assert.equal(e.calls.length,1)
 readFails=false;await e.value.reload();e.render();assert.equal(e.value.needsReload,true);assert.match(e.value.err,/still unconfirmed/)
 await submit(e);assert.equal(e.calls.length,1);e.unmount()
})
test('CLIN-12 old recovery read cannot unlock a newer uncertain Add result',async()=>{
 const oldRead=deferred(),write=deferred(),e=panel({read:()=>oldRead.promise,respond:()=>write.promise})
 const recovery=e.value.reload(),work=submit(e);write.resolve({ok:false,kind:'network'});await work
 oldRead.resolve(ok([]));await recovery;e.render();await submit(e);assert.equal(e.calls.length,1);assert.equal(e.value.needsReload,true);e.unmount()
})
test('CLIN-12 successful row cannot replay its obsolete command before replacement',async()=>{
 const e=row();await e.value.act('contacted');e.render();await e.value.act('close',{note:'Synthetic'});assert.equal(e.calls.length,1);assert.equal(e.reloads,1);e.unmount()
})
test('CLIN-12 owner metadata read accepts no patient details; unmounted reads adopt nothing',async()=>{
 const held=deferred(),e=list(()=>held.promise);e.render({owner:true,read:async()=>ok([{id:'task',branch:{id:'b1'},status:'Open',revision:1}])})
 await e.value.load();e.render();assert.equal(e.value.rows[0].id,'task');e.unmount();held.resolve(ok([task('B')]))
 await setImmediate();e.render();assert.equal(e.value.rows[0].id,'task')
})

test('CLIN-12 newest same-selection reload wins even when the older response finishes last',async()=>{
 const old=deferred(),fresh=deferred();let calls=0;const e=list(()=>++calls===1?old.promise:fresh.promise)
 const load=e.value.load();fresh.resolve(ok([task('A',{id:'newest'})]));await load;e.render()
 old.resolve(ok([task('A',{id:'obsolete'})]));await setImmediate();e.render();assert.equal(e.value.rows[0].id,'newest');e.unmount()
})
test('CLIN-12 thrown Add failure retains its draft and requires authoritative recovery',async()=>{
 const e=panel({respond:async()=>{throw Error('offline')}});e.value.setReasonCategory('Other');e.value.setCustomReason('Synthetic original reason');e.render()
 await submit(e);e.render();assert.match(e.value.err,/Reload/);await submit(e);assert.equal(e.calls.length,1);assert.equal(e.value.customReason,'Synthetic original reason');e.unmount()
})

test('CLIN-12 list reload remount cannot bypass a transmitted task command',async()=>{
 const held=deferred(),pendingTasks=operations(),old=row({pendingTasks,respond:()=>held.promise})
 const work=old.value.act('contacted');old.unmount()
 const replacement=row({pendingTasks});await replacement.value.act('close',{note:'Synthetic closure'})
 assert.equal(replacement.calls.length,0,'replacement row must await the submitted task command')
 held.resolve(ok(task('A',{status:'Contacted'})));await work;await setImmediate()
 assert.deepEqual(old.feedback,[]);assert.equal(replacement.reloads,1,'reconcile settled task through a read, without replaying its mutation');replacement.unmount()
})

// R2 ordering B: the mutation settles before the earlier read mounts its row.
test('CLIN-12-R2 ordering B rejects a pre-settlement read and never repeats Contacted',async()=>{
 const read=deferred(),write=deferred(),feed=list(()=>read.promise),pendingTasks=feed.value.pendingTasks
 const old=row({pendingTasks,respond:()=>write.promise}),command=old.value.act('contacted')
 const reload=feed.value.load();old.unmount();write.resolve({ok:false,kind:'network'});await command
 read.resolve(ok([task()]));await reload;feed.render()
 const replacement=row({pendingTasks,record:task()});await replacement.value.act('contacted')
 assert.equal(replacement.calls.length,0,'no duplicate after an uncertain write and pre-settlement snapshot')
 assert.equal(feed.value.rows,null,'the read began before settlement and cannot be adopted')
 replacement.unmount();feed.unmount()
})
test('CLIN-12-R2 an older same-account authentication lifetime cannot adopt mutation feedback',async()=>{
 let generation=1;const write=deferred(),e=row({respond:()=>write.promise,auth:()=>generation})
 const command=e.value.act('contacted');assert.equal(e.calls.length,1)
 generation=2;write.resolve(ok(task('A',{status:'Contacted',revision:2})));await command
 assert.deepEqual(e.feedback,[]);assert.equal(e.reloads,0);e.unmount()
})

for(const action of ['contacted','close'])for(const ordering of ['A','B'])test(`CLIN-12-R2 ${action} ordering ${ordering}: zero repeats until positive post-settlement evidence`,async()=>{
 const read=deferred(),write=deferred(),pendingTasks=operations(),lifetime={pendingTasks,isCurrent:()=>true}
 let response=()=>read.promise;const feed=list(()=>response(),lifetime)
 const old=row({pendingTasks,respond:()=>write.promise});const command=old.value.act(action,{note:'Synthetic closure'})
 const reload=feed.value.load();old.unmount()
 let replacement
 if(ordering==='A'){read.resolve(ok([task()]));await reload;feed.render();replacement=row({pendingTasks});await replacement.value.act(action);assert.equal(replacement.calls.length,0)}
 write.resolve({ok:false,kind:'network'});await command;await setImmediate()
 if(ordering==='B'){read.resolve(ok([task()]));await reload;feed.render();assert.equal(feed.value.rows,null);replacement=row({pendingTasks})}
 await replacement.value.act(action);assert.equal(replacement.calls.length,0)
 for(const result of [{ok:false,kind:'server'},null,ok([task()]),ok([task('A',{status:action==='close'?'Closed':'Contacted',revision:1})])]){
   response=async()=>result;await feed.value.load();feed.render();await replacement.value.act(action)
   assert.equal(replacement.calls.length,0);assert.equal(pendingTasks.tasks.size,1)
 }
 response=async()=>ok([task('A',{status:action==='close'?'Closed':'Contacted',revision:2,can_contact:false,can_close:action!=='close'})])
 await feed.value.load();feed.render();assert.equal(pendingTasks.tasks.size,0,'only positive task progress reconciles the uncertain operation')
 replacement.unmount();feed.unmount()
})
test('CLIN-12-R2 wrong task or branch cannot reconcile; unrelated tasks remain independent',async()=>{
 const pendingTasks=operations(),a=row({pendingTasks,respond:async()=>({ok:false,kind:'network'})})
 await a.value.act('contacted');a.unmount()
 const b=row({pendingTasks,record:task('B'),respond:async()=>ok(task('B',{status:'Contacted',revision:2}))});await b.value.act('contacted');assert.equal(b.calls.length,1)
 let result=ok([task('A',{branch:{id:'b2'},status:'Contacted',revision:2}),task('B',{status:'Contacted',revision:2})])
 const feed=list(async()=>result,{pendingTasks,isCurrent:()=>true});feed.render({key:'all',patient:null});await feed.value.load();feed.render()
 assert.equal(pendingTasks.tasks.has('task-A'),true)
 result=ok([task('B',{status:'Contacted',revision:2})]);await feed.value.load();assert.equal(pendingTasks.tasks.has('task-B'),false)
 result=ok([task('A',{id:'unexpected',status:'Contacted',revision:2})]);await feed.value.load();assert.equal(pendingTasks.tasks.has('task-A'),true)
 feed.unmount();b.unmount()
})
test('CLIN-12-R2 overlapping recovery reads cannot restore an older Open snapshot',async()=>{
 const pendingTasks=operations(),e=row({pendingTasks,respond:async()=>({ok:false,kind:'network'})});await e.value.act('contacted');e.unmount()
 const old=deferred(),fresh=deferred();let reads=0;const feed=list(()=>++reads===1?old.promise:fresh.promise,{pendingTasks,isCurrent:()=>true})
 const latest=feed.value.load();fresh.resolve(ok([task('A',{status:'Contacted',revision:2})]));await latest;feed.render();assert.equal(pendingTasks.tasks.size,0)
 old.resolve(ok([task()]));await setImmediate();feed.render();assert.equal(feed.value.rows[0].status,'Contacted');feed.unmount()
})
test('CLIN-12-R2 unmount during recovery keeps the task guard without feedback',async()=>{
 const pendingTasks=operations(),e=row({pendingTasks,respond:async()=>({ok:false,kind:'network'})});await e.value.act('contacted');e.unmount()
 const read=deferred(),feed=list(()=>read.promise,{pendingTasks,isCurrent:()=>true});const recovery=feed.value.load();feed.unmount()
 read.resolve(ok([task('A',{status:'Contacted',revision:2})]));await recovery
 assert.equal(pendingTasks.tasks.has('task-A'),true);assert.deepEqual(e.feedback,[])
})
test('CLIN-12-R2 provider lifetime owns operations across patient ABA and separates same-user reauthentication',()=>{
 const {followupLifetime}=runInNewContext(helpers+'\n({followupLifetime})')
 let generation=1;const read=()=>generation,store={getAuthGeneration:read}
 const a=followupLifetime(store),operation={phase:'recovery',submitted:{id:'task-A',patientId:'A',branchId:'b1'}};a.pendingTasks.tasks.set('task-A',operation)
 const b=followupLifetime(store),again=followupLifetime(store)
 assert.equal(a,b);assert.equal(again.pendingTasks.tasks.get('task-A'),operation)
 generation=null;assert.equal(a.isCurrent(),false);generation=2
 const replacement=followupLifetime(store);assert.notEqual(replacement,a);assert.equal(replacement.pendingTasks.tasks.size,0);assert.equal(a.isCurrent(),false)
})
test('CLIN-12-R2 auth replacement suppresses reads and booking feedback without a rerender',async()=>{
 let generation=1;const pendingTasks=operations(),lifetime={pendingTasks,isCurrent:()=>generation===1},read=deferred(),feed=list(()=>read.promise,lifetime)
 const load=feed.value.load();const e=row({auth:()=>generation});const token={};e.value.bookingToken.current=token;e.value.setBooking(token);e.render();const booking=e.value
 generation=2;read.resolve(ok([task()]));await load;feed.render();assert.equal(feed.value.rows,null)
 booking.bookingStore.toast('Obsolete booking');assert.deepEqual(e.feedback,[]);assert.equal(booking.ownsBooking(),false);e.unmount();feed.unmount()
})

test('CLIN-12-R2 a remounted panel releases a known Add receipt after its initial authoritative read',async()=>{
 const pendingTasks=operations(),lifetime={pendingTasks,isCurrent:()=>true},write=deferred()
 const old=panel({lifetime,respond:()=>write.promise});const command=submit(old);old.unmount();write.resolve(ok(task()));await command
 assert.equal(pendingTasks.creates.size,1)
 const replacement=panel({lifetime,read:async()=>ok([task()])});await replacement.value.load();replacement.render();replacement.render()
 assert.equal(pendingTasks.creates.size,0);assert.equal(replacement.value.needsReload,false);assert.equal(replacement.value.busy,false);replacement.unmount()
})
test('CLIN-12-R2 an uncertain Add survives panel ABA; a known similar task is not an operation receipt',async()=>{
 const pendingTasks=operations(),lifetime={pendingTasks,isCurrent:()=>true}
 const old=panel({lifetime,respond:async()=>({ok:false,kind:'network'})});await submit(old);old.unmount()
 const replacement=panel({lifetime,read:async()=>ok([task()])});await replacement.value.reload();replacement.render();await submit(replacement)
 assert.equal(replacement.calls.length,0);assert.equal(pendingTasks.creates.size,1);assert.equal(replacement.value.needsReload,true);replacement.unmount()
})
test('CLIN-12-R2 authentication replacement suppresses Add adoption without a rerender',async()=>{
 let generation=1;const write=deferred(),e=panel({auth:()=>generation,respond:()=>write.promise})
 const command=submit(e);assert.equal(e.calls.length,1);generation=2;write.resolve(ok(task()));await command
 assert.deepEqual(e.feedback,[]);assert.equal(e.reads.length,1);e.unmount()
})
test('CLIN-12-R2 malformed success without a revision cannot confirm a task command',async()=>{
 const pendingTasks=operations(),e=row({pendingTasks,respond:async()=>ok(task('A',{status:'Contacted',revision:null}))})
 await e.value.act('contacted');e.render();assert.deepEqual(e.feedback,[]);assert.equal(pendingTasks.tasks.get('task-A').phase,'recovery');e.unmount()
})

for(const patch of [{revision:null},{revision:0},{id:{}},{branch:{id:2}},{status:'Unknown'}])test('CLIN-12-R2 malformed canonical task list stays unavailable '+JSON.stringify(patch),async()=>{
 const e=list(async()=>ok([task('A',patch)]));await e.value.load();e.render();assert.equal(e.value.rows,null);assert.ok(e.value.error);e.unmount()
})

test('CLIN-12-R2 an older recovery in another mounted list cannot restore verified Open data',async()=>{
 const pendingTasks=operations(),lifetime={pendingTasks,isCurrent:()=>true},e=row({pendingTasks,respond:async()=>({ok:false,kind:'network'})})
 await e.value.act('contacted');e.unmount()
 const delayed=deferred(),older=list(()=>delayed.promise,lifetime),oldLoad=older.value.load()
 const fresh=list(async()=>ok([task('A',{status:'Contacted',revision:2})]),lifetime);await fresh.value.load();fresh.render();assert.equal(pendingTasks.tasks.size,0)
 delayed.resolve(ok([task()]));await oldLoad;older.render();assert.equal(older.value.rows,null,'an older projection must not regress positively verified task state');older.unmount();fresh.unmount()
})

test('CLIN-12-R2 a mounted stale row cannot dispatch after another list verifies newer task state',async()=>{
 const pendingTasks=operations(),old=row({pendingTasks})
 const feed=list(async()=>ok([task('A',{status:'Contacted',revision:2})]),{pendingTasks,isCurrent:()=>true})
 await feed.value.load();await old.value.act('contacted');assert.equal(old.calls.length,0);old.unmount();feed.unmount()
})

test('CLIN-12-R2 a legitimate higher-revision reopened task remains actionable',async()=>{
 const pendingTasks=operations(),lifetime={pendingTasks,isCurrent:()=>true};let result=ok([task('A',{status:'Contacted',revision:2})])
 const feed=list(async()=>result,lifetime);await feed.value.load()
 result=ok([task('A',{status:'Open',revision:3})]);await feed.value.load();feed.render();assert.equal(feed.value.rows[0].revision,3)
 const e=row({pendingTasks,record:feed.value.rows[0],respond:async()=>ok(task('A',{status:'Contacted',revision:4}))});await e.value.act('contacted')
 assert.equal(e.calls.length,1);assert.equal(e.feedback.length,1);e.unmount();feed.unmount()
})

test('CLIN-12-R2 replacement row effect still reconciles if settlement precedes passive effect execution',async()=>{
 const write=deferred(),pendingTasks=operations(),old=row({pendingTasks,respond:()=>write.promise});const command=old.value.act('contacted');old.unmount()
 const replacement=row({pendingTasks,deferEffects:true});write.resolve({ok:false,kind:'network'});await command
 replacement.flushEffects();await setImmediate();assert.equal(replacement.reloads,1,'the render-time pending observation must survive later settlement');replacement.unmount()
})
test('CLIN-12-R2 replacement Add effect still reconciles when settlement precedes passive effect execution',async()=>{
 const write=deferred(),pendingTasks=operations(),lifetime={pendingTasks,isCurrent:()=>true},old=panel({lifetime,respond:()=>write.promise});const command=submit(old);old.unmount()
 let result=[];const replacement=panel({lifetime,deferEffects:true,read:async()=>ok(result)})
 replacement.flushEffects(1);await setImmediate();replacement.render()
 result=[task()];write.resolve(ok(task()));await command;replacement.flushEffects();await setImmediate();replacement.render();replacement.render()
 assert.equal(replacement.reads.length,2,'the pending Add observed by the rendered panel must trigger reconciliation');assert.equal(replacement.value.needsReload,false);replacement.unmount()
})
