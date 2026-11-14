// Real local React -> Laravel/Sanctum -> isolated PostgreSQL. No API response is mocked.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,statSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {userInfo} from 'node:os'

const targetPath=process.env.DENTALOPS_LOCAL_TARGET
assert.ok(targetPath,'Set the private, verified local target manifest')
const info=statSync(targetPath)
assert.equal(info.uid,userInfo().uid);assert.equal(info.mode&0o077,0)
const target=JSON.parse(readFileSync(targetPath,'utf8'))
assert.equal(target.host,'127.0.0.1');assert.equal(target.root,process.cwd())
const base='http://127.0.0.1:5195',api='http://127.0.0.1:8104'
const password=readFileSync(resolve(target.runtime,'demo-login-password'),'utf8').trim()
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const evidence=process.env.LOCAL_SYSTEM_EVIDENCE||resolve(target.runtime,'browser-evidence')
mkdirSync(evidence,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[]
let patientProfile
async function login(role,email,width=1440){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[]
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>[base,api].includes(new URL(route.request().url()).origin)?route.continue():route.abort())
  await page.goto(base+'/#sign-in')
  await page.getByRole('textbox',{name:/email/i}).fill(email)
  const secretInput=page.locator('input[type=password]')
  await secretInput.waitFor({state:'visible'})
  await secretInput.evaluate((input,secret)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,secret)
    input.dispatchEvent(new Event('input',{bubbles:true}))
  },password)
  const response=page.waitForResponse(r=>r.url()===api+'/api/login'&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await response).status(),200)
  return {context,page,errors,role}
}
async function get(page,path){return page.evaluate(async ({api,path})=>{const r=await fetch(api+path,{credentials:'include',headers:{Accept:'application/json'}});return {status:r.status,body:await r.json()}},{api,path})}
try{
  for(const [role,email,width] of [['owner','owner@example.test',1440],['staff','staff.reception@example.test',1440],['dentist','dentist@example.test',1024],['patient','patient@example.test',390]]){
    const w=await login(role,email,width);let me=await get(w.page,'/api/me');assert.equal(me.status,200);assert.equal(me.body.data?.role||me.body.role,role)
    if(role==='patient'){patientProfile=me.body.data.patient;assert.ok(patientProfile?.id&&patientProfile?.code)}
    await w.page.reload();assert.equal((await get(w.page,'/api/me')).status,200)
    await w.page.waitForTimeout(300);assert.deepEqual(w.errors,[]);assert.ok(await w.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await w.page.screenshot({path:evidence+'/role-'+role+'.png',fullPage:true});results.push({name:role+' real login, session/reload and viewport',pass:true});await w.context.close()
  }
  const staff=await login('staff','staff.reception@example.test')
  await staff.page.getByRole('button',{name:'Appointments',exact:true}).click()
  await staff.page.getByRole('button',{name:'New appointment',exact:true}).click()
  const form=staff.page.getByRole('dialog')
  await form.getByRole('textbox',{name:/^Find patient/}).fill(patientProfile.code)
  const patients=form.getByRole('combobox',{name:'Patient',exact:true})
  const patientId=patientProfile.id
  await patients.selectOption(patientId)
  await form.getByRole('combobox',{name:'Service',exact:true}).selectOption({label:'Dental Consultation • 30 min'})
  const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
  const date=new Date(today+'T12:00:00+08:00');date.setUTCDate(date.getUTCDate()+1)
  while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1)
  await form.getByLabel(/^Date/).fill(date.toISOString().slice(0,10))
  await form.getByRole('textbox',{name:'Notes',exact:true}).fill('Synthetic local end-to-end acceptance')
  await form.getByRole('group',{name:'Available start times',exact:true}).getByRole('button').first().click()
  const requests=[];staff.page.on('request',r=>{if(r.url()===api+'/api/appointments'&&r.method()==='POST')requests.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']})})
  const created=staff.page.waitForResponse(r=>r.url()===api+'/api/appointments'&&r.request().method()==='POST')
  await form.getByRole('button',{name:'Confirm appointment',exact:true}).evaluate(button=>{button.click();button.click()})
  const response=await created;assert.equal(response.status(),201);const receipt=await response.json();assert.equal(requests.length,1)
  assert.equal(receipt.data.patient.id,patientId);assert.equal(receipt.data.status,'Confirmed');assert.equal(receipt.data.revision,1)
  await staff.page.reload();const persisted=await get(staff.page,'/api/appointments/'+receipt.data.id);assert.equal(persisted.status,200);assert.equal(persisted.body.data.id,receipt.data.id)
  // The real idempotency journal returns the original receipt without a second appointment.
  const replay=await staff.page.evaluate(async ({api,command})=>{const token=decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('XSRF-TOKEN='))?.slice(11)||'');const r=await fetch(api+'/api/appointments',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json','X-XSRF-TOKEN':token,'Idempotency-Key':command.key},body:JSON.stringify(command.body)});return {status:r.status,body:await r.json()}},{api,command:requests[0]})
  assert.equal(replay.status,201);assert.equal(replay.body.data.id,receipt.data.id);assert.deepEqual(staff.errors,[])
  results.push({name:'Staff real booking, exact patient, duplicate-submit protection, reload and same-key replay',pass:true,appointmentId:receipt.data.id})
  await staff.context.close()
  const patient=await login('patient','patient@example.test',390)
  const visible=await get(patient.page,'/api/appointments/'+receipt.data.id)
  // Exact same server Patient, independently authenticated after Staff booking.
  const self=await get(patient.page,'/api/me');const ownId=self.body.data?.patient?.id||self.body.patient?.id
  assert.equal(ownId,patientId);assert.equal(visible.status,200);assert.equal(visible.body.data.patient.id,patientId)
  assert.deepEqual(patient.errors,[]);await patient.context.close()
  results.push({name:'Patient appointment readback respects authenticated patient ownership',pass:true})
  writeFileSync(evidence+'/results.json',JSON.stringify({realBackend:true,realPostgres:true,externalProviders:false,results},null,2))
  for(const r of results)console.log('PASS '+r.name)
}finally{await browser.close()}
