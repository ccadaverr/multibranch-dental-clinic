import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'

export async function runSchedulingAcceptance(page,base='http://127.0.0.1:5180',filter=null){
  page.setDefaultTimeout(5000)
  page.setDefaultNavigationTimeout(30000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const fresh=async(mode='form')=>{await page.goto(`${base}/tests/fixtures/fe-int-p1-scheduling.html?mode=${mode}`);await page.waitForFunction(()=>window.fe?.select)}
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const choose=async()=>{await page.getByRole('button',{name:'2:00 PM',exact:true}).click()}
  const calendarDay=async date=>{
    await page.locator('.daycal-avatar-badge').first().waitFor()
    const day=page.locator(`[data-calendar-date="${date}"]`)
    if(await day.getAttribute('aria-expanded')!=='true')await day.click()
  }
  const cases=[
    ['new booking supersedes an older calendar action detail',async()=>{
      await fresh('calendar');await calendarDay('2026-11-11');await page.evaluate(()=>{window.fe.holdDetails=true})
      await page.getByRole('button',{name:/View appointment details: Synthetic Patient A/}).click()
      await page.getByRole('dialog',{name:'Appointment details',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click()
      await page.waitForFunction(()=>window.fe.details.length===1)
      await page.getByRole('button',{name:/Book an appointment on/}).click()
      await page.getByRole('dialog',{name:'Create appointment',exact:true}).waitFor()
      await page.evaluate(()=>window.fe.details[0].release());await settle()
      assert.equal(await page.getByRole('dialog',{name:'Cancel this appointment?',exact:true}).count(),0)
      assert.equal(await page.getByRole('dialog').count(),1)
    }],
    ['Patient selection changes clear the previously chosen slot',async()=>{
      await fresh('create')
      await page.getByRole('combobox',{name:'Patient',exact:true}).selectOption('patient-A')
      await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('s1');await choose()
      assert.equal(await page.getByRole('button',{name:'Confirm appointment',exact:true}).isEnabled(),true)
      await page.getByRole('combobox',{name:'Patient',exact:true}).selectOption('patient-B')
      assert.equal(await page.getByRole('button',{name:'Confirm appointment',exact:true}).isDisabled(),true)
      assert.equal(await page.getByRole('button',{name:'2:00 PM',exact:true}).getAttribute('aria-pressed'),'false')
    }],
    ['service or Patient changes require fresh restricted-service acknowledgement',async()=>{
      await fresh('create')
      await page.getByRole('combobox',{name:'Patient',exact:true}).selectOption('patient-A')
      await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('s2')
      const acknowledgement=page.getByRole('checkbox',{name:/Prior consultation/})
      await acknowledgement.check();await choose()
      await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('s3')
      assert.equal(await acknowledgement.isChecked(),false)
      await acknowledgement.check();await choose()
      await page.getByRole('combobox',{name:'Patient',exact:true}).selectOption('patient-B')
      assert.equal(await acknowledgement.isChecked(),false)
    }],
    ['same-task Patient change cannot submit the older Patient or slot',async()=>{
      await fresh('create')
      const patient=page.getByRole('combobox',{name:'Patient',exact:true})
      await patient.selectOption('patient-A');await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('s1');await choose()
      await patient.evaluate(select=>{select.value='patient-B';select.dispatchEvent(new Event('change',{bubbles:true}));select.form.requestSubmit()})
      await settle();assert.equal(await page.evaluate(()=>window.fe.commands.length),0)
      assert.equal(await patient.inputValue(),'patient-B')
    }],
    ['same-task acknowledgement withdrawal cannot submit earlier authorization',async()=>{
      await fresh('create')
      await page.getByRole('combobox',{name:'Patient',exact:true}).selectOption('patient-A')
      await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('s2')
      const acknowledgement=page.getByRole('checkbox',{name:/Prior consultation/})
      await acknowledgement.check();await choose()
      await acknowledgement.evaluate(input=>{input.click();input.form.requestSubmit()})
      await settle();assert.equal(await page.evaluate(()=>window.fe.commands.length),0)
      assert.equal(await acknowledgement.isChecked(),false)
    }],
    ['reschedule draft belongs to the displayed appointment',async()=>{
      await fresh();await page.locator('input[type="date"]').fill('2026-11-11');await choose()
      await page.evaluate(()=>window.fe.select('B'))
      assert.match(await page.getByRole('textbox',{name:'Patient',exact:true}).inputValue(),/Patient B/)
      assert.equal(await page.locator('input[type="date"]').inputValue(),'2026-11-12')
      assert.equal(await page.getByRole('button',{name:'Save new time',exact:true}).isDisabled(),true)
    }],
    ['older save cannot close or notify a newer appointment',async()=>{
      await fresh();await choose();await page.getByRole('button',{name:'Save new time',exact:true}).click()
      await page.waitForFunction(()=>window.fe.commands.length===1)
      await page.evaluate(()=>window.fe.select('B'));await page.evaluate(()=>window.fe.commands[0].release());await settle()
      assert.deepEqual(await page.evaluate(()=>window.fe.saved),[])
      assert.deepEqual(await page.evaluate(()=>window.fe.feedback),[])
    }],
    ...['Cancel','No-show'].map(action=>[`${action} immediate duplicate confirmation sends one command`,async()=>{
      await fresh('appointments')
      const row=page.getByRole('row').filter({hasText:'SYNTHETIC-A'})
      await row.getByRole('button',{name:action,exact:true}).click()
      const confirm=page.getByRole('button',{name:action==='Cancel'?'Cancel appointment':'Mark No-show',exact:true})
      await confirm.evaluate(button=>{button.click();button.click()})
      await settle()
      assert.equal(await page.evaluate(()=>window.fe.commands.length),1)
      assert.equal(await page.evaluate(()=>window.fe.commands[0].id),'A')
      await page.evaluate(()=>window.fe.commands.forEach(c=>c.release()));await settle()
    }]),
    ['permission revocation suppresses delayed command feedback',async()=>{
      await fresh('appointments');await page.getByRole('row').filter({hasText:'SYNTHETIC-A'}).getByRole('button',{name:'Cancel',exact:true}).click()
      await page.getByRole('button',{name:'Cancel appointment',exact:true}).click()
      await page.evaluate(()=>window.fe.setPermission(false));await page.evaluate(()=>window.fe.commands[0].release());await settle()
      assert.deepEqual(await page.evaluate(()=>window.fe.feedback),[])
    }],
    ['latest calendar selection owns detail resolution',async()=>{
      await fresh('calendar');await calendarDay('2026-11-10')
      await page.evaluate(()=>{window.fe.holdDetails=true})
      await page.locator('.daycal-expanded-card').getByRole('button',{name:'Cancel',exact:true}).click()
      await page.waitForFunction(()=>window.fe.details.length===1)
      await page.locator('[data-calendar-date="2026-11-12"]').click()
      await page.locator('.daycal-expanded-card').getByRole('button',{name:'Reschedule',exact:true}).click()
      await page.waitForFunction(()=>window.fe.details.length===2)
      await page.evaluate(()=>window.fe.details[1].release())
      await page.getByRole('dialog',{name:'Reschedule appointment',exact:true}).waitFor()
      await page.evaluate(()=>window.fe.details[0].release());await settle()
      assert.equal(await page.getByRole('dialog',{name:'Cancel this appointment?',exact:true}).count(),0)
      assert.match(await page.getByRole('textbox',{name:'Patient',exact:true}).inputValue(),/Patient B/)
    }],
    ['same-tick form submits transmit one reschedule and expose progress',async()=>{
      await fresh();await choose()
      await page.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
      await page.waitForFunction(()=>window.fe.commands.length===1)
      assert.equal(await page.locator('form').getAttribute('aria-busy'),'true')
      assert.equal(await page.locator('input[type="date"]').isDisabled(),true)
      assert.equal(await page.getByText('Saving appointment…',{exact:true}).count(),1)
      await page.evaluate(()=>window.fe.commands[0].release());await settle()
      assert.equal(await page.evaluate(()=>window.fe.commands.length),1)
    }],
    ['validation and unexpected failures retain draft and permit a deliberate retry',async()=>{
      await fresh();await choose();await page.evaluate(()=>{window.fe.holdCommands=false;window.fe.fail=true})
      await page.getByRole('button',{name:'Save new time',exact:true}).click()
      await page.getByRole('alert').filter({hasText:'Synthetic scheduling refusal'}).waitFor()
      assert.equal(await page.locator('input[type="date"]').inputValue(),'2026-11-10')
      assert.equal(await page.getByRole('button',{name:'2:00 PM',exact:true}).getAttribute('aria-pressed'),'true')
      await page.evaluate(()=>{window.fe.fail=false;window.fe.throwCommand=true})
      await page.getByRole('button',{name:'Save new time',exact:true}).click()
      await page.getByRole('alert').filter({hasText:'Your changes are retained'}).waitFor()
      assert.equal(await page.getByRole('button',{name:'Save new time',exact:true}).isEnabled(),true)
      assert.equal(await page.getByRole('button',{name:'2:00 PM',exact:true}).getAttribute('aria-pressed'),'true')
    }],
    ['changed revision rejects a stale draft without silently adopting the new revision',async()=>{
      await fresh();await choose();await page.evaluate(()=>window.fe.changeRow('A',{revision:4}))
      await page.getByRole('button',{name:'Save new time',exact:true}).click()
      await page.getByRole('alert').filter({hasText:'appointment changed'}).waitFor()
      assert.equal(await page.evaluate(()=>window.fe.commands.length),0)
      assert.equal(await page.getByRole('button',{name:'2:00 PM',exact:true}).getAttribute('aria-pressed'),'true')
    }],
    ...['branch','permission','account','A-B-A','unmount','auth-generation'].map(kind=>[`${kind} change suppresses pending form adoption`,async()=>{
      await fresh();await choose();await page.getByRole('button',{name:'Save new time',exact:true}).click()
      await page.evaluate(kind=>{
        if(kind==='branch')window.fe.setSession({branchScopes:['b2']})
        else if(kind==='permission')window.fe.setPermission(false)
        else if(kind==='account')window.fe.setSession({serverUserId:'replacement'})
        else if(kind==='A-B-A'){window.fe.select('B');window.fe.select('A')}
        else if(kind==='auth-generation')window.fe.auth++
        else window.fe.setMounted(false)
      },kind)
      await settle();await page.evaluate(()=>window.fe.commands[0].release());await settle()
      assert.deepEqual(await page.evaluate(()=>window.fe.saved),[])
      assert.deepEqual(await page.evaluate(()=>window.fe.feedback),[])
    }]),
    ['calendar refuses failed, mismatched and terminal details instead of falling back',async()=>{
      for(const kind of ['failure','identity','terminal','revision']){
        await fresh('calendar');await calendarDay('2026-11-10');await page.evaluate(()=>{window.fe.holdDetails=true})
        await page.locator('.daycal-expanded-card').getByRole('button',{name:'Cancel',exact:true}).click()
        await page.waitForFunction(()=>window.fe.details.length===1)
        await page.evaluate(kind=>{
          const entry=window.fe.details[0]
          if(kind==='failure')entry.failure=true
          if(kind==='identity')entry.row.id='wrong'
          if(kind==='terminal')entry.row.status='Checked In'
          if(kind==='revision')delete entry.row.revision
          entry.release()
        },kind)
        await page.getByRole('alert').waitFor()
        assert.equal(await page.getByRole('dialog',{name:'Cancel this appointment?',exact:true}).count(),0)
        assert.deepEqual(await page.evaluate(()=>window.fe.commands),[])
      }
    }],
    ['calendar refreshes action details even when a wider store record exists',async()=>{
      await fresh('calendar&fullWindow=1');await calendarDay('2026-11-10')
      await page.locator('.daycal-expanded-card').getByRole('button',{name:'Cancel',exact:true}).click()
      await page.getByRole('dialog',{name:'Cancel this appointment?',exact:true}).waitFor()
      assert.equal(await page.evaluate(()=>window.fe.details.length),1)
    }],
    ['keyboard confirmation starts safely and Escape restores the opener',async()=>{
      await fresh('appointments')
      const cancel=page.getByRole('row').filter({hasText:'SYNTHETIC-A'}).getByRole('button',{name:'Cancel',exact:true})
      await cancel.focus();await page.keyboard.press('Enter')
      assert.equal(await page.getByRole('button',{name:'Keep appointment',exact:true}).evaluate(el=>el===document.activeElement),true)
      await page.keyboard.press('Escape')
      assert.equal(await cancel.evaluate(el=>el===document.activeElement),true)
      assert.equal(await page.evaluate(()=>window.fe.commands.length),0)
    }],
    ['reschedule layout and keyboard submit remain usable at supported widths',async()=>{
      for(const width of [375,430,768,1024,1440]){
        await page.setViewportSize({width,height:1000});await fresh();await choose()
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`reschedule overflow at ${width}`)
        await page.getByRole('button',{name:'Save new time',exact:true}).focus();await page.keyboard.press('Enter')
        await page.waitForFunction(()=>window.fe.commands.length===1)
        assert.equal(await page.evaluate(()=>window.fe.commands[0].id),'A')
        await page.evaluate(()=>window.fe.commands[0].release());await settle()
      }
    }],
    ['real appointment flow and API adapter preserve reschedule identity, revision and command key',async()=>{
      await fresh('form&pipeline');await choose()
      await page.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
      await page.waitForFunction(()=>window.fe.requests.length===1)
      const request=await page.evaluate(()=>window.fe.requests[0])
      assert.equal(request.id,'A');assert.equal(request.action,'reschedule')
      assert.deepEqual(request.body,{date:'2026-11-10',start_time:'14:00',expected_revision:3})
      assert.equal(typeof request.key,'string');assert.ok(request.key.length>0)
      await page.evaluate(()=>window.fe.requests[0].release())
      await page.waitForFunction(()=>window.fe.saved.length===1)
      assert.equal(await page.evaluate(()=>window.fe.saved[0].id),'A')
      assert.equal(await page.evaluate(()=>window.fe.saved[0].revision),4)
      assert.equal(await page.evaluate(()=>window.fe.refreshes),1)
    }],
    ...['Cancel','No-show'].map(action=>[`${action} uses the real flow and refreshes only after command success`,async()=>{
      await fresh('appointments&pipeline')
      await page.getByRole('row').filter({hasText:'SYNTHETIC-A'}).getByRole('button',{name:action,exact:true}).click()
      const confirm=page.getByRole('button',{name:action==='Cancel'?'Cancel appointment':'Mark No-show',exact:true})
      await confirm.evaluate(button=>{button.click();button.click()})
      await page.waitForFunction(()=>window.fe.requests.length===1)
      assert.equal(await page.evaluate(()=>window.fe.refreshes),0)
      const request=await page.evaluate(()=>window.fe.requests[0])
      assert.equal(request.id,'A');assert.deepEqual(request.body,{expected_revision:3})
      assert.equal(request.action,action==='Cancel'?'cancel':'no-show')
      assert.ok(request.key)
      await page.evaluate(()=>window.fe.requests[0].release())
      await page.waitForFunction(()=>window.fe.refreshes===1)
      await page.getByRole('row').filter({hasText:'SYNTHETIC-A'}).getByText(action==='Cancel'?'Cancelled':'No-show',{exact:true}).waitFor()
      assert.equal(await page.evaluate(()=>window.fe.requests.length),1)
    }]),
    ['real-flow stale-revision refusal keeps the draft and rotates the retry key',async()=>{
      await fresh('form&pipeline');await choose();await page.evaluate(()=>{window.fe.holdCommands=false;window.fe.fail=true})
      await page.getByRole('button',{name:'Save new time',exact:true}).click()
      await page.getByRole('alert').or(page.getByRole('status')).filter({hasText:'Availability changed'}).waitFor()
      assert.equal(await page.getByRole('button',{name:'2:00 PM',exact:true}).getAttribute('aria-pressed'),'true')
      assert.equal(await page.evaluate(()=>window.fe.saved.length),0)
      await page.evaluate(()=>{window.fe.fail=false})
      await page.getByRole('button',{name:'Save new time',exact:true}).click()
      await page.waitForFunction(()=>window.fe.saved.length===1)
      const keys=await page.evaluate(()=>window.fe.requests.map(request=>request.key))
      assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1])
    }],
  ]
  const failed=[]
  for(const[name,run]of cases){if(filter&&!new RegExp(filter).test(name))continue;try{await run();console.log(`PASS ${name}`)}catch(error){failed.push(name);console.log(`FAIL ${name}: ${error.message}`)}}
  assert.deepEqual(errors,[])
  assert.deepEqual(failed,[],'scheduling acceptance failures')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const{chromium}=await import(pathToFileURL(process.argv[2]).href)
  const browser=await chromium.launch({headless:true,channel:'chrome'})
  try{await runSchedulingAcceptance(await browser.newPage(),process.argv[3],process.argv[4])}finally{await browser.close()}
}
