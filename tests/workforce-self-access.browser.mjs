import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

const container='dentalops-joevan-ops-20261115',target='/private/roster11b/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
assert.equal(JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','demo','status')).classification,'owned isolated development')
const password=run('cat','/private/roster11b/demo-login-password').trim()
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const browser=await chromium.launch({channel:'chrome',headless:true}),contexts=[],errors=[]
const base='http://127.0.0.1:5195',api='http://127.0.0.1:8104'
async function signIn(email) {
  const c=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(c)
  await c.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message))
  await p.goto(base+'/#sign-in');await p.locator('.login-button').waitFor()
  await c.request.get(api+'/sanctum/csrf-cookie')
  assert.equal((await c.request.post(api+'/api/login',{headers:await headers(c),data:{email,password}})).status(),200)
  await p.reload()
  return {c,p}
}
async function headers(c) {return {Origin:base,Referer:base+'/','X-XSRF-TOKEN':decodeURIComponent((await c.cookies(api)).find(k=>k.name==='XSRF-TOKEN').value)}}
async function read(c,path) {const r=await c.request.get(api+path,{headers:{Origin:base,Referer:base+'/'}});assert.equal(r.status(),200,path);return r.json()}
async function mutate(c,method,path,data) {const r=await c.request[method](api+path,{headers:await headers(c),data});assert.equal(r.status(),200,path);return r.json()}
async function schedules(p) {await p.getByRole('button',{name:'Work Schedules',exact:true}).first().click();await p.getByRole('tab',{name:'Staff schedules',exact:true}).click();await p.getByLabel('Staff member',{exact:true}).waitFor()}
const add=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
let owner,userId,originalScopes,originalDentist
try {
  owner=await signIn('owner@example.test')
  userId=(await read(owner.c,'/api/users')).data.find(u=>u.email==='staff.reception@example.test').id
  originalScopes=(await read(owner.c,`/api/users/${userId}/branch-scopes`)).data.branch_scopes.map(b=>b.id)
  const first=await signIn('staff.reception@example.test')
  const own=(await read(first.c,'/api/work-schedules')).data.self_staff;assert.ok(own)
  const branches=(await read(owner.c,'/api/branches')).data
  const branch=branches.find(b=>b.id!==own.branch.id&&b.status!=='Closed');assert.ok(branch)
  await mutate(owner.c,'put',`/api/users/${userId}/branch-scopes`,{branch_refs:[branch.id]})
  const staff=await signIn('staff.reception@example.test'),data=(await read(staff.c,'/api/work-schedules')).data
  assert.equal(data.staff.some(s=>s.id===own.id),false,'Peer directory remains branch scoped')
  assert.equal(data.self_staff.id,own.id,'Exact self descriptor stays reachable')
  await schedules(staff.p);await staff.p.getByLabel('Staff member',{exact:true}).selectOption(own.id)
  assert.equal(await staff.p.getByText('Weekly Staff roster unavailable',{exact:true}).count(),0)
  assert.deepEqual(await staff.p.getByLabel('Duty branch',{exact:true}).locator('option').evaluateAll(rows=>rows.map(r=>r.value)),[branch.id])
  let date='2030-01-07'
  while((await read(staff.c,`/api/staff/${own.id}/roster?date=${date}`)).data)date=add(date,14)
  await staff.p.getByLabel('Schedule record date',{exact:true}).fill(date)
  const editor=staff.p.getByRole('form',{name:'Staff roster editor'})
  await editor.getByLabel('Schedule branch',{exact:true}).selectOption(branch.id)
  await editor.getByLabel('Schedule type',{exact:true}).selectOption('weekly')
  await editor.getByLabel('Effective from',{exact:true}).fill(date);await editor.getByLabel('Effective through (inclusive)',{exact:true}).fill(add(date,4))
  await editor.getByLabel('Monday',{exact:true}).check()
  await editor.getByLabel('Scheduled start',{exact:true}).fill('09:00');await editor.getByLabel('Scheduled end',{exact:true}).fill('17:00')
  await editor.getByRole('button',{name:'Submit schedule request',exact:true}).focus();await staff.p.keyboard.press('Enter')
  await staff.p.getByText('Confirmed Pending, revision 1.',{exact:true}).waitFor()
  await staff.p.getByRole('button',{name:'Show roster history',exact:true}).click()
  await staff.p.getByRole('region',{name:'Staff roster history',exact:true}).getByText(/Revision 1/).waitFor()
  assert.equal((await read(staff.c,`/api/staff/${own.id}/roster?date=${date}`)).data.branch_ref,branch.id)
  await schedules(owner.p);await owner.p.getByLabel('Staff member',{exact:true}).selectOption(own.id)
  const collection=owner.p.getByRole('region',{name:'Staff roster review by branch and date',exact:true})
  await collection.getByLabel('Roster branch',{exact:true}).selectOption(branch.id);await collection.getByLabel('Roster date',{exact:true}).fill(date)
  await collection.getByRole('button',{name:`Review dated draft for ${own.name}`,exact:true}).focus();await owner.p.keyboard.press('Enter')
  for(const [button,notice] of [['Approve roster','Confirmed Approved, revision 2. Publish separately to change duty.'],['Publish approved roster','Confirmed Published, revision 3.']]){
    await owner.p.getByRole('button',{name:button,exact:true}).click();await owner.p.getByRole('dialog').getByRole('button',{name:button,exact:true}).click();await owner.p.getByText(notice,{exact:true}).waitFor()
  }
  const again=await signIn('staff.reception@example.test');await schedules(again.p)
  await again.p.getByLabel('Staff member',{exact:true}).selectOption(own.id);await again.p.getByLabel('Duty date',{exact:true}).fill(date)
  await again.p.getByRole('region',{name:'Effective Staff duty',exact:true}).getByText(/09:00.*17:00.*Published revision 3/).waitFor()
  assert.equal((await read(again.c,'/api/work-schedules')).data.self_staff.branch.id,own.branch.id,'Scheduling never rewrites assignment')
  const widths=[375,390,430,768,1024,1440]
  for(const p of [owner.p,again.p])for(const width of widths){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Fits '+width)}
  await owner.p.setViewportSize({width:1440,height:1000})
  originalDentist=(await read(owner.c,'/api/dentists')).data[0]
  await owner.p.getByRole('button',{name:'Dentist & Staff',exact:true}).click()
  // Both lists preserve the reference endpoint order; legacy display names are
  // transitional Person projections, so persistence is checked by exact ID below.
  await owner.p.getByRole('button',{name:'Edit Profile',exact:true}).first().focus();await owner.p.keyboard.press('Enter')
  const dialog=owner.p.getByRole('dialog',{name:'Edit dentist profile',exact:true})
  await dialog.getByLabel('Specialty',{exact:true}).fill('Synthetic A personnel readback')
  await dialog.getByRole('button',{name:'Save & Synchronize Profile',exact:true}).click()
  await dialog.waitFor({state:'hidden'})
  const updated=(await read(owner.c,'/api/dentists')).data.find(d=>d.id===originalDentist.id)
  assert.equal(updated.specialty,'Synthetic A personnel readback');assert.deepEqual(updated.branch_ids,originalDentist.branch_ids)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({postgres:true,exactSelfOutsideAssignment:true,scopedDirectoryUnchanged:true,requestHistory:true,ownerReview:true,newSignInDuty:true,assignmentUnchanged:true,personnelUiReadback:true,keyboard:true,widths}))
} catch(error) {
  for(const c of contexts)for(const p of c.pages())console.error(JSON.stringify({location:new URL(p.url()).hash,headings:await p.getByRole('heading').allTextContents(),buttons:await p.getByRole('button').allTextContents(),errors}))
  throw error
} finally {
  try {
    if(owner&&userId&&originalScopes)await mutate(owner.c,'put',`/api/users/${userId}/branch-scopes`,{branch_refs:originalScopes})
    if(owner&&originalDentist)await mutate(owner.c,'patch',`/api/dentists/${originalDentist.id}`,{specialty:originalDentist.specialty})
  } finally {for(const c of contexts)await c.close();await browser.close()}
}
