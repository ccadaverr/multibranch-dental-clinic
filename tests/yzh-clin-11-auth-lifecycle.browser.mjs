// Authored only. Execution (including bundling) requires separate approval.
// Reuses the complete CLIN-10 browser runner and assertions. Its synthetic
// ClinicProvider substitute is replaced with the actual store; prescription
// APIs remain in-memory. This is NOT authenticated integration acceptance.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

// Optional historical R2 replay: only supplies the new synthetic store reader.
// The existing CLIN-05 server, navigation adapter and every R2 assertion remain
// unchanged on disk. This fixture reader does not model real authentication.
async function historicalR2() {
  const {mkdtemp,readFile,writeFile}=await import('node:fs/promises')
  const {spawn}=await import('node:child_process')
  const {default:path}=await import('node:path')
  const {default:os}=await import('node:os')
  const port=Number(process.env.CLIN11_R2_PORT||5197)
  const temporary=await mkdtemp(path.join(os.tmpdir(),'clin11-r2-adapter-'))
  let server=await readFile(new URL('./yzh-clin-05-server.mjs',import.meta.url),'utf8')
  const replace=(from,to)=>{assert.equal(server.split(from).length,2,'Review historical server adapter');server=server.replace(from,to)}
  replace('mkdtemp, realpath, symlink','mkdtemp, realpath, symlink, readFile')
  replace('load(id) {', `async load(id) {
    if(id.split('?')[0].replaceAll('\\\\','/').endsWith('/tests/fixtures/yzh-qa-02.jsx')) {
      const fixture=await readFile(path.join(root,'tests/fixtures/yzh-qa-02.jsx'),'utf8');
      const seam='store={{...clinical,toast:';
      if(fixture.split(seam).length!==2)throw new Error('Review historical auth fixture adapter');
      return fixture.replace(seam,'store={{...clinical,getAuthGeneration:()=>1,toast:');
    }`)
  const entry=path.join(temporary,'server.mjs');await writeFile(entry,server)
  const child=spawn(process.execPath,[entry],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,CLIN05_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']})
  const oldUrl=process.env.CLIN05_URL
  try {
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Historical server startup timed out')),30000)
      let output=''
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('"ready":true')){clearTimeout(timeout);resolve()}})
      child.stderr.on('data',chunk=>process.stderr.write(chunk))
      child.once('error',error=>{clearTimeout(timeout);reject(error)})
      child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Historical server exited '+code))})
    })
    process.env.CLIN05_URL='http://127.0.0.1:'+port+'/tests/fixtures/yzh-qa-02.html'
    await import(new URL('./yzh-clin-05-r2.mjs',import.meta.url))
  } finally {child.kill();if(oldUrl===undefined)delete process.env.CLIN05_URL;else process.env.CLIN05_URL=oldUrl}
}

if(process.argv.includes('--historical-r2')) {
  await historicalR2()
} else {
const previousUrl = new URL('./yzh-clin-10-prescription.browser.mjs', import.meta.url)
let replay = readFileSync(previousUrl, 'utf8').replaceAll('\r\n', '\n')
const replaceOnce = (text, from, to) => {
  assert.equal(text.split(from).length, 2, 'Review CLIN-10 harness adapter: ' + from)
  return text.replace(from, to)
}
const sourceStart = replay.indexOf('const source = `\n'), sourceEnd = replay.indexOf('\n`\nconst api = `', sourceStart)
assert(sourceStart >= 0 && sourceEnd > sourceStart)
let source = replay.slice(sourceStart + 'const source = `\n'.length, sourceEnd)
source = replaceOnce(source, "import {clinicalFixture} from './tests/support/den-ui-02-fixture.js';", `import {ClinicProvider,useClinic} from './src/store.jsx';
import {reportSessionInvalidated} from './src/api-client.js';
import {flushSync} from 'react-dom';`)
const harnessStart = source.indexOf('function Harness(){')
assert(harnessStart > 0)
const harness = `
const reference={branches:[{id:'b1',name:'Synthetic branch',status:'Open'},{id:'b2',name:'Synthetic second branch',status:'Open'}],
 services:[{id:'svc1',name:'Synthetic service',status:'Active'}],branchServices:[{branchId:'b1',serviceId:'svc1',active:true}],staff:[],
 dentists:['A','B'].map((id,i)=>({id:i?'d12':'d11',userId:'01K8R00000000000000000000'+(i+1),personId:i?'per-d12':'per-d11',branchIds:['b1'],serviceIds:['svc1'],available:true}))};
function Harness(){
 const store=useClinic(),booted=React.useRef(false),[page,setPage]=React.useState('prescriptions');
 const login=actor=>{
  const owner=actor==='owner',id=owner?'01K8R000000000000000000003':actor==='B'?'01K8R000000000000000000002':'01K8R000000000000000000001';
  const me={id,role:owner?'owner':'dentist',account_status:'Active',email:owner?'owner@example.test':'synthetic-'+actor+'@example.invalid',first_name:'Synthetic',last_name:actor,name:'Synthetic '+actor,
   employee:owner?null:{profile_id:actor==='B'?'d12':'d11',branch_id:'b1',title:'Dentist'}};
  const bridged=store.actions.bridgeBackendIdentity(me);
  if(!bridged.ok)throw new Error('Synthetic identity bridge refused '+bridged.reason);
  store.adoptSession({...bridged.session,serverUserId:id,branchScopes:[],patientPublicId:null});
  setPage('prescriptions');
 };
 React.useEffect(()=>{if(!booted.current){booted.current=true;login('A')}},[]);
 window.rx10.login=actor=>flushSync(()=>login(actor));
 window.rx10.owner=value=>flushSync(()=>login(value?'owner':'A'));
 window.rx10.logout=()=>flushSync(()=>store.adoptSession(null));
 window.rx10.invalidate=()=>reportSessionInvalidated();
 window.rx10.generation=store.getAuthGeneration;
 window.rx10.hide=()=>flushSync(()=>setPage('queue'));
 window.rx10.show=()=>flushSync(()=>setPage('prescriptions'));
 window.rx10.refresh=()=>flushSync(()=>store.setSession('dentist'));
 window.rx10.dropPermission=()=>flushSync(()=>store.setters.setUsers(users=>users.map(u=>u.id===store.session.userId?{...u,permissions:u.permissions.filter(p=>p!=='prescriptions')}:u)));
 const role=store.session?.role,nav=useClinicalNavigation(store.getAuthGeneration());
 const encounter={treatmentId:'t1',visitId:'visit-A',patientId:'p1',branchId:'b1',dentistId:store.session?.dentistId,appointmentId:null};
 const state={...store.state,patients:store.state.patients.map(p=>p.id==='p1'?{...p,serverProjection:true}:p)};
 if(window.rx10.returnEncounter){state.treatments=[{id:'t1',server:true,author:true,...encounter,status:'In Treatment'}];state.visits=[{id:'visit-A',server:true,...encounter,status:'In Treatment'}]}
 const uiStore={...store,state,toast:(...args)=>window.rx10.feedback.push(args)};
 return <ClinicalNavigation.Provider value={nav.register}>
  <nav aria-label="Sidebar"><button onClick={()=>nav.request(()=>setPage('queue'))}>My Queue</button></nav>
  {!role?<h1>Signed out</h1>:page==='prescriptions'?<PrescriptionsServerPage key={store.getAuthGeneration()} role={role} store={uiStore} context={window.rx10.returnEncounter?{returnEncounter:encounter}:null} setPage={next=>nav.request(()=>setPage(next))}/>:<h1>{page==='queue'?'Queue destination':'Encounter destination'}</h1>}
  {nav.dialog}
 </ClinicalNavigation.Provider>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><ClinicProvider initialReferenceData={reference} initialServerAppointments={[]} initialServerVisits={[]} initialServerQueue={[]} initialServerTreatments={[]} initialServerHmo={[]}><Harness/></ClinicProvider></React.StrictMode>);
`
source = source.slice(0, harnessStart) + harness
// Use a JS string literal, not another interpolated template, for the adapter.
replay = replay.slice(0, sourceStart) + 'const source = ' + JSON.stringify(source) + replay.slice(sourceEnd + 2)
replay = replaceOnce(replay, "const root = fileURLToPath(new URL('..', import.meta.url))", 'const root = ' + JSON.stringify(fileURLToPath(new URL('..', import.meta.url))))
// Store and useClinicalSession subscribe to the real shared invalidation bus.
// Only prescription commands/reads use the existing in-memory API stub.
replay = replaceOnce(replay,
  "b.onResolve({filter: /api-client\\.js$/}, () => ({path: 'stub', namespace: 'clin10'}))",
  "b.onResolve({filter: /api-client\\.js$/}, args => /ServerPrescriptions\\.jsx$/.test(args.importer) ? {path:'stub',namespace:'clin10'} : undefined)")

const cases = `
  await check('real provider: StrictMode, equivalent adoption and operational re-derivation preserve generation', async p=>{
    const first=await p.evaluate(()=>window.rx10.generation());assert(Number.isSafeInteger(first));
    await p.evaluate(()=>window.rx10.login('A'));assert.equal(await p.evaluate(()=>window.rx10.generation()),first);
    await p.evaluate(()=>window.rx10.refresh());assert.equal(await p.evaluate(()=>window.rx10.generation()),first);
  });
  await check('real provider: signout and same-user re-login invalidate the old reader lifetime', async p=>{
    const first=await p.evaluate(()=>window.rx10.generation());await p.evaluate(()=>window.rx10.logout());
    assert.equal(await p.evaluate(()=>window.rx10.generation()),null);await p.evaluate(()=>window.rx10.login('A'));
    assert((await p.evaluate(()=>window.rx10.generation()))>first);
  });
  for(const replacement of ['B','ABA','same-user-relogin','invalidated','permissions'])await check('held save then observed auth replacement '+replacement,async p=>{
    await fill(p);await startIssue(p);await waitCalls(p,1);
    if(replacement==='B')await p.evaluate(()=>window.rx10.login('B'));
    if(replacement==='ABA'){await p.evaluate(()=>window.rx10.login('B'));await p.evaluate(()=>window.rx10.login('A'))}
    if(replacement==='same-user-relogin'){await p.evaluate(()=>window.rx10.logout());await p.evaluate(()=>window.rx10.login('A'))}
    if(replacement==='invalidated')await p.evaluate(()=>window.rx10.invalidate());
    if(replacement==='permissions')await p.evaluate(()=>window.rx10.dropPermission());
    if(replacement!=='invalidated'){
      await visit(p).waitFor();await visit(p).selectOption('visit-B');await note(p).fill('Replacement editor work');
    }
    await respond(p,0,saved);await frames(p);
    assert.equal((await calls(p)).length,1,'no Issue command under replacement auth');
    assert.equal((await calls(p))[0].body.visit_id,'visit-A');
    assert.deepEqual(await feedback(p),[],'no stale issuance or notification claims');
    assert.equal(await p.evaluate(()=>window.rx10.records.find(r=>r.id==='rx-A').status),'Draft','first command may have committed');
    if(replacement!=='invalidated')assert.equal(await note(p).inputValue(),'Replacement editor work');
  },{holdSave:true});
  await check('real provider: page unmount without auth replacement still issues original prescription',async p=>{
    await fill(p);await startIssue(p);await waitCalls(p,1);const generation=await p.evaluate(()=>window.rx10.generation());
    await p.evaluate(()=>window.rx10.hide());await respond(p,0,saved);await waitCalls(p,2);
    assert.equal(await p.evaluate(()=>window.rx10.generation()),generation);
    assert.deepEqual((await calls(p))[1],{command:'issue',id:'rx-A',body:{expected_revision:1}});assert.deepEqual(await feedback(p),[]);
  },{holdSave:true});
  await check('real provider: hidden page cannot issue after A to B to A',async p=>{
    await fill(p);await startIssue(p);await waitCalls(p,1);await p.evaluate(()=>window.rx10.hide());
    await p.evaluate(()=>window.rx10.login('B'));await p.evaluate(()=>window.rx10.login('A'));
    await visit(p).waitFor();await visit(p).selectOption('visit-B');await note(p).fill('Fresh A work');
    await respond(p,0,saved);await frames(p);assert.equal((await calls(p)).length,1);assert.equal(await note(p).inputValue(),'Fresh A work');assert.deepEqual(await feedback(p),[]);
  },{holdSave:true});
  await check('real provider: ordinary data refresh while save is pending preserves original Issue',async p=>{
    await fill(p);await startIssue(p);await waitCalls(p,1);const generation=await p.evaluate(()=>window.rx10.generation());
    await p.evaluate(()=>window.rx10.refresh());assert.equal(await p.evaluate(()=>window.rx10.generation()),generation);
    await respond(p,0,saved);await waitCalls(p,2);assert.equal((await calls(p))[1].id,'rx-A');
  },{holdSave:true});
  console.log(JSON.stringify({completed,unverified:['actual credentials/backend sessions','unobserved cross-tab cookie replacement','transport dispatch/CSRF/retry race'],evidence:'Synthetic APIs with actual store and React StrictMode; historical CLIN-10 browser assertions retained'},null,2));
`
const finalStart = replay.indexOf('  console.log(JSON.stringify({completed, blocked:')
const finalEnd = replay.indexOf('} finally {await browser?.close();', finalStart)
assert(finalStart > 0 && finalEnd > finalStart)
replay = replay.slice(0, finalStart) + cases + replay.slice(finalEnd)
await import('data:text/javascript;base64,' + Buffer.from(replay).toString('base64'))
}
