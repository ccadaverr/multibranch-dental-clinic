import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'

export async function runAdminSchedulingAcceptance(page,base='http://127.0.0.1:5180',filter=null){
 page.setDefaultTimeout(5000)
 page.setDefaultNavigationTimeout(30000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 page.on('console',message=>{if(/same key|unique.*key/i.test(message.text()))errors.push(message.text())})
 await page.route('**/tile.openstreetmap.org/**',r=>r.abort())
 const fresh=async(mode='branches')=>{await page.goto(`${base}/tests/fixtures/fe-int-p1-admin.html?mode=${mode}`);await page.waitForFunction(()=>window.admin?.setRole)}
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const publish=()=>page.getByRole('button',{name:'Publish Branch Changes',exact:true})
 const change=()=>page.getByRole('button',{name:'Change Monday at Synthetic branch b1',exact:true})
 const cases=[
  ['Branch Publish blocks immediate duplicate writes and pending edits',async()=>{
   await fresh();await page.getByRole('textbox',{name:'Branch name',exact:true}).fill('Synthetic draft')
   await publish().evaluate(button=>{button.click();button.click()});await page.waitForFunction(()=>window.admin.writes.length)
   assert.equal(await page.evaluate(()=>window.admin.writes.length),1)
   assert.equal(await page.getByRole('textbox',{name:'Branch name',exact:true}).isDisabled(),true)
   await page.evaluate(()=>window.admin.writes.forEach(w=>w.release()));await settle()
  }],
  ['Branch Publish does not adopt a response after account replacement',async()=>{
   await fresh();await publish().click();await page.waitForFunction(()=>window.admin.writes.length===1)
   await page.evaluate(()=>window.admin.setAccount('replacement'));await page.evaluate(()=>window.admin.writes[0].release());await settle()
   assert.deepEqual(await page.evaluate(()=>window.admin.adopted),[])
   assert.deepEqual(await page.evaluate(()=>window.admin.feedback),[])
  }],
  ['Dentist weekly-hour save blocks duplicate submissions',async()=>{
   await fresh('schedules');await change().click()
   await page.locator('form.st-hours').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
   await page.waitForFunction(()=>window.admin.writes.length)
   assert.equal(await page.evaluate(()=>window.admin.writes.length),1)
   await page.evaluate(()=>window.admin.writes.forEach(w=>w.release()));await settle()
  }],
  ['Dentist replacement discards old hours draft and obsolete save feedback',async()=>{
   await fresh('schedules');await change().click();await page.locator('.st-hours input[type="time"]').first().fill('09:15')
   await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>window.admin.writes.length===1)
   await page.getByRole('combobox',{name:'Dentist',exact:true}).selectOption('d2')
   assert.equal(await page.getByRole('combobox',{name:'Dentist',exact:true}).inputValue(),'d2')
   await page.evaluate(()=>window.admin.writes[0].release());await settle()
   assert.deepEqual(await page.evaluate(()=>window.admin.feedback),[])
   assert.equal(await page.getByRole('combobox',{name:'Dentist',exact:true}).inputValue(),'d2')
   assert.equal(await page.locator('.st-hours').count(),0)
   await change().click()
   assert.equal(await page.locator('.st-hours').count(),1)
   assert.equal(await page.locator('.st-hours input[type="time"]').first().inputValue(),'08:00')
  }],
  ['Dentist schedule permission change suppresses obsolete saves',async()=>{
   await fresh('schedules');await change().click();await page.getByRole('button',{name:'Save',exact:true}).click()
   await page.waitForFunction(()=>window.admin.writes.length===1);await page.evaluate(()=>window.admin.setRole('staff'))
   await page.evaluate(()=>window.admin.writes[0].release());await settle()
   assert.deepEqual(await page.evaluate(()=>window.admin.feedback),[])
   assert.equal(await change().count(),0)
  }],
  ['Branch Publish retains edits after validation and network failures',async()=>{
   await fresh();await page.getByRole('textbox',{name:'Branch name',exact:true}).fill('Synthetic unsaved edit')
   await page.evaluate(()=>{window.admin.holdWrites=false;window.admin.fail=true})
   await publish().click();await page.getByRole('alert').filter({hasText:'Synthetic save refused'}).waitFor()
   assert.equal(await page.getByRole('textbox',{name:'Branch name',exact:true}).inputValue(),'Synthetic unsaved edit')
   await page.evaluate(()=>{window.admin.fail=false;window.admin.throwWrite=true})
   await publish().click();await page.waitForFunction(()=>window.admin.writes.length===2);await settle()
   assert.equal(await page.getByRole('alert').count(),1)
   assert.equal(await page.getByRole('textbox',{name:'Branch name',exact:true}).inputValue(),'Synthetic unsaved edit')
   assert.equal(await publish().isEnabled(),true)
   assert.deepEqual(await page.evaluate(()=>window.admin.adopted),[])
  }],
  ['Branch Publish refuses a mismatched response identity',async()=>{
   await fresh();await page.evaluate(()=>{window.admin.holdWrites=false;window.admin.wrongId=true})
   await publish().click();await page.getByRole('alert').filter({hasText:'could not be confirmed'}).waitFor()
   assert.deepEqual(await page.evaluate(()=>window.admin.adopted),[])
  }],
  ['Branch selection stays owned while Publish is pending',async()=>{
   await fresh();await publish().click();await page.waitForFunction(()=>window.admin.writes.length===1)
   assert.equal(await page.getByRole('button',{name:'Configure',exact:true}).isDisabled(),true)
   await page.locator('.branch-overview-card').nth(1).click()
   assert.equal(await page.getByRole('textbox',{name:'Branch name',exact:true}).inputValue(),'Synthetic branch b1')
   await page.evaluate(()=>window.admin.writes[0].release());await settle()
   assert.equal(await page.evaluate(()=>window.admin.adopted[0].id),'b1')
  }],
  ['authentication generation changes suppress Branch Publish adoption without a prior render',async()=>{
   await fresh();await publish().click();await page.waitForFunction(()=>window.admin.writes.length===1)
   await page.evaluate(()=>{window.admin.auth++;window.admin.writes[0].release()});await settle()
   assert.deepEqual(await page.evaluate(()=>window.admin.adopted),[])
   assert.deepEqual(await page.evaluate(()=>window.admin.feedback),[])
  }],
  ['same-task branch selection and Publish cannot submit the previous branch',async()=>{
   await fresh()
   await page.evaluate(()=>{
    const buttons=[...document.querySelectorAll('button')]
    buttons.find(button=>button.textContent==='Configure').click()
    buttons.find(button=>button.textContent==='Publish Branch Changes').click()
   });await settle()
   const requests=await page.evaluate(()=>window.admin.writes.map(({path,body})=>({path,body})))
   assert.ok(requests.length<=1)
   if(requests.length){assert.equal(requests[0].path,'/api/branches/b2');assert.equal(requests[0].body.name,'Synthetic branch b2')}
   await page.evaluate(()=>window.admin.writes.forEach(write=>write.release()));await settle()
  }],
  ['branch service updates block same-task duplicates',async()=>{
   await fresh();await page.getByRole('button',{name:/^Services/}).click()
   await page.getByRole('checkbox').evaluate(input=>{input.click();input.click()})
   await page.waitForFunction(()=>window.admin.writes.length>0)
   assert.equal(await page.evaluate(()=>window.admin.writes.length),1)
   assert.equal(await page.getByRole('checkbox').isDisabled(),true)
   await page.evaluate(()=>window.admin.writes.forEach(write=>write.release()));await settle()
  }],
  ['branch service results cannot be adopted by a replacement account',async()=>{
   await fresh();await page.getByRole('button',{name:/^Services/}).click();await page.getByRole('checkbox').click()
   await page.waitForFunction(()=>window.admin.writes.length===1)
   await page.evaluate(()=>window.admin.setAccount('replacement'))
   await page.evaluate(()=>window.admin.writes[0].release());await settle()
   assert.deepEqual(await page.evaluate(()=>window.admin.adoptedServices),[])
  }],
  ['weekly-hour validation retains edits and successful keyboard retry restores focus',async()=>{
   await fresh('schedules');await change().focus();await page.keyboard.press('Enter')
   await page.locator('.st-hours input[type="time"]').first().fill('09:15')
   await page.evaluate(()=>{window.admin.holdWrites=false;window.admin.fail=true})
   await page.getByRole('button',{name:'Save',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Synthetic scheduling validation refusal'}).waitFor()
   assert.equal(await page.locator('.st-hours input[type="time"]').first().inputValue(),'09:15')
   await page.evaluate(()=>{window.admin.fail=false})
   await page.getByRole('button',{name:'Save',exact:true}).focus();await page.keyboard.press('Enter')
   await change().waitFor()
   assert.equal(await change().evaluate(el=>el===document.activeElement),true)
   assert.equal(await page.evaluate(()=>window.admin.writes.length),2)
  }],
  ['profile-hour copying guards duplicate requests and restores keyboard context',async()=>{
   await fresh('schedules&profile')
   const copy=page.getByRole('button',{name:'Start from these hours at Synthetic branch b1',exact:true})
   await copy.evaluate(button=>{button.click();button.click()})
   await page.waitForFunction(()=>window.admin.writes.length===1)
   assert.equal(await copy.isDisabled(),true)
   assert.equal(await page.getByText('Copying profile hours…',{exact:true}).count(),1)
   await page.evaluate(()=>window.admin.writes[0].release());await change().waitFor()
   assert.equal(await page.getByRole('combobox',{name:'Dentist',exact:true}).evaluate(el=>el===document.activeElement),true)
   assert.equal(await page.evaluate(()=>window.admin.writes.length),1)
  }],
  ...['weekly','exception','profile'].map(kind=>[`${kind} save cannot use an obsolete same-task Dentist selection`,async()=>{
   await fresh(kind==='profile'?'schedules&profile':'schedules')
   if(kind==='weekly')await change().click()
   if(kind==='profile')await page.getByRole('button',{name:'Start from these hours at Synthetic branch b1',exact:true}).waitFor()
   if(kind==='exception')await page.locator('.st-exception input[type="date"]').fill('2026-11-12')
   await page.evaluate(kind=>{
    const form=document.querySelector(kind==='weekly'?'.st-hours':'.st-exception')
    const copy=[...document.querySelectorAll('button')].find(button=>button.textContent==='Start from these hours at Synthetic branch b1')
    const select=document.querySelector('select')
    select.value='d2';select.dispatchEvent(new Event('change',{bubbles:true}))
    if(kind==='profile')copy.click();else form.requestSubmit()
   },kind);await settle()
   assert.equal(await page.getByRole('combobox',{name:'Dentist',exact:true}).inputValue(),'d2')
   const writes=await page.evaluate(()=>window.admin.writes.map(({path,body})=>({path,body})))
   assert.ok(writes.length<=1)
   if(writes.length)assert.equal(writes[0].path,`/api/work-schedules/d2/${kind==='weekly'?'weekly':kind==='exception'?'exceptions':'from-profile'}`)
   await page.evaluate(()=>window.admin.writes.forEach(write=>write.release()));await settle()
  }]),
  ['exception removal retains failure feedback and guards duplicate retries',async()=>{
   await fresh('schedules&withException');await page.getByRole('button',{name:'Remove',exact:true}).waitFor()
   await page.evaluate(()=>{window.admin.holdWrites=false;window.admin.fail=true})
   await page.getByRole('button',{name:'Remove',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Synthetic scheduling validation refusal'}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Remove',exact:true}).count(),1)
   await page.evaluate(()=>{window.admin.fail=false;window.admin.holdWrites=true})
   await page.getByRole('button',{name:'Remove',exact:true}).evaluate(button=>{button.click();button.click()})
   await page.waitForFunction(()=>window.admin.writes.length===2)
   assert.equal(await page.getByRole('button',{name:'Remove',exact:true}).isDisabled(),true)
   await page.evaluate(()=>window.admin.writes[1].release())
   await page.getByRole('button',{name:'Remove',exact:true}).waitFor({state:'detached'})
   assert.equal(await page.evaluate(()=>window.admin.writes.length),2)
  }],
  ['schedule exception guards duplicates and does not clear a newer Dentist draft',async()=>{
   await fresh('schedules');await change().waitFor()
   const form=page.locator('.st-exception')
   await form.locator('input[type="date"]').fill('2026-11-12')
   await form.getByRole('textbox',{name:/Reason/}).fill('Synthetic reason')
   await form.evaluate(el=>{el.requestSubmit();el.requestSubmit()})
   await page.waitForFunction(()=>window.admin.writes.length===1)
   assert.equal(await form.getAttribute('aria-busy'),'true')
   await page.getByRole('combobox',{name:'Dentist',exact:true}).selectOption('d2')
   await page.locator('.st-exception input[type="date"]').fill('2026-11-13')
   await page.evaluate(()=>window.admin.writes[0].release());await settle()
   assert.equal(await page.locator('.st-exception input[type="date"]').inputValue(),'2026-11-13')
   assert.deepEqual(await page.evaluate(()=>window.admin.feedback),[])
  }],
  ['a replacement account cannot adopt an older work-schedule load',async()=>{
   await fresh('schedules&holdLoads');await page.waitForFunction(()=>window.admin.loads.length===1)
   await page.evaluate(()=>window.admin.setAccount('replacement'));await page.waitForFunction(()=>window.admin.loads.length===2)
   await page.evaluate(()=>window.admin.loads[1].release());await change().waitFor()
   await page.evaluate(()=>{window.admin.loads[0].payload.dentists[0].name='OBSOLETE DENTIST';window.admin.loads[0].release()});await settle()
   assert.doesNotMatch(await page.locator('main').innerText(),/OBSOLETE/)
  }],
  ['failed work-schedule reads end loading and can be retried',async()=>{
   await fresh('schedules&holdLoads');await page.waitForFunction(()=>window.admin.loads.length===1)
   await page.evaluate(()=>{window.admin.loads[0].fail=true;window.admin.loads[0].release()})
   await page.getByRole('alert').waitFor()
   assert.equal(await page.getByText('Loading work schedules…',{exact:true}).count(),0)
   await page.evaluate(()=>{window.admin.holdLoads=false})
   await page.getByRole('button',{name:'Retry work schedules',exact:true}).focus();await page.keyboard.press('Enter')
   await change().waitFor()
  }],
  ['an older affected-appointments read cannot overwrite the selected Dentist',async()=>{
   await fresh('schedules&holdAffected');await page.waitForFunction(()=>window.admin.affected.length===1)
   await page.getByRole('combobox',{name:'Dentist',exact:true}).selectOption('d2')
   await page.waitForFunction(()=>window.admin.affected.length===2)
   await page.evaluate(()=>window.admin.affected[1].release());await settle()
   await page.evaluate(()=>{window.admin.affected[0].payload.affected=[{id:'obsolete',date:'2026-11-10',time:'13:00',patient:'OBSOLETE PATIENT',service:'Synthetic',branch:'Synthetic',cover:[]}];window.admin.affected[0].release()});await settle()
   assert.doesNotMatch(await page.locator('main').innerText(),/OBSOLETE/)
  }],
  ['branch and hours controls remain reachable at supported widths',async()=>{
   for(const width of [375,430,768,1024,1440]){
    await page.setViewportSize({width,height:1000})
    await fresh();await publish().focus();assert.equal(await publish().evaluate(el=>el===document.activeElement),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`branch overflow at ${width}`)
    await fresh('schedules');await change().click()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`hours overflow at ${width}`)
    await page.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Enter')
    assert.equal(await change().evaluate(el=>el===document.activeElement),true)
   }
  }],
 ]
 const failed=[]
 for(const[name,run]of cases){if(filter&&!new RegExp(filter).test(name))continue;try{await run();console.log(`PASS ${name}`)}catch(error){failed.push(name);console.log(`FAIL ${name}: ${error.message}`)}}
 assert.deepEqual(errors,[],'administrative scheduling render errors')
 assert.deepEqual(failed,[],'administrative scheduling acceptance failures')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const{chromium}=await import(pathToFileURL(process.argv[2]).href),browser=await chromium.launch({headless:true,channel:'chrome'})
 try{await runAdminSchedulingAcceptance(await browser.newPage(),process.argv[3],process.argv[4])}finally{await browser.close()}
}
