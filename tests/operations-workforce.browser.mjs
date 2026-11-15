import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

// Real owned local runtime only. Private password stays in process memory; no trace/cookie/credential export.
const container = 'dentalops-joevan-ops-20261115'
const status = JSON.parse(execFileSync('docker', ['exec', container, 'python3', 'scripts/local-system.py', '--target', '/private/ops/target.json', '--profile', 'demo', 'status'], { encoding:'utf8' }))
assert.equal(status.classification, 'owned isolated development')
assert.equal(status.database, 'dental_clinic_demo')
const privatePassword = execFileSync('docker', ['exec', container, 'cat', '/private/ops/demo-login-password'], { encoding:'utf8' }).trim()
const fixture = JSON.parse(execFileSync('docker', ['exec', container, 'cat', '/private/ops/operations-browser-fixture.json'], { encoding:'utf8' }))
const noticeTitle = 'Operations QA archive example '+fixture.run_id
const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const browser = await chromium.launch({ headless:true, channel:'chrome' })
const api = 'http://127.0.0.1:8104', frontend = 'http://127.0.0.1:5195'
const results = []
const csrfHeaders = async context => ({ 'X-XSRF-TOKEN':decodeURIComponent((await context.cookies(api)).find(c=>c.name==='XSRF-TOKEN').value), Origin:frontend, Referer:frontend+'/' })
const read = async (context,path) => {
  const response=await context.request.get(api+path,{headers:{Origin:frontend,Referer:frontend+'/'}})
  assert.equal(response.status(),200,'Authoritative read must be authenticated')
  return response.json()
}
async function signIn(email) {
  const context = await browser.newContext({ viewport:{width:1440,height:900} })
  await context.route('**/*', route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
  const page = await context.newPage(); page.setDefaultTimeout(15000)
  await page.goto(frontend+'/#sign-in')
  await page.locator('.login-button').waitFor() // Finish the initial /me probe before creating a session.
  await context.request.get(api+'/sanctum/csrf-cookie')
  const response = await context.request.post(api+'/api/login', {headers:await csrfHeaders(context),data:{email,password:privatePassword}})
  assert.equal(response.status(),200,'Synthetic sign-in must succeed')
  await page.reload()
  try { await page.getByRole('button',{name:/^Notifications/}).first().waitFor() }
  catch { throw Error('Synthetic '+email+' session did not open: '+(await page.locator('body').innerText()).slice(0,500)) }
  return {context,page}
}
try {
  for (const [role,email] of [['owner','owner@example.test'],['staff','staff.reception@example.test'],['dentist','dentist@example.test']]) {
    const {context,page} = await signIn(email)
    await page.getByRole('button',{name:/^Notifications/}).first().click()
    const note = page.locator('.notification-row').filter({hasText:noticeTitle})
    await note.waitFor()
    const requests=[]
    page.on('request',r=>{if(r.url().endsWith('/archive'))requests.push(r.url())})
    await page.route('**/api/notifications/*/archive',async route=>{const committed=await route.fetch();assert.equal(committed.status(),200);await route.abort('failed')},{times:1})
    await note.getByRole('button',{name:'Archive '+noticeTitle,exact:true}).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button',{name:'Retry archive',exact:true}).click()
    await page.getByRole('button',{name:'Archived notifications',exact:true}).click()
    await note.waitFor()
    const widths=[]
    for(const width of [375,390,430,768,1024,1440]){
      await page.setViewportSize({width,height:900})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Notification workflow must fit '+width)
      widths.push(width)
    }
    assert.equal(requests.length,2)
    assert.equal(requests[0],requests[1],'Uncertain archive must retry the exact target')
    const archived=await read(context,'/api/notifications?collection=archived')
    assert.equal(archived.data.find(n=>n.title===noticeTitle)?.archived,true)
    await context.close()
    const fresh=await signIn(email)
    const persisted=await read(fresh.context,'/api/notifications?collection=archived')
    assert.equal(persisted.data.find(n=>n.title===noticeTitle)?.id,archived.data.find(n=>n.title===noticeTitle).id)
    if(role==='owner') {
      const p=fresh.page,c=fresh.context
      await p.getByRole('button',{name:'Dentist & Staff',exact:true}).click()
      const sourceDuty=(await read(c,'/api/work-schedules')).data.duty
      await p.getByRole('button',{name:'Refresh duty',exact:true}).waitFor()
      assert.equal(await p.getByText('Doctor is on duty today',{exact:true}).count(),sourceDuty.rows.filter(r=>r.on_duty_today).length,'Owner duty must match the actual dated projection')
      await p.getByRole('button',{name:/^Staff(?:\s*\d+)?$/}).click()
      await p.getByRole('button',{name:'Edit Profile',exact:true}).first().click()
      const dialog=p.getByRole('dialog',{name:'Edit staff profile',exact:true})
      for(const width of [375,390,430,768,1024,1440]){
        await p.setViewportSize({width,height:900})
        assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Personnel editor must fit '+width)
      }
      await dialog.getByLabel('Staff title',{exact:true}).fill('Synthetic Operations QA title')
      let savedBody=null
      await p.route('**/api/staff/*',async route=>{const committed=await route.fetch();assert.equal(committed.status(),200);savedBody=await committed.json();await route.abort('failed')},{times:1})
      await dialog.getByRole('button',{name:'Save & Synchronize Profile',exact:true}).click()
      await dialog.getByRole('button',{name:'Retry this save',exact:true}).click()
      await dialog.waitFor({state:'hidden'})
      const saved=savedBody.data
      assert.equal(saved.title,'Synthetic Operations QA title')
      await p.getByRole('button',{name:'Edit Profile',exact:true}).first().click()
      await dialog.getByLabel('Staff title',{exact:true}).fill('Refused synthetic draft')
      const concurrent=await c.request.patch(api+'/api/staff/'+saved.id,{headers:await csrfHeaders(c),data:{title:'Concurrent synthetic change',expected_revision:saved.revision,operation_id:randomUUID()}})
      assert.equal(concurrent.status(),200)
      const current=(await concurrent.json()).data
      await dialog.getByRole('button',{name:'Save & Synchronize Profile',exact:true}).click()
      await dialog.getByRole('button',{name:'Discard draft and reload profile',exact:true}).waitFor()
      assert.equal(await dialog.getByLabel('Staff title',{exact:true}).inputValue(),'Refused synthetic draft')
      for(const width of [375,390,430,768,1024,1440]){
        await p.setViewportSize({width,height:900})
        assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Conflict recovery must fit '+width)
      }
      await dialog.getByRole('button',{name:'Discard draft and reload profile',exact:true}).click()
      await p.waitForFunction(()=>document.querySelector('dialog input:not([disabled])')?.value==='Concurrent synthetic change')
      assert.equal(await dialog.getByLabel('Staff title',{exact:true}).inputValue(),'Concurrent synthetic change')
      const rows=(await read(c,'/api/staff')).data
      assert.equal(rows.find(s=>s.id===saved.id).revision,current.revision,'Explicit review must not write or silently rebase')
      await p.keyboard.press('Escape')
      const another=await signIn(email)
      const savedRows=(await read(another.context,'/api/staff')).data
      assert.equal(savedRows.find(s=>s.id===saved.id).revision,current.revision)
      assert.equal(savedRows.find(s=>s.id===saved.id).title,'Concurrent synthetic change')
      await another.context.close()
      results.push({workflow:'staff-personnel',lostResponseRecovered:true,staleDraftPreserved:true,explicitReload:true,newSessionReadback:true,doctorDutyFromAPI:true})
    }
    results.push({role,archiveRetry:true,newSessionReadback:true,widths,keyboardArchive:true})
    await fresh.context.close()
  }
  console.log(JSON.stringify({runtime:'owned synthetic PostgreSQL',results}))
} catch(error) {
  console.error(String(error.message).replaceAll(privatePassword,'[private]'))
  process.exitCode=1
} finally { await browser.close() }
