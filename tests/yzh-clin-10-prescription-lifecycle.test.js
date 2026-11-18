// Authored only: defer node --test until the testing phase is approved.
// Executes actual pre-JSX WriteCard controller code with hook cells. This is
// synthetic controller coverage, not React/browser/authenticated acceptance.
import { runPrescriptionWrite } from '../src/prescription-command.js'
import {readPrescriptionVisitOptions} from '../src/prescription-visit-read.js'
import {boundedClinicalRead} from '../src/clinical-history.js'
import {prescriptionContextMatches} from '../src/prescription-readback.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {setImmediate} from 'node:timers/promises'

const source = readFileSync(new URL('../src/pages/ServerPrescriptions.jsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const start = source.indexOf('function WriteCard('), end = source.indexOf('\n  if(editing&&!draft)', start)
assert(start > 0 && end > start, 'Review extraction after a controller structure change.')
const controller = source.slice(source.indexOf('const firstError'), source.indexOf('const TONE')) + '\n'
  + source.slice(start, end) + '\nreturn {save, changeVisit, setNote, setLines, stay, discard, requestLeave, visitId, lines, note, err, busy, visitError, visits, setVisitAttempt};\n}\nWriteCard'
const wire = v => JSON.parse(JSON.stringify(v))
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r}); return {promise, resolve}}
const accepted = (id = 'rx-A') => ({ok: true, data: {id, revision: 1, status: 'Draft', can_edit: true}})

function editor({respond = async () => accepted(), issue = async () => ({ok: true, data: {id: 'rx-A', number: 'RX-2026-000001', status: 'Issued'}}), visits = async () => ({ok: true, data: []}), context = {visitId:'visit-A',patientPublicId:'patient-A',branchId:'branch-A'}} = {}) {
  const cells = [], pending = [], calls = [], feedback = [], done = [], protections = []
  let cursor = 0, active = true, value, authGeneration = 1, knownRow
  const enrich = (r,body) => {if(r.ok)knownRow={patient:{id:"patient-A"},visit:"visit-A",branch:"Synthetic branch",lines:body.lines,note:body.note,...r.data};return r.ok?{...r,data:knownRow}:r}
  const useState = initial => {
    const i = cursor++
    cells[i] ||= {value: typeof initial === 'function' ? initial() : initial}
    return [cells[i].value, next => {cells[i].value = typeof next === 'function' ? next(cells[i].value) : next}]
  }
  const useRef = initial => {const i = cursor++; cells[i] ||= {value: {current: initial}}; return cells[i].value}
  const effect = (run, deps) => {
    const i = cursor++, old = cells[i]
    if (!old || !deps || deps.some((d, j) => d !== old.deps[j])) {
      old?.cleanup?.(); cells[i] = {deps}; pending.push(() => {cells[i].cleanup = run()})
    }
  }
  const component = runInNewContext(controller, {
    useState, useRef, useEffect: effect, useLayoutEffect: effect, structuredClone,
    commandKey:()=>`synthetic-${calls.length}`,
    // Controller tests invoke Save before the mocked catalog microtask; supply
    // the same explicit synthetic encounter identity a rendered form requires.
    runPrescriptionWrite:(request,api,allowed)=>runPrescriptionWrite(Object.assign(request,{patientId:request.patientId||'patient-A',branch:request.branch||'Synthetic branch'}),api,allowed),
    prescription:async()=>({ok:true,data:knownRow}),
    useClinicalProtection: (dirty, busy) => protections.push({dirty, busy}),
    prescriptionVisits: visits,readPrescriptionVisitOptions,boundedClinicalRead,prescriptionContextMatches,
    getVisit:async()=>({ok:true,data:{id:'visit-A',revision:1,clinic_date:'2026-11-18',status:'In Treatment',patient:{id:'patient-A',code:'PAT-A',name:'Synthetic Patient'},branch:{id:'branch-A',name:'Synthetic branch'}}}),
    createPrescription: body => {calls.push({command: 'create', body: wire(body)}); return Promise.resolve(respond(body)).then(r=>enrich(r,body))},
    updatePrescription: (id, body) => {calls.push({command: 'update', id, body: wire(body)}); return Promise.resolve(respond(body)).then(r=>enrich(r,body))},
    issuePrescription: (id, revision) => {calls.push({command: 'issue', id, revision}); return Promise.resolve(issue(id, revision)).then(r=>{if(r.ok)knownRow={...knownRow,...r.data,revision:r.data.revision??revision+1,can_edit:false,can_void:true,issued_at:'2026-11-15T10:00:00+08:00'};return r.ok?{...r,data:knownRow}:r})},
  })
  const props = {getAuthGeneration:()=>authGeneration, context: context, editing: null, isCurrent: () => active, leaveRef: {current: null}, toast: (...args) => feedback.push(args), onDone: id => done.push(id), onEdited() {}}
  const render = () => {cursor = 0; value = component(props); for (const run of pending.splice(0)) run(); return value}
  render()
  const fill = () => {value.setLines([{medicine: 'Synthetic medicine', dosage: 'Synthetic dosage', frequency: '', duration: '', instructions: 'Synthetic instructions'}]); value.setNote('Submitted note'); render()}
  return {replaceActor(){authGeneration++}, render, fill, calls, feedback, done, protections, get value() {return value}, unmount() {active = false; for (const cell of cells) cell?.cleanup?.()}}
}

test('genuine medication fields and notes register dirty protection; pending Save registers busy', async () => {
  const held = deferred(), e = editor({respond: () => held.promise})
  e.fill(); assert.equal(e.protections.at(-1).dirty, true)
  const task = e.value.save(false); e.render()
  assert.deepEqual(e.protections.at(-1), {dirty: true, busy: true})
  held.resolve(accepted()); await task; e.unmount()
})

test('Stay retains the submitted draft; Discard starts a fresh Visit editor', () => {
  const e = editor(); e.fill(); e.value.changeVisit('visit-B'); e.render()
  assert.equal(e.value.visitId, 'visit-A'); e.value.stay(); e.render()
  assert.equal(e.value.note, 'Submitted note')
  e.value.changeVisit('visit-B'); e.render(); e.value.discard(); e.render()
  assert.equal(e.value.visitId, 'visit-B'); assert.equal(e.value.note, ''); e.unmount()
})

for (const issue of [false, true]) test(`same-tick duplicate ${issue ? 'Issue' : 'Save'} transmits one command chain`, async () => {
  const held = deferred(), e = editor({respond: () => held.promise}); e.fill()
  const task = e.value.save(issue); await e.value.save(issue)
  assert.equal(e.calls.length, 1)
  held.resolve(accepted()); await task
  assert.equal(e.calls.filter(c => c.command === 'create').length, 1)
  assert.equal(e.calls.filter(c => c.command === 'issue').length, Number(issue)); e.unmount()
})

for (const returnToA of [false, true]) test(`confirmed original Visit issuance continues after Visit change${returnToA ? ' A to B to A' : ''} without clearing newer fields`, async () => {
  const held = deferred(), e = editor({respond: () => held.promise}); e.fill()
  const task = e.value.save(true)
  e.value.changeVisit('visit-B'); e.render(); e.value.discard(); e.render()
  if (returnToA) {e.value.changeVisit('visit-A'); e.render()}
  e.value.setNote('New editor note'); e.render()
  held.resolve(accepted()); await task; e.render()
  assert.deepEqual(e.calls[0].body.visit_id, 'visit-A')
  assert.deepEqual(e.calls.at(-1), {command: 'issue', id: 'rx-A', revision: 1})
  assert.equal(e.value.note, 'New editor note'); assert.deepEqual(e.feedback, []); assert.deepEqual(e.done, []); e.unmount()
})

test('same-actor confirmed issuance also continues after unmount, without stale feedback', async () => {
  const held = deferred(), e = editor({respond: () => held.promise}); e.fill()
  const task = e.value.save(true); e.unmount(); held.resolve(accepted()); await task
  assert.equal(e.calls.at(-1).command, 'issue'); assert.deepEqual(e.feedback, [])
})

test('Save accepted, Issue refused: recovery retries the same saved Draft ID and revision', async () => {
  const e = editor({issue: async () => ({ok: false, message: 'Synthetic stale revision'})}); e.fill()
  await e.value.save(true); e.render()
  assert.equal(e.value.err, 'Synthetic stale revision'); assert.equal(e.value.note, 'Submitted note')
  assert.deepEqual(e.feedback, [])
  await e.value.save(false)
  assert.equal(e.calls[2].command, 'update'); assert.equal(e.calls[2].id, 'rx-A'); assert.equal(e.calls[2].body.expected_revision, 1); e.unmount()
})

test('issuance success proves issuance, without asserting notification delivery', async () => {
  const e = editor(); e.fill(); await e.value.save(true)
  assert.match(e.feedback[0][0], /Issued RX-2026-000001/)
  assert.match(e.feedback[0][0], /delivery is not confirmed/); e.unmount()
})

test('failed Visit retrieval becomes an error and supports retry to an empty list', async () => {
  let attempts = 0
  const e = editor({context:null,visits: async () => ++attempts === 1 ? {ok: false, message: 'Synthetic outage'} : {ok: true, data: []}})
  // The VM awaits a host Promise: one host microtask does not settle its
  // cross-realm continuation. Yield to the next event-loop turn to drain the
  // mock's microtasks, with no elapsed-time sleep or production-source adapter.
  assert.equal(e.value.visits, null)
  await setImmediate(); e.render(); assert.equal(attempts, 1); assert.equal(e.value.visitError, 'Synthetic outage')
  e.value.setVisitAttempt(a => a + 1); e.render()
  assert.equal(e.value.visits, null)
  await setImmediate(); e.render(); assert.equal(attempts, 2)
  assert.equal(e.value.visitError, ''); assert.deepEqual(wire(e.value.visits), []); e.unmount()
})

for (const replacements of [1,2]) test(`auth lifetime changes ${replacements} time(s) before saved-Draft Issue cannot revive old intent`, async () => {
  const held=deferred(), e=editor({respond:()=>held.promise});e.fill()
  const task=e.value.save(true)
  for(let i=0;i<replacements;i++)e.replaceActor()
  held.resolve(accepted());await task;e.render()
  assert.deepEqual(e.calls.map(c=>c.command),['create'])
  assert.deepEqual(e.feedback,[]);assert.deepEqual(e.done,[]);e.unmount()
})

for (const field of ['medicine','dosage','frequency','duration']) for (const blank of ['', '   ']) test(`GEN-07 ${field} Other ${JSON.stringify(blank)} refuses the actual Save handler`, async () => {
  const e=editor();e.value.setLines([{medicine:'Synthetic medicine',dosage:'',frequency:'',duration:'',instructions:'',[field]:blank,[field+'Other']:true}]);e.render()
  await e.value.save(false);e.render()
  assert.equal(e.calls.length,0);assert.match(e.value.err,/Specify the selected Other/);e.unmount()
})

for (const field of ['medicine','dosage','frequency','duration']) test(`GEN-07 loaded whitespace ${field} cannot bypass Specify without a UI flag`, async () => {
  const e=editor();e.value.setLines([{medicine:'Synthetic medicine',dosage:'',frequency:'',duration:'',instructions:'',[field]:'   '}]);e.render()
  await e.value.save(false);e.render();assert.equal(e.calls.length,0);assert.match(e.value.err,/Specify the selected Other/);e.unmount()
})

test('GEN-07 submitted clinical strings are trimmed without changing draft text or payload vocabulary', async () => {
  const e=editor({respond:async()=>({ok:false,message:'Synthetic refusal'})})
  const line={medicine:'  Synthetic medicine  ',dosage:'  Synthetic dosage  ',frequency:'  Synthetic frequency  ',duration:'  Synthetic duration  ',instructions:'  First line\nSecond line  ',medicineOther:true,dosageOther:true,frequencyOther:true,durationOther:true}
  e.value.setLines([line]);e.render();await e.value.save(false);e.render()
  assert.deepEqual(e.calls[0].body.lines,[{medicine:'Synthetic medicine',dosage:'Synthetic dosage',frequency:'Synthetic frequency',duration:'Synthetic duration',instructions:'First line\nSecond line'}])
  assert.deepEqual(wire(e.value.lines),[line]);assert.equal(e.value.err,'Synthetic refusal');e.unmount()
})

// Keep historical CLIN-05/R2 and RX-01 files intact and run them separately in
// the approved test phase. Navigation/DOM/PDF assertions are in the browser file.

test('an incomplete second medicine cannot be silently omitted from the prescription', async () => {
  const e=editor();e.fill();e.value.setLines(ls=>[...ls,{medicine:'',dosage:'',frequency:'',duration:'',instructions:''}]);e.render()
  await e.value.save(false);e.render();assert.equal(e.calls.length,0);assert.match(e.value.err,/every line/);e.unmount()
})
