import test from 'node:test'
import assert from 'node:assert/strict'
import {setClockSource} from '../src/clock.js'
import {resolveEncounter,encounterContextFor,commandGate} from '../src/encounter.js'
import {mapQueueEntry} from '../src/queue-api.js'
import {mapVisit} from '../src/visits-api.js'
import {mapTreatment} from '../src/treatments-api.js'
import {clinicalFixture,queueRow,visitRow,treatmentRow,today} from './support/den-ui-02-fixture.js'
setClockSource(()=>new Date(today+'T10:00:00+08:00'))
function world(status='Waiting'){
 const w=clinicalFixture(),v=visitRow(),q=queueRow();q.status=status
 w.state.queue=[mapQueueEntry(q)];w.state.visits=[mapVisit(v)]
 w.context=encounterContextFor(w.state.queue[0]);return w
}
test('DEN02 own waiting encounter retains every distinct identity and cannot start',()=>{
 const w=world(),r=resolveEncounter(w.state,w.session,w.context)
 assert.equal(r.ok,true);assert.equal(r.canStart,false);assert.equal(r.visit.id,'v1');assert.equal(r.queue.id,'q1');assert.equal(r.patient.id,'p1')
})
test('DEN02 Called and Treatment Ready are the only offered start states',()=>{
 for(const status of ['Waiting','In Queue','Called','Treatment Ready','Temporarily Away']){const w=world(status);assert.equal(resolveEncounter(w.state,w.session,w.context).canStart,['Called','Treatment Ready'].includes(status))}
})
for(const [name,change] of [
 ['other dentist',w=>{w.state.queue[0].dentistId='other'}],
 ['revoked branch',w=>{w.state.dentists[0].branchIds=[]}],
 ['wrong patient context',w=>{w.context.patientId='p2'}],
 ['wrong visit context',w=>{w.context.visitId='v2'}],
 ['missing queue',w=>{w.state.queue=[]}],
 ['missing visit',w=>{w.state.visits=[]}],
 ['mismatched appointment',w=>{w.state.queue[0].appointmentId='other'}],
 ['expired session',w=>{w.session.active=false}],
 ['non-server patient',w=>{w.state.patients[0].serverProjection=false}],
])test('DEN02 refuses '+name,()=>{const w=world();change(w);assert.equal(resolveEncounter(w.state,w.session,w.context).ok,false)})
test('DEN02 completed treatment is read-only and foreign authors are refused',()=>{
 const w=world('Served');w.state.visits[0].status='Completed';w.state.queue[0].visitStatus='Completed'
 const t=mapTreatment({...treatmentRow(),status:'Completed'});w.state.treatments=[t]
 const context=encounterContextFor(t)
 assert.equal(resolveEncounter(w.state,w.session,context).editable,false)
 assert.equal(resolveEncounter(w.state,w.session,context).ok,true)
 t.author=false;assert.equal(resolveEncounter(w.state,w.session,context).ok,false)
})
test('DEN02 duplicate clicks execute once and retry preserves original payload and keys',async()=>{
 let release,calls=0,id=0;const gate=commandGate(()=>String(++id)), intent={mode:'save',form:{notes:'original'}}
 const first=gate.run(intent,()=>{calls++;return new Promise(r=>{release=r})})
 assert.equal((await gate.run(intent,()=>{calls++})).duplicate,true)
 release({ok:false,kind:'network'});await first
 const attempt=gate.retry
 await gate.run({mode:'complete',form:{notes:'different'}},value=>{assert.deepEqual(value,attempt);return {ok:true}})
 assert.equal(calls,1);assert.equal(gate.retry,null);assert.equal(attempt.form.notes,'original')
})
test('DEN02 thrown transport failure retains intent, revision conflict releases it for explicit review',async()=>{
 const gate=commandGate(()=> 'key');const intent={mode:'save',treatment:{revision:2},form:{notes:'unsaved'}}
 assert.equal((await gate.run(intent,()=>{throw Error('transport')})).uncertain,true)
 assert.equal(gate.retry.treatment.revision,2)
 await gate.run(intent,()=>({ok:false,kind:'conflict'}));assert.equal(gate.retry,null)
})
