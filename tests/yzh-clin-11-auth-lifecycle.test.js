// Authored only. Do not execute until regression testing is approved.
// Actual store controller + actual WriteCard controller; no backend/security
// acceptance. Replays CLIN-10 assertions with its missing auth-reader fixture
// dependency supplied, without changing any historical assertion/file.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const storeSource = readFileSync(new URL('../src/store.jsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const replaceOnce = (source, from, to) => {
  assert.equal(source.split(from).length, 2, 'Review the source adapter: ' + from)
  return source.replace(from, to)
}
const between = (source, from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start)
  assert(start >= 0 && end > start, 'Review controller extraction: ' + from)
  return source.slice(start, end)
}

// Old CLIN-10 controller mocks have no ClinicProvider. Supply one explicit,
// stable synthetic generation; all old assertions and TODO markers stay intact.
const legacyUrl = new URL('./yzh-clin-10-prescription-lifecycle.test.js', import.meta.url)
let legacy = readFileSync(legacyUrl, 'utf8').replaceAll('\r\n', '\n')
legacy = replaceOnce(legacy, "new URL('../src/pages/ServerPrescriptions.jsx', import.meta.url)", JSON.stringify(new URL('../src/pages/ServerPrescriptions.jsx', import.meta.url).href))
// readFileSync accepts a URL object rather than a file: URL string.
legacy = replaceOnce(legacy, 'readFileSync(' + JSON.stringify(new URL('../src/pages/ServerPrescriptions.jsx', import.meta.url).href), 'readFileSync(new URL(' + JSON.stringify(new URL('../src/pages/ServerPrescriptions.jsx', import.meta.url).href) + ')')
legacy = replaceOnce(legacy, 'function editor({respond =', 'function editor({getAuthGeneration = () => 1, respond =')
legacy = replaceOnce(legacy, 'const props = {context:', 'const props = {getAuthGeneration, context:')
const {editor} = await import('data:text/javascript;base64,' + Buffer.from(legacy + '\nexport {editor}\n').toString('base64'))

const fixture = () => ({
  users: ['A','B'].map(id => ({id:'user-'+id,personId:'person-'+id,roleName:'Dentist',accountStatus:'Active',branchId:'b1',permissions:['prescriptions','treatment']})),
  dentists: ['A','B'].map(id => ({id:'dentist-'+id,userId:'user-'+id,branchIds:['b1','b2']})), staff: [],
})
const session = id => ({serverUserId:'server-'+id,userId:'user-'+id,dentistId:'dentist-'+id,role:'dentist',branchId:'b1',branchScopes:[],employeeBridge:true,active:true})
const wire = value => JSON.parse(JSON.stringify(value))
const deferred = () => {let resolve; const promise = new Promise(r => {resolve=r}); return {promise,resolve}}
const accepted = {ok:true,data:{id:'rx-A',status:'Draft',can_edit:true,revision:2}}

function owner({ready = true} = {}) {
  const sessionRef={current:null}, stateRef={current:fixture()}, listeners=new Set(), effects=[]
  const helpers=between(storeSource, 'const clin11SetKey', 'function usePersist(')
  const wiring=between(storeSource, '  const referenceReadyRef=', '  const actionsRef=')
  const setter=between(storeSource, '  const setSession=role=>', '\n\n  // Phase 2A reference-data')
  const adoption=between(storeSource, '  const adoptSession=session=>', '\n\n  // ---- M6')
  const controller=runInNewContext(helpers+'\n'+wiring+'\n'+setter+'\n'+adoption+'\n({adoptSession,setSession,getAuthGeneration,referenceReadyRef})', {
    sessionRef,stateRef,refDataStatus:ready?'ready':'loading',actionsRef:{current:null},
    useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>effects.push(fn),
    onSessionInvalidated:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    setSessionState() {},
    sessionForEmployee:(_state,base)=>({...base,active:true}),
    sessionForRole:role=>({...session('B'),role,serverUserId:undefined}),
  })
  let cleanup=effects[0]()
  return {...controller, stateRef, login:id=>controller.adoptSession(session(id)), logout:()=>controller.adoptSession(null),
    invalidate:()=>{for(const fn of [...listeners])fn()},
    ready:value=>{controller.referenceReadyRef.current=value},
    replayEffects:()=>{cleanup();cleanup=effects[0]()},
    dispose:()=>cleanup(),
  }
}

test('authenticated adoption, sign-out and same-user re-login have distinct generations', () => {
  const o=owner();assert.equal(o.getAuthGeneration(),null);o.login('A');const first=o.getAuthGeneration()
  assert(Number.isSafeInteger(first));o.logout();assert.equal(o.getAuthGeneration(),null)
  o.login('A');assert(o.getAuthGeneration()>first);o.dispose()
})
test('direct A to B to A adoption cannot revive A', () => {
  const o=owner();o.login('A');const a=o.getAuthGeneration();o.login('B');const b=o.getAuthGeneration();o.login('A');const again=o.getAuthGeneration()
  assert(a<b&&b<again);o.dispose()
})
test('equivalent adoption, bootstrap hydration, ordinary refresh and re-derivation preserve continuity', () => {
  const o=owner({ready:false});o.login('A');const first=o.getAuthGeneration()
  o.login('A');assert.equal(o.getAuthGeneration(),first, 'duplicate StrictMode startup adoption is idempotent')
  o.ready(true);assert.equal(o.getAuthGeneration(),first, 'initial profile hydration is not a new login')
  o.setSession('dentist');assert.equal(o.getAuthGeneration(),first)
  o.ready(false);assert.equal(o.getAuthGeneration(),first)
  o.stateRef.current=wire(o.stateRef.current);o.stateRef.current.users[0].name='Cosmetic refresh';o.ready(true)
  o.stateRef.current.users[0].permissions.reverse();o.stateRef.current.dentists[0].branchIds.reverse()
  assert.equal(o.getAuthGeneration(),first);o.dispose()
})
test('observed permission and membership changes advance generation, including reversion', () => {
  const o=owner();o.login('A');const first=o.getAuthGeneration()
  o.stateRef.current.users[0].permissions=['treatment'];const changed=o.getAuthGeneration();assert(changed>first)
  o.stateRef.current.users[0].permissions=['prescriptions','treatment'];const restored=o.getAuthGeneration();assert(restored>changed)
  o.stateRef.current.dentists[0].branchIds=['b2'];assert(o.getAuthGeneration()>restored);o.dispose()
})
test('setSession cannot authenticate an actor replacement or revive invalidation', () => {
  const o=owner();o.login('A');const first=o.getAuthGeneration();o.invalidate()
  assert.equal(o.getAuthGeneration(),null);o.setSession('dentist');assert.equal(o.getAuthGeneration(),null)
  o.login('A');assert(o.getAuthGeneration()>first)
  o.setSession('owner');assert.equal(o.getAuthGeneration(),null);o.dispose()
})
test('StrictMode effect cleanup/setup is not a new login; disposed owner reader fails closed', () => {
  const o=owner();o.login('A');const getter=o.getAuthGeneration,first=getter()
  o.replayEffects();assert.equal(getter(),first)
  o.invalidate();assert.equal(getter(),null, 'subscription is restored after replay')
  o.login('A');assert(getter()>first);o.dispose();assert.equal(getter(),null)
})

for(const mode of ['unchanged','refresh','visit-B','unmounted']) test(`confirmed original operation continues with same lifetime: ${mode}`, async () => {
  const o=owner();o.login('A');const held=deferred(),e=editor({getAuthGeneration:o.getAuthGeneration,respond:()=>held.promise})
  e.fill();const task=e.value.save(true)
  if(mode==='refresh'){o.setSession('dentist');o.stateRef.current=wire(o.stateRef.current)}
  if(mode==='visit-B'){e.value.changeVisit('visit-B');e.render();e.value.discard();e.render();e.value.setNote('New B note');e.render()}
  if(mode==='unmounted')e.unmount()
  held.resolve(accepted);await task;e.render()
  assert.equal(e.calls[0].body.visit_id,'visit-A');assert.deepEqual(e.calls.at(-1),{command:'issue',id:'rx-A',revision:2})
  if(mode==='visit-B'){assert.equal(e.value.note,'New B note');assert.deepEqual(e.feedback,[])}
  if(mode==='unmounted')assert.deepEqual(e.feedback,[])
  e.unmount();o.dispose()
})

for(const replacement of ['B','ABA','logout-relogin','invalidated','permission-change','provider-disposed']) test(`replacement before second command suppresses Issue: ${replacement}`, async () => {
  const o=owner();o.login('A');const held=deferred(),persisted=[],e=editor({getAuthGeneration:o.getAuthGeneration,respond:async body=>{await held.promise;persisted.push(wire(body));return accepted}})
  e.fill();const task=e.value.save(true)
  e.value.changeVisit('visit-B');e.render();e.value.discard();e.render();e.value.setNote('New editor work');e.render()
  if(replacement==='B')o.login('B')
  if(replacement==='ABA'){o.login('B');o.login('A')}
  if(replacement==='logout-relogin'){o.logout();o.login('A')}
  if(replacement==='invalidated')o.invalidate()
  if(replacement==='permission-change')o.stateRef.current.users[0].permissions=['treatment']
  if(replacement==='provider-disposed')o.dispose()
  held.resolve();await task;e.render()
  assert.equal(persisted.length,1, 'first command may already be committed')
  assert.equal(persisted[0].visit_id,'visit-A');assert.equal(e.calls.length,1, 'no second request')
  assert.equal(e.value.note,'New editor work');assert.deepEqual(e.feedback,[]);assert.deepEqual(e.done,[])
  e.unmount();o.dispose()
})
test('missing auth reader refuses issuance before starting either command', async () => {
  const e=editor({getAuthGeneration:null});e.fill();await e.value.save(true);e.render()
  assert.equal(e.calls.length,0);assert.match(e.value.err,/authentication could not be confirmed/);assert.deepEqual(e.feedback,[]);e.unmount()
})
test('authentication replacement after Issue began cannot undo it, but suppresses obsolete UI adoption', async () => {
  const o=owner();o.login('A');const held=deferred(),issueStarted=deferred(),e=editor({getAuthGeneration:o.getAuthGeneration,issue:()=>{issueStarted.resolve();return held.promise}})
  e.fill();const task=e.value.save(true)
  // Synchronize on actual mock dispatch, not a host microtask count across VM
  // realms. Fail if Save finishes without reaching Issue instead of hanging.
  await Promise.race([issueStarted.promise, task.then(()=>assert.fail('Save completed before Issue began'))])
  assert.equal(e.calls.at(-1).command,'issue');o.login('B')
  held.resolve({ok:true,data:{id:'rx-A',number:'RX-SYNTHETIC',status:'Issued'}});await task
  assert.deepEqual(e.feedback,[]);assert.deepEqual(e.done,[]);e.unmount();o.dispose()
})
test.todo('UNVERIFIED: unobserved cross-tab cookie replacement requires server-issued session-instance binding checked by the mutation')
test.todo('UNVERIFIED: real credentials, API CSRF/retry dispatch timing and native browser acceptance; client command gate does not bind a transmitted request')
