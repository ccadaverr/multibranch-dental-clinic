import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

const container='dentalops-joevan-ops-20261115',target='/private/roster11b/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
const status=JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','demo','status'))
assert.equal(status.classification,'owned isolated development');assert.equal(status.appliedMigrations,87)
const password=run('cat','/private/roster11b/demo-login-password').trim()
const {chromium}=await import(pathToFileURL(process.argv[2]).href),browser=await chromium.launch({channel:'chrome',headless:true})
const base='http://127.0.0.1:5195',api='http://127.0.0.1:8104',errors=[]
const contexts=[]
async function signIn(email) {
  const c=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(c)
  await c.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message))
  await p.goto(base+'/#sign-in');await p.locator('.login-button').waitFor();await c.request.get(api+'/sanctum/csrf-cookie')
  const headers={Origin:base,Referer:base+'/','X-XSRF-TOKEN':decodeURIComponent((await c.cookies(api)).find(k=>k.name==='XSRF-TOKEN').value)}
  assert.equal((await c.request.post(api+'/api/login',{headers,data:{email,password}})).status(),200)
  await p.reload();await p.getByRole('button',{name:'Work Schedules',exact:true}).first().click();await p.getByRole('tab',{name:'Staff schedules',exact:true}).click()
  await p.getByLabel('Staff member',{exact:true}).waitFor()
  return {c,p,headers}
}
const read=async(c,path)=>{const r=await c.request.get(api+path,{headers:{Origin:base,Referer:base+'/'}});assert.equal(r.status(),200);return r.json()}
const add=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
try {
  const staff=await signIn('staff.reception@example.test')
  const own=(await read(staff.c,'/api/work-schedules')).data.staff.find(s=>s.can_request_roster)
  assert.ok(own,'Exact linked Staff identity');await staff.p.getByLabel('Staff member',{exact:true}).selectOption(own.id)
  let date='2026-11-23'
  while((await read(staff.c,`/api/staff/${own.id}/roster?date=${date}`)).data)date=add(date,14)
  await staff.p.getByLabel('Schedule record date',{exact:true}).fill(date)
  const editor=staff.p.getByRole('form',{name:'Staff roster editor'})
  await editor.getByLabel('Schedule type',{exact:true}).selectOption('weekly')
  await editor.getByLabel('Effective from',{exact:true}).fill(date)
  await editor.getByLabel('Effective through (inclusive)',{exact:true}).fill(add(date,4))
  await editor.getByLabel('Monday',{exact:true}).check();await editor.getByLabel('Tuesday',{exact:true}).check();await editor.getByLabel('Wednesday',{exact:true}).check()
  await editor.getByLabel('Scheduled start',{exact:true}).fill('09:00');await editor.getByLabel('Scheduled end',{exact:true}).fill('17:00')
  await editor.getByRole('button',{name:'Add date exception',exact:true}).click()
  await editor.getByLabel('Exception 1 date',{exact:true}).fill(add(date,1));await editor.getByLabel('Exception 1 type',{exact:true}).selectOption('custom_hours')
  await editor.getByLabel('Exception 1 start',{exact:true}).fill('10:00');await editor.getByLabel('Exception 1 end',{exact:true}).fill('16:00')
  await editor.getByRole('button',{name:'Add date exception',exact:true}).click();await editor.getByLabel('Exception 2 date',{exact:true}).fill(add(date,2))
  await editor.getByRole('button',{name:'Submit schedule request',exact:true}).focus();await staff.p.keyboard.press('Enter')
  await staff.p.getByText('Confirmed Pending, revision 1.',{exact:true}).waitFor()
  assert.equal(await staff.p.getByRole('button',{name:'Approve roster',exact:true}).count(),0)
  assert.equal((await read(staff.c,`/api/staff/${own.id}/duty?branch_ref=${own.branch.id}&date=${date}`)).data.available,false)
  const owner=await signIn('owner@example.test')
  await owner.p.getByLabel('Staff member',{exact:true}).selectOption(own.id)
  const collection=owner.p.getByRole('region',{name:'Staff roster review by branch and date',exact:true})
  await collection.getByLabel('Roster branch',{exact:true}).selectOption(own.branch.id);await collection.getByLabel('Roster date',{exact:true}).fill(date)
  const review=collection.getByRole('button',{name:`Review dated draft for ${own.name}`,exact:true});await review.focus();await owner.p.keyboard.press('Enter')
  await owner.p.getByRole('button',{name:'Approve roster',exact:true}).click()
  await owner.p.getByRole('dialog').getByRole('button',{name:'Approve roster',exact:true}).click()
  await owner.p.getByText('Confirmed Approved, revision 2. Publish separately to change duty.',{exact:true}).waitFor()
  assert.equal((await read(owner.c,`/api/staff/${own.id}/duty?branch_ref=${own.branch.id}&date=${date}`)).data.available,false)
  let dropped=false,receipt;const commands=[]
  await owner.p.route('**/api/staff/*/roster/publish',async route=>{
    commands.push(route.request().postData())
    if(dropped)return route.continue()
    dropped=true;const r=await route.fetch();assert.equal(r.status(),200);receipt=await r.json();await route.abort('failed')
  })
  await owner.p.getByRole('button',{name:'Publish approved roster',exact:true}).click()
  await owner.p.getByRole('dialog').getByRole('button',{name:'Publish approved roster',exact:true}).click()
  await owner.p.getByRole('button',{name:'Retry original roster command',exact:true}).waitFor()
  assert.equal(await owner.p.getByLabel('Schedule record date',{exact:true}).isDisabled(),true)
  await owner.p.getByRole('button',{name:'Retry original roster command',exact:true}).click()
  await owner.p.getByText('Confirmed Published, revision 3.',{exact:true}).waitFor()
  assert.equal(commands.length,2);assert.equal(commands[0],commands[1])
  await owner.p.getByRole('button',{name:'Show roster history',exact:true}).click()
  const history=owner.p.getByRole('region',{name:'Staff roster history',exact:true});await history.getByText(/Revision 3 · Published/).waitFor();assert.equal(await history.getByRole('listitem').count(),3)
  const again=await signIn('staff.reception@example.test');await again.p.getByLabel('Staff member',{exact:true}).selectOption(own.id)
  await again.p.getByLabel('Duty branch',{exact:true}).selectOption(own.branch.id);await again.p.getByLabel('Duty date',{exact:true}).fill(date)
  const duty=again.p.getByRole('region',{name:'Effective Staff duty',exact:true});await duty.getByText('09:00–17:00 · Published revision 3',{exact:true}).waitFor()
  assert.equal((await read(again.c,`/api/staff/${own.id}/roster?date=${date}`)).data.publication_id,receipt.data.publication_id)
  for(const [d,hours] of [[add(date,1),'10:00–16:00 · Published revision 3'],[add(date,2),null],[add(date,7),null]]){
    await again.p.getByLabel('Duty date',{exact:true}).fill(d)
    if(hours)await duty.getByText(hours,{exact:true}).waitFor();else await duty.getByText('No effective working hours for this branch and date.',{exact:true}).waitFor()
  }
  const widths=[375,390,430,768,1024,1440]
  for(const p of [owner.p,again.p])for(const width of widths){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Workflow fits '+width)}
  await owner.p.getByRole('button',{name:'Audit Trail',exact:true}).click()
  await owner.p.getByLabel('Operational activity',{exact:true}).selectOption('staff_roster.published')
  await owner.p.getByLabel('Branch',{exact:true}).selectOption(own.branch.id)
  await owner.p.getByRole('button',{name:'Inspect',exact:true}).first().waitFor()
  const audit=(await read(owner.c,`/api/audit-logs?action=staff_roster.published&branch_id=${own.branch.id}`)).data
  assert.ok(audit.some(a=>a.payload?.receipt?.publication_id===receipt.data.publication_id),'Exact publication audit is discoverable under branch/action filters')
  await owner.p.getByRole('button',{name:'Work Schedules',exact:true}).first().click();await owner.p.getByRole('tab',{name:'Staff schedules',exact:true}).click()
  await owner.p.getByLabel('Staff member',{exact:true}).selectOption(own.id);await owner.p.getByLabel('Schedule record date',{exact:true}).fill(date)
  const currentEditor=owner.p.getByRole('form',{name:'Staff roster editor'})
  await currentEditor.getByLabel('Scheduled end',{exact:true}).fill('16:30')
  await currentEditor.getByRole('button',{name:'Save roster draft',exact:true}).click()
  await owner.p.getByText('Confirmed Draft, revision 4.',{exact:true}).waitFor()
  const saved=(await read(owner.c,`/api/staff/${own.id}/roster?date=${date}`)).data
  const body=Object.fromEntries(['date','branch_ref','kind','weekdays','effective_from','effective_until','start_time','end_time','exceptions'].map(k=>[k,saved[k]]))
  const currentHeaders={...owner.headers,'X-XSRF-TOKEN':decodeURIComponent((await owner.c.cookies(api)).find(k=>k.name==='XSRF-TOKEN').value)}
  const external=await owner.c.request.put(api+`/api/staff/${own.id}/roster`,{headers:currentHeaders,data:{...body,end_time:'16:00',expected_revision:4,operation_id:crypto.randomUUID()}})
  assert.equal(external.status(),200)
  let approvalRequests=0;owner.p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/roster/approve'))approvalRequests++})
  await owner.p.getByRole('button',{name:'Approve roster',exact:true}).click();await owner.p.getByRole('dialog').getByRole('button',{name:'Approve roster',exact:true}).click()
  await owner.p.getByRole('button',{name:'Discard entries and reload roster',exact:true}).waitFor();assert.equal(approvalRequests,1)
  await owner.p.getByRole('button',{name:'Discard entries and reload roster',exact:true}).click()
  await owner.p.waitForFunction(()=>[...document.querySelectorAll('input[type=time]')].some(e=>e.value==='16:00'))
  assert.equal(approvalRequests,1,'Reload requires a new explicit approval intent')
  assert.equal((await read(owner.c,`/api/staff/${own.id}/duty?branch_ref=${own.branch.id}&date=${date}`)).data.windows[0].end_time,'17:00','Unpublished conflicting edits retain published duty')
  let release,started,finished;const held=new Promise(r=>release=r),began=new Promise(r=>started=r),done=new Promise(r=>finished=r)
  const delayed=async route=>{if(new URL(route.request().url()).searchParams.get('date')!==date)return route.continue();const response=await route.fetch();started();await held;try{await route.fulfill({response})}finally{finished()}}
  await again.p.route('**/api/staff/*/duty?*',delayed)
  await again.p.getByLabel('Duty date',{exact:true}).fill(date);await began
  await again.p.getByLabel('Duty date',{exact:true}).fill(add(date,1));await duty.getByText('10:00–16:00 · Published revision 3',{exact:true}).waitFor()
  release();await done;await again.p.unroute('**/api/staff/*/duty?*',delayed)
  assert.equal(await again.p.getByLabel('Duty date',{exact:true}).inputValue(),add(date,1))
  assert.equal(await duty.getByText('09:00–17:00 · Published revision 3',{exact:true}).count(),0)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({postgres:true,staffRequest:true,ownerReview:true,separateApprovalPublication:true,committedResponseLoss:true,exactReplay:true,newSessionReadback:true,exceptions:true,periodBoundary:true,history:true,keyboard:true,widths}))
} finally {for(const c of contexts)await c.close();await browser.close()}
