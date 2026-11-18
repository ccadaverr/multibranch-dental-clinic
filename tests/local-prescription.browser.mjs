// Real local React → Laravel → PostgreSQL. Uses existing persisted synthetic Sprint02 encounters.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
assert.ok(process.env.LOCAL_SYSTEM_EVIDENCE,'Set a fresh private LOCAL_SYSTEM_EVIDENCE directory')
const {browser,login,get,api,evidence,target,base}=await import('./local-visit-support.mjs')
const state={},save=()=>writeFileSync(evidence+'/journey.json',JSON.stringify(state,null,2))
let page
const waitPost=async(page,path,work)=>{const awaited=page.waitForResponse(r=>r.url()===api+path&&r.request().method()!=='GET');await work();const r=await awaited;const body=await r.json();assert.ok(r.status()<300,JSON.stringify(body));return body.data}
try {
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
 if(process.env.LOCAL_SYSTEM_ACTIVE_PRESCRIPTION==='1')await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click()
 else {await page.getByRole('combobox',{name:'Worklist',exact:true}).selectOption('history');await page.getByRole('button',{name:'View completed record',exact:true}).first().click()}
 await page.getByRole('button',{name:'Open visit prescriptions',exact:true}).click()
 await page.getByRole('combobox',{name:/^Visit/}).waitFor()
 const selected=await page.getByRole('combobox',{name:/^Visit/}).inputValue();assert.ok(selected);state.visit=selected
 await page.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('__other__')
 await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).fill('   ')
 assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true)
 await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).fill('Synthetic Sprint03 medicine')
 for(const [field,label] of [['dosage','dosage'],['frequency','frequency'],['duration','duration']]){
  await page.getByRole('combobox',{name:'Select '+field+' 1',exact:true}).selectOption('__other__')
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true)
  await page.getByRole('textbox',{name:'Specify custom '+label,exact:true}).fill('Synthetic '+field+'; demonstration only')
 }
 await page.getByRole('textbox',{name:'Instructions (optional)',exact:true}).fill('Synthetic demonstration only; not for actual use')
 await page.getByRole('textbox',{name:'Note (optional)',exact:true}).fill('Synthetic Sprint03 clinical lifecycle')
 state.draft=await waitPost(page,'/api/prescriptions',()=>page.getByRole('button',{name:'Save draft',exact:true}).evaluate(b=>{b.click();b.click()}));save()
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
 await page.reload();await page.getByRole('button',{name:'Prescriptions',exact:true}).first().click()
 const item=()=>page.locator('ul.fd-list > li').filter({hasText:'Draft'}).filter({hasText:state.draft.patient.name}).first()
 await item().getByRole('button',{name:'Edit draft',exact:true}).click();await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).waitFor()
 assert.equal(await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).inputValue(),'Synthetic Sprint03 medicine')
 console.log('PASS actual Dentist encounter → draft; validation, duplicate Save and persisted reload')
 const patient=await login('sprint02.patient@example.test',390);assert.equal((await get(patient.page,'/api/prescriptions/'+state.draft.id)).status,404);assert.ok(!(await get(patient.page,'/api/me/prescriptions')).body.data.some(p=>p.id===state.draft.id));console.log('PASS Patient draft privacy')
 // A second tab replaces the cookie without notifying the held editor, even for the same Dentist.
 const otherTab=await dentist.context.newPage();await otherTab.goto(base+'/#sign-in')
 await otherTab.getByRole('button',{name:'Sign out',exact:true}).click()
 await otherTab.getByRole('dialog',{name:'Sign out?',exact:true}).getByRole('button',{name:'Sign out',exact:true}).click()
 await otherTab.getByRole('textbox',{name:/email/i}).fill('sprint02.dentist@example.test')
 await otherTab.locator('input[type=password]').fill(readFileSync(target.runtime+'/demo-login-password','utf8').trim())
 const relogin=otherTab.waitForResponse(r=>r.url()===api+'/api/login'&&r.request().method()==='POST')
 await otherTab.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await relogin).status(),200)
 let heldHeader=false
 page.on('request',r=>{if(r.url()===api+'/api/prescriptions/'+state.draft.id+'/issue'&&r.method()==='POST')heldHeader=/^[a-f0-9]{64}$/.test(r.headers()['x-clinical-context']||'')})
 const refused=page.waitForResponse(r=>r.url()===api+'/api/prescriptions/'+state.draft.id+'/issue'&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Issue prescription',exact:true}).click()
 await page.getByRole('dialog',{name:'Issue and lock prescription?',exact:true}).getByRole('button',{name:'Issue prescription',exact:true}).click()
 assert.equal((await refused).status(),409);assert.equal(heldHeader,true)
 assert.equal((await get(page,'/api/prescriptions/'+state.draft.id)).body.data.status,'Draft')
 await otherTab.close();await page.reload();await page.getByRole('button',{name:'Prescriptions',exact:true}).first().click()
 await item().getByRole('button',{name:'Edit draft',exact:true}).click();await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).waitFor()
 state.crossTabSessionRefused=true;save();console.log('PASS stale clinical confirmation refused after same-Dentist cross-tab logout/login; Draft remains unissued')
 // Commit on real server, then discard only the outgoing response to force recovery.
 const commands=[];page.on('request',r=>{if(r.url()===api+'/api/prescriptions/'+state.draft.id+'/issue'&&r.method()==='POST')commands.push({key:r.headers()['idempotency-key'],body:r.postDataJSON()})})
 let committed
 await page.route(api+'/api/prescriptions/'+state.draft.id+'/issue',async route=>{const r=await route.fetch();assert.equal(r.status(),200);committed=(await r.json()).data;await route.abort('failed')},{times:1})
 await page.getByRole('button',{name:'Issue prescription',exact:true}).click();await page.getByRole('dialog',{name:'Issue and lock prescription?',exact:true}).getByRole('button',{name:'Issue prescription',exact:true}).click()
 await page.getByRole('button',{name:'Retry same prescription request',exact:true}).waitFor()
 state.issued=await waitPost(page,'/api/prescriptions/'+state.draft.id+'/issue',()=>page.getByRole('button',{name:'Retry same prescription request',exact:true}).click());save()
 assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);assert.equal(state.issued.number,committed.number);assert.equal(state.issued.status,'Issued')
 await page.getByRole('dialog').getByText('Synthetic Sprint03 medicine',{exact:true}).waitFor();console.log('PASS real issue with lost response → same-key UI retry → exact issued number')
 page=patient.page;await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'More',exact:true}).getByRole('button',{name:'Prescriptions',exact:true}).click()
 const patientRx=()=>page.locator('ul.pp-rx-list > li').filter({hasText:state.issued.number})
 await patientRx().getByText('Synthetic Sprint03 medicine',{exact:true}).waitFor()
 const download=page.waitForEvent('download');await patientRx().getByRole('button',{name:/^Download PDF for /}).click();await(await download).saveAs(evidence+'/issued.pdf')
 assert.equal(readFileSync(evidence+'/issued.pdf').subarray(0,5).toString(),'%PDF-');await page.reload();await patientRx().getByText(state.issued.number,{exact:false}).waitFor();console.log('PASS own Patient issued prescription and actual PDF after reload')
 page=dentist.page;const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Void…',exact:true}).click();await dialog.getByRole('textbox',{name:'Reason for voiding',exact:true}).fill('Synthetic correction: demonstration prescription voided')
 const voidPath='/api/prescriptions/'+state.issued.id+'/void',voidRequests=[]
 page.on('request',r=>{if(r.url()===api+voidPath&&r.method()==='POST')voidRequests.push({key:r.headers()['idempotency-key'],body:r.postDataJSON()})})
 await page.route(api+voidPath,async route=>{const r=await route.fetch();assert.equal(r.status(),200);await route.abort('failed')},{times:1})
 await dialog.getByRole('button',{name:'Void this prescription',exact:true}).evaluate(b=>{b.click();b.click()})
 await dialog.getByRole('button',{name:'Retry same Void request',exact:true}).waitFor()
 state.voided=await waitPost(page,voidPath,()=>dialog.getByRole('button',{name:'Retry same Void request',exact:true}).click())
 assert.equal(voidRequests.length,2);assert.deepEqual(voidRequests[0],voidRequests[1]);save();assert.equal(state.voided.number,state.issued.number);assert.equal(state.voided.status,'Void')
 page=patient.page;await page.reload();await patientRx().getByText('VOID — do not use',{exact:true}).waitFor();const voidPdf=page.waitForEvent('download');await patientRx().getByRole('button',{name:/^Download PDF for /}).click();await(await voidPdf).saveAs(evidence+'/void.pdf')
 console.log('PASS authorized Void preserves issued identity and Patient sees VOID with new PDF')
 // Existing correction contract: retain the Void record and explicitly write/issue a new prescription.
 page=dentist.page;await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
 const compose=page.locator('details.rx-compose').first()
 if(!await compose.evaluate(el=>el.open)){await compose.locator(':scope > summary').focus();await page.keyboard.press('Enter')}
 const correctionVisit=page.getByRole('combobox',{name:/^Visit/})
 if(await correctionVisit.isDisabled())assert.equal(await correctionVisit.inputValue(),state.visit)
 else await correctionVisit.selectOption(state.visit)
 await page.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('__other__')
 await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).fill('Synthetic corrected medicine')
 state.correctedDraft=await waitPost(page,'/api/prescriptions',()=>page.getByRole('button',{name:'Save draft',exact:true}).click())
 await page.getByRole('dialog').getByRole('button',{name:'Edit draft',exact:true}).click()
 await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).waitFor()
 await page.getByRole('button',{name:'Issue prescription',exact:true}).click()
 state.corrected=await waitPost(page,'/api/prescriptions/'+state.correctedDraft.id+'/issue',()=>page.getByRole('dialog',{name:'Issue and lock prescription?',exact:true}).getByRole('button',{name:'Issue prescription',exact:true}).click())
 assert.notEqual(state.corrected.id,state.voided.id);assert.notEqual(state.corrected.number,state.voided.number)
 page=patient.page;await page.reload();await page.locator('ul.pp-rx-list > li').filter({hasText:state.corrected.number}).getByText('Synthetic corrected medicine',{exact:true}).waitFor()
 assert.equal((await get(page,'/api/prescriptions/'+state.voided.id)).body.data.status,'Void')
 console.log('PASS explicit new prescription after Void has a distinct issued identity; old evidence remains Void')
 state.accepted=true;save()
}catch(e){if(page){console.log((await page.locator('body').innerText()).slice(-7000));await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw e}finally{await browser.close()}
