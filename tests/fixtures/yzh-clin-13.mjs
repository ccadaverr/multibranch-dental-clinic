// CLIN-13 loopback-only fixture. All transport/PDF calls are synthetic.
import {build} from 'esbuild'
import {createServer} from 'node:http'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=fileURLToPath(new URL('../..',import.meta.url))
const source=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {PrescriptionDialog} from './src/pages/ServerPrescriptions.jsx'
import './src/styles.css';import './src/foundation.css';import './src/polish.css'
const pending=new Map();let generation=1
const getAuthGeneration=()=>generation
window.clin13={calls:[],feedback:[],changed:0,closed:0,replaceAuth(){generation++},request(method,id,reason){const index=this.calls.length;this.calls.push({method,id,reason});return new Promise((resolve,reject)=>pending.set(index,{resolve,reject}))},respond(index,result){if(!pending.has(index))throw Error('Unknown request '+index);pending.get(index).resolve(result);pending.delete(index)},reject(index){pending.get(index).reject(Error('Synthetic outage'));pending.delete(index)}}
function Harness(){const [options,setOptions]=React.useState({id:'A',shown:true})
 window.clin13.set=patch=>flushSync(()=>setOptions(o=>({...o,...patch})))
 return options.shown?<PrescriptionDialog id={options.id} getAuthGeneration={getAuthGeneration} toast={(...args)=>window.clin13.feedback.push(args)} onChanged={()=>{window.clin13.changed++}} onClose={()=>{window.clin13.closed++;setOptions(o=>({...o,shown:false}))}}/>:<button onClick={()=>setOptions(o=>({...o,shown:true}))}>Open prescription</button>
}
createRoot(document.getElementById('root')).render(<Harness/>)
`
const api=`const call=(method,id,reason)=>window.clin13.request(method,id,reason)
export const onSessionInvalidated=()=>()=>{}
export const prescription=id=>call('read',id)
export const voidPrescription=(id,reason)=>call('void',id,reason)
export const downloadPrescriptionPdf=id=>call('pdf',id)
const unavailable=()=>{throw Error('Unexpected API in CLIN-13 fixture')}
export const createPrescription=unavailable,issuePrescription=unavailable,listPrescriptions=unavailable,prescriptionVisits=unavailable,savePrescriptionLicense=unavailable,updatePrescription=unavailable
export const reportSessionInvalidated=unavailable,listAppointments=unavailable,getAppointment=unavailable,appointmentAvailability=unavailable,appointmentRecommendation=unavailable,createAppointment=unavailable,rescheduleAppointment=unavailable,cancelAppointmentRemote=unavailable,transitionAppointment=unavailable,searchPatients=unavailable`
const bundle=await build({absWorkingDir:root,stdin:{contents:source,resolveDir:root,loader:'jsx'},bundle:true,write:false,outfile:'fixture.js',format:'iife',platform:'browser',plugins:[{name:'clin13-isolation',setup(b){b.onResolve({filter:/api-client\.js$/},args=>({path:args.path,namespace:'clin13'}));b.onLoad({filter:/.*/,namespace:'clin13'},()=>({contents:api,loader:'js',resolveDir:root}))}}],loader:{'.png':'dataurl','.svg':'dataurl','.woff2':'dataurl'}})
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')),css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))
const server=createServer((req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js.contents)}
 else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css?.contents||'')}
 else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CLIN-13 synthetic prescription dialog</title><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}
 else if(req.url==='/favicon.ico'){res.statusCode=204;res.end()}else{res.statusCode=404;res.end()}
})
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)server.listen(5188,'127.0.0.1',()=>console.log('CLIN-13 fixture: http://127.0.0.1:5188'))

export async function verifyClin13(page,origin='http://127.0.0.1:5188'){
 const passed=[],errors=[],check=(v,m)=>{if(!v)throw Error(m)}
 const handler=e=>errors.push(e.message);page.on('pageerror',handler)
 const route=r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort();await page.route('**/*',route)
 const issued=(id='A',extra={})=>({id,number:'RX-SYNTHETIC-'+id,status:'Issued',revision:2,patient:{id:'patient-'+id,name:'Synthetic patient '+id+' with a long name'},visit:'visit-'+id,branch:'Synthetic branch',dentist:'Synthetic dentist',can_void:true,can_edit:false,voided:null,lines:[{medicine:'Synthetic medicine',dosage:'Synthetic dosage'}],...extra})
 const voided=(id='A',extra={})=>issued(id,{status:'Void',revision:3,can_void:false,voided:{at:'2026-11-10T14:00:00Z',reason:'Synthetic correction'},...extra})
 const button=n=>page.getByRole('button',{name:n,exact:true}),count=n=>page.waitForFunction(n=>window.clin13.calls.length===n,n)
 const state=()=>page.evaluate(()=>({calls:window.clin13.calls,feedback:window.clin13.feedback,changed:window.clin13.changed,closed:window.clin13.closed}))
 const reply=async(index,result)=>{await page.evaluate(({index,result})=>window.clin13.respond(index,result),{index,result});await page.evaluate(()=>new Promise(requestAnimationFrame))}
 const start=async()=>{await page.goto(origin);await count(1);await reply(0,{ok:true,data:issued()})}
 const fill=async()=>{await button('Void\u2026').click();await page.getByRole('textbox',{name:/Reason for voiding/}).fill('  Synthetic correction  ')}
 const reload=async(index,result)=>{await button('Reload prescription').first().click();await count(index+1);await reply(index,result)}
 try{
  await start();await fill();await button('Void this prescription').evaluate(e=>{e.click();e.click()});await count(2)
  check(await page.getByRole('textbox',{name:/Reason for voiding/}).isDisabled(),'pending reason is editable')
  await reply(1,{ok:true,data:voided()});let snapshot=await state()
  check(snapshot.calls.filter(c=>c.method==='void').length===1,'duplicate Void');check(snapshot.calls[1].id==='A'&&snapshot.calls[1].reason==='Synthetic correction','submitted identity/reason changed')
  check(snapshot.feedback.length===1&&snapshot.changed===1,'valid success feedback');check(await button('Void this prescription').count()===0,'Void action remains after success');passed.push('same-tick duplicates, captured target/reason and valid success')
  for(const result of [{ok:false,kind:'network'},{ok:false,kind:'server'},{ok:true,data:voided('B')},{ok:true,data:voided('A',{revision:2})},{ok:true,data:issued()}]){
   await start();await fill();await button('Void this prescription').click();await count(2);await reply(1,result)
   check(await button('Void this prescription').isDisabled(),'uncertain result enabled repeat');check((await state()).feedback.length===0,'unconfirmed result toasted success')
   await reload(2,{ok:false,message:'Synthetic outage'});await reload(3,{ok:true,data:issued()})
   check(await button('Void this prescription').isDisabled(),'unchanged Issued unlocked repeat')
   await reload(4,{ok:true,data:voided()});check(await button('Void this prescription').count()===0,'recovered Void remains actionable');check((await state()).calls.filter(c=>c.method==='void').length===1,'recovery retried Void')
   passed.push('uncertain/mismatched result recovery '+JSON.stringify(result.kind||result.data?.status)+' '+(result.data?.id||''))
  }
  await start();await fill();await button('Void this prescription').click();await count(2);await page.evaluate(()=>window.clin13.reject(1));await page.getByText(/could not be confirmed/).first().waitFor()
  check(await button('Void this prescription').textContent()==='Void this prescription','rejection left busy spinner');check(await button('Void this prescription').isDisabled(),'rejection enabled repeat');passed.push('rejected request releases busy and retains recovery protection')
  await start();await fill();await button('Void this prescription').click();await count(2);await page.keyboard.press('Escape');check(await page.getByRole('dialog').count()===0,'Escape did not dismiss')
  await reply(1,{ok:true,data:voided()});check((await state()).feedback.length===0&&(await state()).changed===0,'dismissed request feedback')
  await button('Open prescription').click();await count(3);await reply(2,{ok:true,data:voided()});check(await button('Void\u2026').count()===0,'closed/reopened Void is actionable');passed.push('Escape dismissal, no obsolete feedback, safe reopen')
  await start();await fill();await button('Void this prescription').click();await count(2)
  await page.evaluate(()=>window.clin13.set({id:'B'}));await count(3);await reply(2,{ok:true,data:issued('B')})
  await page.evaluate(()=>window.clin13.set({id:'A'}));await count(4);await reply(3,{ok:true,data:issued()});check(await button('Void\u2026').isDisabled(),'ABA bypassed pending command')
  await reply(1,{ok:false,kind:'network'});await count(5);await reply(4,{ok:true,data:issued()})
  check((await state()).feedback.length===0&&(await state()).changed===0,'ABA completion adopted');check(await button('Void\u2026').isDisabled(),'ABA recovery bypass');passed.push('A-B-A selection preserves original operation and suppresses stale feedback')
  await start();await fill();await button('Void this prescription').click();await count(2);await page.evaluate(()=>window.clin13.replaceAuth());await reply(1,{ok:true,data:voided()})
  check((await state()).feedback.length===0&&(await state()).changed===0,'same-account old-auth completion adopted')
  await page.evaluate(()=>window.clin13.set({}));await count(3);await reply(2,{ok:true,data:voided()});passed.push('same-account auth replacement rejects obsolete response')
  await page.goto(origin);await count(1);await reply(0,{ok:true,data:issued('B')});check(await page.getByText(/did not match/).isVisible(),'wrong detail ID displayed');check(await button('Void\u2026').count()===0,'wrong detail is actionable');passed.push('mismatched detail fails closed')
  await start();const widths=[]
  for(const width of [375,430,768,1024,1440]){await page.setViewportSize({width,height:900});await fill();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);await page.getByRole('textbox',{name:/Reason for voiding/}).press('Tab');check(await button('Download PDF').evaluate(e=>e===document.activeElement),'PDF keyboard focus '+width);await page.keyboard.press('Tab');check(await button('Void this prescription').evaluate(e=>e===document.activeElement),'Void keyboard focus '+width);await page.keyboard.press('Escape');check(await page.getByRole('dialog').count()===0,'Escape '+width);const index=(await state()).calls.length;await button('Open prescription').click();await count(index+1);await reply(index,{ok:true,data:issued()});widths.push(width)}
  check(errors.length===0,errors.join(';'));return {passed,viewports:widths,pageErrors:errors,limits:'Synthetic requests and modal only; no real clinic calls, backend authorization or server auth-instance acceptance.'}
 }finally{page.off('pageerror',handler);await page.unroute('**/*',route)}
}
