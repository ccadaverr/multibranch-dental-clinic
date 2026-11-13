// Actual TemplateEditor, deferred in-memory previews. No email/provider calls.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {build} from 'esbuild'
import {readFileSync} from 'node:fs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {TemplateEditor} from './src/pages/Automations.jsx';
window.preview={calls:[],feedback:[],changes:[],pending:new Map()};
function Harness(){const[t,setT]=React.useState({key:'synthetic',name:'Synthetic wording',revision:1,subject:'Revision one',body:'First wording',placeholders:[],owner_approval:{by:'Synthetic'},dentist_approval:{by:'Synthetic'}});const[shown,setShown]=React.useState(true),[readOnly,setReadOnly]=React.useState(false);window.preview.template=t;window.preview.setTemplate=v=>flushSync(()=>setT(v));window.preview.show=v=>flushSync(()=>setShown(v));window.preview.readOnly=v=>flushSync(()=>setReadOnly(v));return shown?<div className="cd-page dentist-wording"><TemplateEditor template={t} canEdit={!readOnly} showTest={false} toast={(...x)=>window.preview.feedback.push(x)} onChanged={x=>window.preview.changes.push(x)}/></div>:<p>Unmounted</p>}createRoot(document.getElementById('root')).render(<Harness/>);`
const api=`export const previewMessageTemplate=(key,body)=>{const i=window.preview.calls.length;window.preview.calls.push({key,body});return new Promise((resolve,reject)=>window.preview.pending.set(i,{resolve,reject}))};const unexpected=()=>{throw Error('No mutation or provider operation is allowed')};export const approveMessageTemplate=unexpected,listAutomations=unexpected,listMessageTemplates=unexpected,runAutomationDemo=unexpected,testAutomation=unexpected,testMessageTemplate=unexpected,updateAutomation=unexpected,updateMessageTemplate=unexpected,reportSessionInvalidated=unexpected,listAppointments=unexpected,getAppointment=unexpected,appointmentAvailability=unexpected,appointmentRecommendation=unexpected,createAppointment=unexpected,rescheduleAppointment=unexpected,cancelAppointmentRemote=unexpected,transitionAppointment=unexpected,searchPatients=unexpected;`
const out=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},plugins:[{name:'preview-only-api',setup(b){b.onResolve({filter:/api-client\.js$/},()=>({path:'api',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:api,loader:'js'}))}}]})
const css=['src/styles.css','src/foundation.css','src/patient.css','src/public-site.css','src/polish.css','src/patient/portal.css','src/landing.css','src/automations.css','src/dentist-wording.css'].filter(f=>{try{readFileSync(f);return true}catch{return false}}).map(f=>readFileSync(f,'utf8')).join('\n')
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/h.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/h.js'?out.outputFiles[0].contents:req.url==='/style.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/h.js"></script>')})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port
let browser;const completed=[]
try{
 browser=await chromium.launch({headless:true,channel:'chrome'});const p=await browser.newPage();p.setDefaultTimeout(5000);const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort())
 const start=async(width=390)=>{await p.setViewportSize({width,height:900});await p.goto(origin);await p.waitForFunction(()=>window.preview?.calls.length===1)}
 const reply=async(index,subject)=>{await p.evaluate(({index,subject})=>{window.preview.pending.get(index).resolve({ok:true,data:{subject,html:'<p>'+subject+'</p>'}});window.preview.pending.delete(index)},{index,subject});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
 for(const width of [375,390,430,768,1024,1440]){
  await start(width);await reply(0,'ORIGINAL PREVIEW');await p.frameLocator('iframe').getByText('ORIGINAL PREVIEW').waitFor()
  await p.getByRole('textbox',{name:'Subject',exact:true}).fill('Edited subject')
  assert.equal(await p.locator('iframe').count(),0,'editing invalidates preview of earlier wording')
  await p.getByRole('button',{name:'Preview my changes',exact:true}).click();await p.waitForFunction(()=>window.preview.calls.length===2);assert.equal((await p.evaluate(()=>window.preview.calls))[1].body.subject,'Edited subject')
  await p.getByRole('textbox',{name:'Subject',exact:true}).fill('Newest subject')
  await p.getByRole('button',{name:'Preview my changes',exact:true}).click();await p.waitForFunction(()=>window.preview.calls.length===3)
  await reply(2,'NEWEST PREVIEW');await p.frameLocator('iframe').getByText('NEWEST PREVIEW').waitFor();await reply(1,'STALE PREVIEW')
  assert.equal(await p.frameLocator('iframe').getByText('NEWEST PREVIEW').count(),1);assert.equal(await p.getByText('Subject: “STALE PREVIEW”').count(),0)
  completed.push(width+': draft change and out-of-order previews retain newest wording')
  await start(width);await p.evaluate(()=>window.preview.setTemplate({...window.preview.template,revision:2,subject:'Revision two',body:'Second wording'}));await p.waitForFunction(()=>window.preview.calls.length===2)
  await reply(1,'REVISION TWO');await reply(0,'REVISION ONE');assert.equal(await p.frameLocator('iframe').getByText('REVISION TWO').count(),1)
  completed.push(width+': revision replacement rejects old response')
  await start(width);await p.evaluate(()=>window.preview.pending.get(0).reject(Error('SYNTHETIC PRIVATE TRANSPORT DETAIL')))
  await p.getByRole('alert').filter({hasText:'Preview could not be loaded'}).waitFor();assert.equal(await p.getByText('SYNTHETIC PRIVATE TRANSPORT DETAIL').count(),0)
  await p.getByRole('button',{name:'Generate preview',exact:true}).click();await p.waitForFunction(()=>window.preview.calls.length===2);await reply(1,'RECOVERED');await p.frameLocator('iframe').getByText('RECOVERED').waitFor()
  completed.push(width+': rejected preview is sanitized and retryable')
  await start(width);await p.evaluate(()=>window.preview.show(false));await reply(0,'UNMOUNTED PREVIEW');assert.equal(await p.locator('iframe').count(),0);assert.deepEqual(await p.evaluate(()=>window.preview.feedback),[]);assert.deepEqual(await p.evaluate(()=>window.preview.changes),[])
  completed.push(width+': unmount neither displays nor mutates')
  await start(width);await p.evaluate(()=>window.preview.readOnly(true));await reply(0,'DENTIST PREVIEW');await p.frameLocator('iframe').getByText('DENTIST PREVIEW').waitFor()
  assert.equal(await p.getByRole('textbox').count(),0,'Dentist wording remains read-only');assert.equal(await p.getByRole('button',{name:'Save wording'}).count(),0)
  const refresh=p.getByRole('button',{name:'Preview formatted email',exact:true});await refresh.focus();assert.equal(await refresh.evaluate(el=>el===document.activeElement),true)
  await refresh.press('Enter');await p.waitForFunction(()=>window.preview.calls.length===2);await reply(1,'DENTIST REFRESHED');await p.frameLocator('iframe').getByText('DENTIST REFRESHED').waitFor()
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow')
  assert.deepEqual(await p.evaluate(()=>window.preview.changes),[]);assert.deepEqual(await p.evaluate(()=>window.preview.feedback),[])
  completed.push(width+': Dentist read-only keyboard refresh and responsive preview')
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:completed.length,completed},null,2))
}finally{await browser?.close();await new Promise(r=>server.close(r))}
