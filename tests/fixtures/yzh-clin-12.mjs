// CLIN-12 isolated browser fixture server. All APIs and booking are synthetic;
// the production follow-up components and shared controls/styles are bundled unchanged.
// Run: node tests/fixtures/yzh-clin-12.mjs (loopback port 5187).
import {build} from 'esbuild'
import {createServer} from 'node:http'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=fileURLToPath(new URL('../..',import.meta.url))
const source=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {FollowupPanel,FollowupsServerPage} from './src/pages/ServerFollowups.jsx'
import './src/styles.css'
import './src/foundation.css'
import './src/polish.css'
import './src/dentist-clinical.css'
const pending=new Map();let authGeneration=1
const getAuthGeneration=()=>authGeneration
window.clin12={calls:[],feedback:[],replaceAuth(){authGeneration++},invalidateAuth(){authGeneration=null},request(method,id,body){const index=this.calls.length;this.calls.push({method,id,body});return new Promise((resolve,reject)=>pending.set(index,{resolve,reject}))},respond(index,result){if(!pending.has(index))throw Error('No pending request '+index);pending.get(index).resolve(result);pending.delete(index)},reject(index){pending.get(index).reject(Error('Synthetic outage'));pending.delete(index)}}
function Harness(){
 const [options,setOptions]=React.useState({patient:'A',mode:'panel',role:'staff',session:'one'})
 window.clin12.set=patch=>flushSync(()=>{if(patch.session&&patch.session!==options.session)authGeneration++;setOptions(o=>({...o,...patch}))})
 const toast=(...args)=>window.clin12.feedback.push(args)
 const branches=[{id:'b1',name:'Synthetic branch with a long name'},{id:'b2',name:'Synthetic second branch'}]
 const store={getAuthGeneration,session:{role:options.role,serverUserId:options.session},state:{branches},toast}
 return options.mode==='hidden'?<p>Unmounted</p>:options.mode==='panel'?<FollowupPanel patientId={options.patient} branches={branches} toast={toast} store={store} role={options.role}/>:<FollowupsServerPage role={options.role} store={store} context={null} setPage={()=>{}}/>
}
createRoot(document.getElementById('root')).render(<Harness/>)
`
const api=`const call=(method,id,body)=>window.clin12.request(method,id,body)
export const patientFollowups=id=>call('patient',id)
export const followups=filters=>call('list',null,filters)
export const createFollowup=body=>call('create',body.patient_id,body)
export const updateFollowup=(id,body)=>call('update',id,body)
const unavailable=()=>{throw Error('Unexpected appointment API access in CLIN-12 fixture')}
export const reportSessionInvalidated=unavailable,listAppointments=unavailable,getAppointment=unavailable,appointmentAvailability=unavailable,appointmentRecommendation=unavailable,createAppointment=unavailable,rescheduleAppointment=unavailable,cancelAppointmentRemote=unavailable,transitionAppointment=unavailable,searchPatients=unavailable`
const booking=`import React from 'react';export function AppointmentForm({prefill,store,onSaved,submitLabel}){return <button onClick={async()=>{const r=await window.clin12.request('booking',prefill.patientPublicId,prefill);if(r.ok){store.toast('Synthetic appointment confirmed.','success');onSaved(r.record)}else store.toast('Synthetic refusal','warning')}}>{submitLabel}</button>}`
const bundle=await build({absWorkingDir:root,stdin:{contents:source,resolveDir:root,loader:'jsx'},bundle:true,write:false,outfile:'fixture.js',format:'iife',platform:'browser',plugins:[{name:'clin12-isolation',setup(b){
 b.onResolve({filter:/(?:api-client\.js|Scheduling\.jsx|use-clinical-session\.js)$/},args=>({path:args.path,namespace:'clin12'}))
 b.onLoad({filter:/.*/,namespace:'clin12'},args=>({contents:args.path.endsWith('Scheduling.jsx')?booking:args.path.endsWith('use-clinical-session.js')?'export const useClinicalSession=()=>true':api,loader:'jsx',resolveDir:root}))
}}],loader:{'.png':'dataurl','.svg':'dataurl','.woff2':'dataurl'}})
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')),css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))
const server=createServer((req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js.contents)}
 else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css?.contents||'')}
 else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CLIN-12 synthetic follow-up fixture</title><link rel="stylesheet" href="/fixture.css"><body><main id="root" style="padding:16px;max-width:1000px;margin:auto"></main><script src="/fixture.js"></script></body></html>')}
 else if(req.url==='/favicon.ico'){res.statusCode=204;res.end()}
 else{res.statusCode=404;res.end()}
})
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) server.listen(5187,'127.0.0.1',()=>console.log('CLIN-12 synthetic fixture: http://127.0.0.1:5187'))


// Run through Playwright MCP against the loopback server. No hosted services,
// real credentials, patient data, or actual Scheduling implementation are used.
export async function verifyClin12R2(page, origin='http://127.0.0.1:5187') {
 const passed=[],errors=[]
 const pageError=e=>errors.push(e.message);page.on('pageerror',pageError)
 const route=r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort()
 await page.route('**/*',route)
 const check=(value,message)=>{if(!value)throw Error(message)}
 const task=(patient='A',extra={})=>({id:'task-'+patient,patient:{id:patient,name:'Synthetic patient '+patient+' with a deliberately long name',code:'SYN'},branch:{id:'b1',name:'Synthetic long branch'},status:'Open',revision:1,can_contact:true,can_close:true,can_book:true,due_on:'2026-11-20',reason:'Synthetic clinical reason for wrapping and layout checks. '.repeat(7),assignee:'Synthetic staff',...extra})
 const progressed=(action,extra={})=>task('A',{status:action==='close'?'Closed':'Contacted',revision:2,can_contact:false,can_close:action!=='close',...extra})
 const count=n=>page.waitForFunction(n=>window.clin12.calls.length===n,n)
 const button=name=>page.getByRole('button',{name,exact:true})
 const calls=()=>page.evaluate(()=>window.clin12.calls)
 const feedback=()=>page.evaluate(()=>window.clin12.feedback)
 const start=async()=>{await page.goto(origin);await count(1)}
 const change=async(p,n)=>{await page.evaluate(p=>window.clin12.set(p),p);if(n)await count(n)}
 const reply=async(index,result)=>{await page.evaluate(({index,result})=>window.clin12.respond(index,result),{index,result});await page.evaluate(()=>new Promise(requestAnimationFrame))}
 const reload=async(index,result)=>{await button('Reload follow-ups').first().click();await count(index+1);await reply(index,result)}
 try {
  for(const action of ['contacted','close'])for(const ordering of ['A','B']) {
   await start();await reply(0,{ok:true,data:[task()]})
   // A confirmed Add refusal supplies a Reload control while a task is pending.
   await button('Add a follow-up').click();await button('Add follow-up').click();await count(2);await reply(1,{ok:false,kind:'validation',message:'Synthetic refusal'})
   if(action==='close'){await button('Close').click();await page.getByRole('textbox',{name:/Why is it closed/}).fill('Synthetic closure')}
   await button(action==='close'?'Close it':'Contacted').evaluate(e=>{e.click();e.click()});await count(3)
   await button('Reload follow-ups').click();await count(4)
   if(ordering==='A'){
    await reply(3,{ok:true,data:[task()]});check(await button('Contacted').isDisabled(),'replacement row bypassed pending command')
    await reply(2,{ok:false,kind:'network'});await count(5);await reply(4,{ok:true,data:[task()]})
   }else{
    await reply(2,{ok:false,kind:'network'});await reply(3,{ok:true,data:[task()]})
    check(await page.getByText(/settled after this reload began/).isVisible(),'pre-settlement snapshot adopted')
    await reload(4,{ok:true,data:[task()]})
   }
   check(await button('Contacted').isDisabled(),'unchanged Open unlocked uncertain command');check(await button('Close').isDisabled(),'competing Close unlocked')
   await reload(5,{ok:false,kind:'server'});await reload(6,null)
   await reload(7,{ok:true,data:[progressed(action,{branch:{id:'b2',name:'Synthetic other branch'}})]})
   check(await button('Contacted').count()===0||await button('Contacted').isDisabled(),'wrong branch unlocked recovery')
   await reload(8,{ok:true,data:[progressed(action)]})
   if(action==='contacted')check(await button('Close').isEnabled(),'positive Contacted progress failed to reconcile')
   else check(await button('Close').count()===0,'Closed task still offers Close')
   check((await calls()).filter(c=>c.method==='update').length===1,'duplicate mutation dispatched')
   check((await feedback()).length===0,'obsolete command emitted feedback')
   passed.push(action+' ordering '+ordering+': zero duplicates; failed/malformed recovery; branch check; positive progress')
  }
  await start();await reply(0,{ok:true,data:[task(),task('A',{id:'other-task',patient:{id:'A',name:'Synthetic second task',code:'OTHER'}})]})
  await button('Contacted').nth(0).click();await count(2);await reply(1,{ok:false,kind:'network'})
  check(await button('Contacted').nth(0).isDisabled(),'uncertain first task unlocked')
  await button('Contacted').nth(1).click();await count(3)
  await reply(2,{ok:true,data:progressed('contacted',{id:'other-task'})});await count(4)
  await reply(3,{ok:true,data:[task(),progressed('contacted',{id:'other-task'})]})
  check(await button('Contacted').first().isDisabled(),'unrelated success released first task')
  passed.push('unrelated tasks remain independent')
  await start();await reply(0,{ok:true,data:[task()]});await button('Contacted').click();await count(2)
  await change({patient:'B'},3);await change({patient:'A'},4);await reply(3,{ok:true,data:[task()]})
  check(await button('Contacted').isDisabled(),'ABA bypassed pending operation')
  await reply(1,{ok:false,kind:'network'});await count(5);await reply(4,{ok:true,data:[task()]})
  check(await button('Contacted').isDisabled(),'ABA revived uncertain action');check((await feedback()).length===0,'ABA feedback')
  passed.push('patient ABA keeps operation scope and suppresses old feedback')
  await start();await reply(0,{ok:true,data:[]});await button('Add a follow-up').click()
  await page.getByRole('combobox',{name:/Follow-up reason/}).selectOption('Other');const custom=page.getByRole('textbox',{name:/Specify reason/});await custom.fill('Synthetic retained draft')
  await button('Add follow-up').evaluate(e=>{e.click();e.click()});await count(2);await reply(1,{ok:false,kind:'network'})
  await reload(2,{ok:false,kind:'server'});await reload(3,{ok:true,data:[]})
  check(await button('Add follow-up').isDisabled(),'empty list permitted an unsafe Add retry');check(await custom.inputValue()==='Synthetic retained draft','draft lost')
  await change({patient:'B'},5);await reply(4,{ok:true,data:[]});check(await button('Add a follow-up').isEnabled(),'unrelated patient blocked')
  await change({patient:'A'},6);await reply(5,{ok:true,data:[task()]});check(await button('Add a follow-up').isDisabled(),'similar existing task falsely reconciled Add')
  check((await calls()).filter(c=>c.method==='create').length===1,'duplicate Add dispatched')
  passed.push('uncertain Add retained across ABA; empty/similar data cannot authorize resubmission')
  await start();await reply(0,{ok:true,data:[]});await button('Add a follow-up').click();await button('Add follow-up').click();await count(2)
  await reply(1,{ok:true,data:task()});await count(3);await reply(2,{ok:true,data:[task()]})
  check(await button('Add a follow-up').isEnabled(),'known Add receipt did not reconcile');check((await feedback()).length===1,'known Add feedback')
  passed.push('confirmed Add receipt reconciles its exact task')
  for(const mode of ['row','add','booking']) {
   await start();await reply(0,{ok:true,data:mode==='add'?[]:[task()]})
   if(mode==='add'){await button('Add a follow-up').click();await button('Add follow-up').click()}
   else if(mode==='booking'){await button('Book follow-up').click();await button('Book the follow-up').click()}
   else await button('Contacted').click()
   await count(2);await page.evaluate(()=>window.clin12.replaceAuth())
   await reply(1,mode==='row'?{ok:true,data:progressed('contacted')}:mode==='add'?{ok:true,data:task()}:{ok:true,record:{id:'synthetic-appointment'}})
   check((await feedback()).length===0,'old auth '+mode+' feedback');check((await calls()).length===2,'old auth '+mode+' navigation/reload')
   await change({patient:'A'},3);await reply(2,{ok:true,data:[task()]})
   passed.push('same-account auth replacement suppresses '+mode+' completion before rerender')
  }
  await start();await reply(0,{ok:true,data:[task()]});await button('Contacted').click();await count(2);await change({mode:'hidden'});await reply(1,{ok:false,kind:'network'})
  check((await feedback()).length===0,'unmounted feedback');await change({mode:'panel'},3);await reply(2,{ok:true,data:[task()]})
  check(await button('Contacted').isDisabled(),'remount lost recovery guard');passed.push('unmount preserves recovery without adopting obsolete feedback')
  await start();await page.evaluate(()=>window.clin12.invalidateAuth());await change({mode:'page'})
  check(await page.getByRole('heading',{name:'Follow-ups',exact:true}).isVisible(),'unavailable session lost page context')
  check(await page.getByText('Session unavailable',{exact:true}).isVisible(),'invalid auth not blocked')
  check((await calls()).length===1,'unavailable session fetched clinical data');check(await button('Contacted').count()===0,'unavailable session exposed actions')
  passed.push('unavailable auth preserves generic page context and blocks clinical requests/actions')
  // Fresh document for a genuine ordinary editor, independent of recovery locks.
  await start();await reply(0,{ok:true,data:[task()]})
  const widths=[]
  for(const width of [375,430,768,1024,1440]) {
   await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width)
   await button('Close').click();const note=page.getByRole('textbox',{name:/Why is it closed/});await note.fill('Synthetic accessible closure');await note.press('Tab')
   check(await button('Book follow-up').evaluate(e=>e===document.activeElement),'Book focus '+width);await page.keyboard.press('Tab');check(await button('Contacted').evaluate(e=>e===document.activeElement),'Contacted focus '+width);await page.keyboard.press('Tab');check(await button('Close it').evaluate(e=>e===document.activeElement),'Close focus '+width);await button('Cancel').click();widths.push(width)
  }
  check(errors.length===0,errors.join(';'))
  return {passed,viewports:widths,pageErrors:errors,limits:'Mocked transport and booking boundary; no server authentication, operation receipt or hosted-service acceptance.'}
 }finally{page.off('pageerror',pageError);await page.unroute('**/*',route)}
}
