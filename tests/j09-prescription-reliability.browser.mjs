import assert from 'node:assert/strict'
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,evidence,target,api,base} from './local-visit-support.mjs'

const phase=process.env.J09_PHASE||'after'
assert.ok(['before','after'].includes(phase))
const fixture=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const prerequisite=target.runtime+'/j09-context.json'
const state=existsSync(prerequisite)?JSON.parse(readFileSync(prerequisite,'utf8')):{}
const result={phase,accepted:false,flows:{},requests:[]}
const save=()=>writeFileSync(prerequisite,JSON.stringify(state,null,2))
let page,clicks=0
async function cmd(name,args){return page.evaluate(async({name,args})=>{const a=await import('/src/api-client.js'),r=await a[name](...args);if(!r.ok)throw Error('Synthetic prerequisite refused: '+r.kind);return r.data},{name,args})}
async function post(path,action){const pending=page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST');const [r]=await Promise.all([pending,action()]);assert.ok(r.status()<300);return (await r.json()).data}
async function click(locator){clicks++;await locator.click()}
async function fillMedicine(text){await page.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('__other__');await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).fill(text)}
async function ready(){await page.getByRole('region',{name:'Prescription Patient and Visit',exact:true}).waitFor();await page.getByRole('combobox',{name:/^Visit/}).waitFor();await page.waitForTimeout(300)}
const counts=start=>result.requests.slice(start).reduce((n,r)=>{const key=r.method+' '+r.path;n[key]=(n[key]||0)+1;return n},{})
async function capture(name){for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/'+phase+'-'+name+'-'+width+'.png',fullPage:true})}}

try{
 const staff=await login('sprint02.staff@example.test');page=staff.page
 if(!state.visit){state.visit=await cmd('walkInVisit',[{patient_id:fixture.patientId,branch_ref:fixture.branch,service_ref:fixture.service,dentist_ref:fixture.dentist},'j09-arrival']);save()}
 const visit=(await get(page,'/api/visits/'+state.visit.id)).body.data
 if(visit.queue.status==='Waiting')await cmd('queueCommand',[visit.queue.id,'call',{expected_revision:visit.queue.revision},'j09-call'])
 await staff.context.close()
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 page.on('request',r=>{const u=new URL(r.url());if(u.origin===api&&(/prescriptions|\/visits\//.test(u.pathname)))result.requests.push({method:r.method(),path:u.pathname})})
 await click(page.getByRole('button',{name:'My Queue',exact:true}).first())
 if(!state.treatment){await click(page.getByRole('button',{name:'Open encounter',exact:true}).first());await click(page.getByRole('button',{name:'Add performed procedure',exact:true}));await page.getByRole('combobox',{name:'Procedure 1',exact:true}).selectOption(fixture.service);await page.getByRole('textbox',{name:'Chief complaint',exact:true}).fill('Synthetic J09 examination');await page.getByRole('textbox',{name:'Procedure / treatment performed',exact:true}).fill('Synthetic J09 performed procedure');state.treatment=await post('/api/visits/'+state.visit.id+'/treatment',()=>page.getByRole('button',{name:'Start Treatment',exact:true}).click());save()}
 else await click(page.getByRole('button',{name:'Continue treatment',exact:true}).first())
 await page.getByRole('textbox',{name:'Clinical notes',exact:true}).waitFor()
 await page.getByText(/Saved revision [0-9]+\. Review before completing\./).waitFor()
 await page.getByRole('textbox',{name:'Clinical notes',exact:true}).fill('Synthetic J09 comparison '+phase+' '+Date.now())
 await post('/api/treatments/'+state.treatment.id+'/document',()=>page.getByRole('button',{name:'Save Treatment Progress',exact:true}).click())
 await page.getByText(/Saved on the clinic server/).waitFor()
 let start=result.requests.length;clicks=0
 await click(page.getByRole('button',{name:'Open visit prescriptions',exact:true}));await ready()
 result.flows.openComposer={startingScreen:'Active treatment',startingStatus:'In Treatment',activations:clicks,requests:counts(start)}
 const stable=result.requests.filter(r=>r.path==='/api/prescriptions/visits').length
 await page.getByRole('textbox',{name:'Note (optional)',exact:true}).fill('Synthetic J09 local rerender')
 await page.waitForTimeout(300)
 assert.equal(result.requests.filter(r=>r.path==='/api/prescriptions/visits').length,stable,'typing cannot reload the catalog')
 if(phase==='after')assert.equal(result.flows.openComposer.requests['GET /api/prescriptions/visits'],1)
 await fillMedicine('Synthetic J09 blank '+phase)
 if(phase==='after')await capture('composer')
 start=result.requests.length
 await click(page.getByRole('button',{name:'Issue prescription',exact:true}));await click(page.getByRole('dialog',{name:'Issue and lock prescription?',exact:true}).getByRole('button',{name:'Issue prescription',exact:true}))
 const dialog=page.getByRole('dialog');await dialog.getByText('Synthetic J09 blank '+phase,{exact:true}).waitFor()
 const mine=(await get(page,'/api/prescriptions?visit_id='+state.visit.id+'&patient_id='+fixture.patientId+'&page=1&per_page=20')).body.data
 const blank=mine.find(p=>p.status==='Issued');assert.ok(blank)
 const savedBlank=(await get(page,'/api/prescriptions/'+blank.id)).body.data;assert.equal(savedBlank.visit,state.visit.id);assert.equal(savedBlank.patient.id,fixture.patientId)
 result.flows.blankIssue={startingScreen:'Active treatment → blank linked composer',startingStatus:'No prescription',activations:clicks,selections:1,textEntries:2,requests:counts(start),completion:{id:blank.id,status:savedBlank.status,revision:savedBlank.revision}}
 await click(dialog.getByRole('button',{name:'Close',exact:true}))
 await fillMedicine('Synthetic J09 saved '+phase)
 const draft=await post('/api/prescriptions',()=>click(page.getByRole('button',{name:'Save draft',exact:true})))
 await click(page.getByRole('dialog').getByRole('button',{name:'Edit draft',exact:true}));await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).waitFor();await page.waitForTimeout(200)
 start=result.requests.length;clicks=0
 await click(page.getByRole('button',{name:'Issue prescription',exact:true}));await click(page.getByRole('dialog',{name:'Issue and lock prescription?',exact:true}).getByRole('button',{name:'Issue prescription',exact:true}));await page.getByRole('dialog').getByText('Synthetic J09 saved '+phase,{exact:true}).waitFor()
 const issued=(await get(page,'/api/prescriptions/'+draft.id)).body.data
 result.flows.unchangedDraftIssue={startingScreen:'Loaded saved Draft editor',startingStatus:'Draft',activations:clicks,textEntries:0,requests:counts(start),completion:{id:issued.id,status:issued.status,revision:issued.revision},baseRevision:draft.revision}
 assert.equal(issued.status,'Issued');assert.equal(issued.visit,state.visit.id)
 if(phase==='after'){assert.equal(result.flows.unchangedDraftIssue.requests['PUT /api/prescriptions/'+draft.id]||0,0);assert.equal(issued.revision,draft.revision+1)}
 await click(page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}))
 await fillMedicine('Synthetic J09 recovery '+phase)
 const recovery=await post('/api/prescriptions',()=>click(page.getByRole('button',{name:'Save draft',exact:true})))
 let fail='network'
 await page.route(api+'/api/visits/'+state.visit.id,r=>fail==='network'?r.abort('failed'):fail==='denied'?r.fulfill({status:403,json:{message:'Synthetic J09 Visit denied'}}):r.continue())
 const draftRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/prescriptions/'+recovery.id&&r.request().method()==='GET')
 await click(page.getByRole('dialog').getByRole('button',{name:'Edit draft',exact:true}));await draftRead;await page.getByRole('button',{name:'Retry loading visits',exact:true}).waitFor()
 const medicine=page.getByRole('textbox',{name:'Specify medicine name',exact:true})
 if(phase==='after')await medicine.waitFor()
 result.flows.failedVisit={draftId:recovery.id,medicineVisible:await medicine.count()>0&&await medicine.isVisible(),falseEmptyState:await page.getByText('No eligible visits found.',{exact:true}).count()>0}
 if(phase==='after'){assert.equal(result.flows.failedVisit.medicineVisible,true);assert.equal(await medicine.inputValue(),'Synthetic J09 recovery '+phase);assert.equal(await page.getByRole('button',{name:'Issue prescription',exact:true}).isDisabled(),true)}
 if(phase==='after')await capture('visit-error')
 if(phase==='after'){
  fail='denied';await click(page.getByRole('button',{name:'Retry loading visits',exact:true}))
  await page.getByText('Synthetic J09 Visit denied',{exact:true}).waitFor()
  const issue=page.getByRole('button',{name:'Issue prescription',exact:true})
  if(await issue.count())assert.equal(await issue.isDisabled(),true)
  result.flows.deniedVisit={visibleError:true,issuanceBlocked:true}
 }
 fail=false
 if(phase==='after'){await page.getByRole('button',{name:'Retry loading visits',exact:true}).focus();await page.keyboard.press('Enter')}
 else await click(page.getByRole('button',{name:'Retry loading visits',exact:true}))
 await medicine.waitFor();assert.equal(await medicine.inputValue(),'Synthetic J09 recovery '+phase)
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Issue prescription')?.disabled)
 await page.getByRole('textbox',{name:'Note (optional)',exact:true}).fill('Synthetic J09 dirty change')
 start=result.requests.length
 await click(page.getByRole('button',{name:'Issue prescription',exact:true}));await click(page.getByRole('dialog',{name:'Issue and lock prescription?',exact:true}).getByRole('button',{name:'Issue prescription',exact:true}));await page.getByRole('dialog').getByText('Synthetic J09 recovery '+phase,{exact:true}).waitFor()
 const dirty=(await get(page,'/api/prescriptions/'+recovery.id)).body.data;assert.equal(dirty.note,'Synthetic J09 dirty change');assert.equal(dirty.revision,recovery.revision+2)
 result.flows.dirtyDraftIssue={requests:counts(start),completion:{id:dirty.id,status:dirty.status,revision:dirty.revision}}
 assert.equal(result.flows.dirtyDraftIssue.requests['PUT /api/prescriptions/'+recovery.id],1)
 await capture('issued')
 assert.equal((await get(page,'/api/treatments/'+state.treatment.id)).body.data.status,'In Treatment')
 const patient=await login('sprint02.patient@example.test',390);page=patient.page;await page.getByRole('button',{name:/^Prescriptions/}).click();await page.getByRole('heading',{name:dirty.number,exact:true}).waitFor()
 if(phase==='after'){
  await capture('patient-prescriptions')
  await page.route(api+'/api/prescriptions/'+dirty.id+'/pdf',r=>r.abort('failed'),{times:1})
  await page.getByRole('button',{name:'Download PDF for '+dirty.number,exact:true}).click()
  await page.getByText('Could not reach the clinic system. Check your connection and try again.',{exact:true}).waitFor()
 }
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF for '+dirty.number,exact:true}).focus();await page.keyboard.press('Enter');assert.equal(readFileSync(await(await download).path()).subarray(0,4).toString(),'%PDF')
 result.accepted=true;console.log('PASS',phase,JSON.stringify(result.flows))
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/'+phase+'-failure.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/'+phase+'-failure.png',fullPage:true})}throw error}finally{writeFileSync(evidence+'/'+phase+'-results.json',JSON.stringify(result,null,2));await browser.close()}
