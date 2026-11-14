// Real components and HTTP adapters; synthetic responses and loopback only.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
const base=process.env.QA_URL||'http://127.0.0.1:5194',results=[]
const browser=await chromium.launch({headless:true,channel:'chrome'})
async function check(name,run){
 if(process.env.QA_CASE&&!name.includes(process.env.QA_CASE))return
 const p=await browser.newPage({viewport:{width:390,height:1000},hasTouch:true}),errors=[];p.setDefaultTimeout(7000)
 p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort())
 await p.route('**/sanctum/**',r=>r.fulfill({status:204}));await p.route('**/api/**',r=>r.fulfill({json:{data:[]}}))
 try{await run(p);assert.deepEqual(errors,[]);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));results.push({name,ok:true});console.log('PASS '+name)}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+': '+e.message)}finally{await p.close()}
}
const idRecord=id=>({id,profile_access:'full',minor:false,has_online_account:true,id_check:null})
const member=id=>({patient:{id},active:{id:'membership-'+id,status:'active',provider_name:'Synthetic provider',member_number:'SYNTHETIC-'+id},history:[]})
async function idFixture(p,{failed=false,outcome='network'}={}){
 const reads=[],posts=[];let readFailure=failed,hold=false,release,projection=null
 await p.route('**/api/patients/**',async r=>{
  const req=r.request(),path=new URL(req.url()).pathname,id=path.split('/')[3]
  if(req.method()==='GET'){
   reads.push(id);if(hold)await new Promise(resolve=>{release=resolve})
   return readFailure?r.fulfill({status:503,json:{message:'Synthetic read failure'}}):r.fulfill({json:{data:projection||idRecord(id)}})
  }
  posts.push({path,body:req.postDataJSON()})
  if(outcome==='network')return r.abort()
  return r.fulfill({json:{data:{id_type:req.postDataJSON().id_type,other_details:req.postDataJSON().other_details??null,id_verified_at:outcome==='bad-receipt'?123:'2026-11-14T10:00:00+08:00'}}})
 })
 await p.goto(base+'/tests/fixtures/qa-batch06.html')
 return{reads,posts,setFail:v=>{readFailure=v},setHold:v=>{hold=v},setRecord:v=>{projection=v},release:()=>release?.()}
}
try{
 await check('GEN-13 ID recovery is icon-only pending and read-only',async p=>{
  const f=await idFixture(p,{failed:true});const b=p.getByRole('button',{name:'Reload ID status',exact:true});await b.waitFor()
  assert.equal(await b.textContent(),'');assert.equal(await b.locator('svg').count(),1)
  f.setFail(false);f.setHold(true);await b.evaluate(e=>{e.click();e.click()});await p.getByText('Loading patient ID status…',{exact:true}).waitFor();await p.waitForTimeout(100)
  assert.deepEqual(f.reads,['patient-A','patient-A']);assert.equal(f.posts.length,0);f.setHold(false);f.release()
  await p.getByRole('combobox',{name:'ID shown',exact:true}).waitFor();assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[])
 })
 await check('STF-04 ID unknown outcome cannot be resubmitted before readback',async p=>{
  const f=await idFixture(p);await p.getByRole('button',{name:'ID checked',exact:true}).click();await p.getByRole('alert').waitFor()
  assert.equal(await p.getByRole('button',{name:'ID checked',exact:true}).isDisabled(),true)
  assert.equal(f.posts.length,1);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[])
  await p.getByRole('button',{name:'Reload ID status',exact:true}).click();await p.getByRole('combobox',{name:'ID shown',exact:true}).waitFor()
  assert.equal(await p.getByRole('button',{name:'ID checked',exact:true}).isDisabled(),true,'an unchanged read does not prove failure')
  f.setRecord({...idRecord('patient-A'),id_check:{type:'philid',at:'2026-11-14T10:00:00+08:00',other_details:null}})
  await p.getByRole('button',{name:'Reload ID status',exact:true}).click();await p.getByText(/ID checked: PhilID/).waitFor();assert.equal(f.posts.length,1);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[])
 })
 await check('STF-04 malformed verification timestamp cannot manufacture success',async p=>{
  const f=await idFixture(p,{outcome:'bad-receipt'});await p.getByRole('button',{name:'ID checked',exact:true}).click()
  await p.waitForFunction(()=>window.qa06.feedback.length||document.querySelector('.ci-idcheck [role=alert]'))
  assert.equal(f.posts.length,1);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[]);assert.equal(await p.getByRole('button',{name:'ID checked',exact:true}).isDisabled(),true)
 })
 await check('GEN-13 ID reload restores focus to surviving identity control',async p=>{
  const f=await idFixture(p,{failed:true}),b=p.getByRole('button',{name:'Reload ID status',exact:true});await b.waitFor();f.setFail(false)
  await b.press('Enter');await p.getByRole('combobox',{name:'ID shown',exact:true}).waitFor()
  assert.equal(await p.getByRole('combobox',{name:'ID shown',exact:true}).evaluate(e=>e===document.activeElement),true)
 })
 await check('STF-04 lost ID permission during CSRF prevents mutation dispatch',async p=>{
  const f=await idFixture(p,{outcome:'success'});let release
  await p.route('**/sanctum/**',r=>new Promise(resolve=>{release=async()=>{await r.fulfill({status:204});resolve()}}))
  await p.getByRole('button',{name:'ID checked',exact:true}).click();await p.waitForTimeout(100);assert.ok(release)
  await p.evaluate(()=>window.qa06.setRole('owner'));await p.getByText('Synthetic ID access unavailable',{exact:true}).waitFor()
  await release();await p.waitForTimeout(100);assert.equal(f.posts.length,0);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[])
 })
 await check('GEN-13 HMO membership reload is icon-only and duplicate protected',async p=>{
  let fail=true,reads=0,hold=false,release;const posts=[]
  await p.route('**/api/patients/**/hmo-membership',async r=>{
   reads++;if(hold)await new Promise(resolve=>{release=resolve});return fail?r.fulfill({status:503,json:{message:'Synthetic membership read failure'}}):r.fulfill({json:{data:member('patient-A')}})
  });await p.route('**/api/visits/**',r=>{posts.push(r.request().url());return r.abort()})
  await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo');await p.locator('.hmo-membership summary').click();await p.getByRole('combobox',{name:'Visit',exact:true}).selectOption('visit-A')
  const b=p.getByRole('button',{name:'Reload membership',exact:true});await b.waitFor();assert.equal(await b.textContent(),'')
  fail=false;hold=true;await b.evaluate(e=>{e.click();e.click()});await p.waitForTimeout(100);assert.equal(reads,2);hold=false;release()
  await p.getByText(/Active:.*SYNTHETIC-patient-A/).waitFor();assert.deepEqual(posts,[])
 })
 await check('GEN-13 HMO foreign membership receipt cannot claim server-confirmed save',async p=>{
  const posts=[]
  await p.route('**/api/patients/**/hmo-membership',r=>r.fulfill({json:{data:member('patient-A')}}))
  await p.route('**/api/visits/**/hmo-membership',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{data:member('patient-B')}})})
  await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo');await p.locator('.hmo-membership summary').click();await p.getByRole('combobox',{name:'Visit',exact:true}).selectOption('visit-A')
  await p.getByRole('combobox',{name:'Provider name',exact:true}).selectOption({index:1});await p.getByRole('textbox',{name:'Member number',exact:true}).fill('SYNTHETIC-NEW')
  await p.getByRole('button',{name:'Replace membership',exact:true}).click();await p.waitForFunction(()=>window.qa06.feedback.length||window.qa06.refreshes.length)
  if(await p.evaluate(()=>window.qa06.refreshes.length))await p.evaluate(()=>window.qa06.releaseRefresh(0,{ok:true}))
  await p.waitForFunction(()=>window.qa06.feedback.length);const feedback=await p.evaluate(()=>window.qa06.feedback)
  assert.equal(posts.length,1);assert.doesNotMatch(feedback[0][0],/server confirmed|membership saved/i);assert.equal(feedback[0][1],'warning')
  assert.equal(await p.getByRole('textbox',{name:'Member number',exact:true}).inputValue(),'SYNTHETIC-NEW');assert.equal(await p.getByText(/SYNTHETIC-patient-B/).count(),0)
 })
 await check('GEN-13 HMO wrong case response cannot confirm a provider decision',async p=>{
  const posts=[];await p.route('**/api/hmo-cases/**/response',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{data:{id:'case-B',status:'Rejected',revision:2,submission_cycle:1,patient:{id:'patient-B'},visit:{id:'visit-B'},branch:{id:'b1'}}}})})
  await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo');await p.locator('.hmo-case-row').filter({hasText:'Synthetic Patient A'}).first().click();await p.getByRole('button',{name:'Record Provider Response',exact:true}).click()
  const dialog=p.getByRole('dialog',{name:'Record externally received provider response',exact:true});await dialog.getByRole('combobox',{name:'Channel',exact:true}).selectOption('Phone');await dialog.getByRole('combobox',{name:'Provider outcome received',exact:true}).selectOption('Rejected')
  await dialog.getByRole('textbox',{name:'Response details / pasted source text',exact:true}).fill('Synthetic external response');await dialog.getByRole('button',{name:'Save',exact:true}).click()
  await p.waitForFunction(()=>window.qa06.feedback.length||window.qa06.refreshes.length);if(await p.evaluate(()=>window.qa06.refreshes.length))await p.evaluate(()=>window.qa06.releaseRefresh(0,{ok:true}))
  await p.waitForFunction(()=>window.qa06.feedback.length);const feedback=await p.evaluate(()=>window.qa06.feedback);assert.equal(posts.length,1);assert.equal(feedback[0][1],'warning');assert.doesNotMatch(feedback[0][0],/provider response recorded|server confirmed/i)
 })
 await check('GEN-13 HMO role change during CSRF prevents mutation dispatch',async p=>{
  const posts=[];let release;await p.route('**/sanctum/**',r=>new Promise(resolve=>{release=async()=>{await r.fulfill({status:204});resolve()}}))
  await p.route('**/api/hmo-cases/**/response',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{data:{}}})})
  await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo');await p.locator('.hmo-case-row').filter({hasText:'Synthetic Patient A'}).first().click();await p.getByRole('button',{name:'Record Provider Response',exact:true}).click()
  const dialog=p.getByRole('dialog',{name:'Record externally received provider response',exact:true});await dialog.getByRole('combobox',{name:'Channel',exact:true}).selectOption('Phone');await dialog.getByRole('combobox',{name:'Provider outcome received',exact:true}).selectOption('Rejected');await dialog.getByRole('textbox',{name:'Response details / pasted source text',exact:true}).fill('Synthetic response')
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await p.waitForTimeout(100);assert.ok(release);await p.evaluate(()=>window.qa06.setRole('owner'));await dialog.waitFor({state:'detached'});await release();await p.waitForTimeout(100)
  assert.equal(posts.length,0);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[])
 })
 await check('GEN-13 HMO revised case during CSRF prevents stale mutation dispatch',async p=>{
  const posts=[];let release;await p.route('**/sanctum/**',r=>new Promise(resolve=>{release=async()=>{await r.fulfill({status:204});resolve()}}))
  await p.route('**/api/hmo-cases/**/response',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{data:{}}})})
  await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo');await p.locator('.hmo-case-row').filter({hasText:'Synthetic Patient A'}).first().click();await p.getByRole('button',{name:'Record Provider Response',exact:true}).click()
  const dialog=p.getByRole('dialog',{name:'Record externally received provider response',exact:true});await dialog.getByRole('combobox',{name:'Channel',exact:true}).selectOption('Phone');await dialog.getByRole('combobox',{name:'Provider outcome received',exact:true}).selectOption('Rejected');await dialog.getByRole('textbox',{name:'Response details / pasted source text',exact:true}).fill('Synthetic response')
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await p.waitForTimeout(100);assert.ok(release);await p.evaluate(()=>window.qa06.setRevision(2));await dialog.getByText(/case changed/i).waitFor();await release();await p.waitForTimeout(100)
  assert.equal(posts.length,0);const feedback=await p.evaluate(()=>window.qa06.feedback);assert.equal(feedback[0][1],'warning');assert.match(feedback[0][0],/review and confirm/);assert.equal(await dialog.getByRole('button',{name:'Save',exact:true}).isDisabled(),true)
 })
 await check('GEN-13 HMO read recovery retains context pending retry and keyboard focus',async p=>{
  const posts=[];await p.route('**/api/hmo-cases/**/response',r=>{const body=r.request().postDataJSON();posts.push(body);return r.fulfill({json:{data:{id:'case-A',status:'Rejected',revision:2,submission_cycle:1,patient:{id:'patient-A'},visit:{id:'visit-A'},branch:{id:'b1'},events:[{kind:'response',submission_cycle:1,outcome:body.outcome,method:body.method,note:body.note}]}}})})
  await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo');await p.locator('.hmo-case-row').filter({hasText:'Synthetic Patient A'}).first().click();await p.getByRole('button',{name:'Record Provider Response',exact:true}).click()
  const dialog=p.getByRole('dialog');await dialog.getByRole('combobox',{name:'Channel',exact:true}).selectOption('Phone');await dialog.getByRole('combobox',{name:'Provider outcome received',exact:true}).selectOption('Rejected');await dialog.getByRole('textbox',{name:'Response details / pasted source text',exact:true}).fill('Synthetic external response');await dialog.getByRole('button',{name:'Save',exact:true}).click()
  await p.waitForFunction(()=>window.qa06.refreshes.length===1);await p.evaluate(()=>window.qa06.releaseRefresh(0,{ok:false}));await dialog.waitFor({state:'detached'})
  const b=p.getByRole('button',{name:'Reload HMO view',exact:true});await b.waitFor();assert.equal(await b.textContent(),'');await b.press('Enter');await p.waitForFunction(()=>window.qa06.refreshes.length===2);await b.evaluate(e=>{e.click();e.click()});assert.equal(await b.isDisabled(),true);assert.equal(await b.getAttribute('aria-busy'),'true');assert.ok(await b.locator('svg').count());assert.equal(await p.evaluate(()=>window.qa06.refreshes.length),2)
  await p.evaluate(()=>window.qa06.rejectRefresh(1));await b.waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('[aria-label="Reload HMO view"]').disabled);await b.press('Space');await p.waitForFunction(()=>window.qa06.refreshes.length===3);await p.evaluate(()=>window.qa06.releaseRefresh(2,{ok:true}));await b.waitFor({state:'detached'})
  assert.equal(posts.length,1);assert.equal(await p.locator('.hmo-case-detail h2').filter({hasText:'Synthetic Patient A'}).count(),1);assert.match(await p.evaluate(()=>document.activeElement.textContent),/Latest HMO view reloaded/)
 })
 await check('STF-04 omitted verification field is unavailable rather than unchecked',async p=>{
  const f=await idFixture(p,{failed:true}),partial=idRecord('patient-A');delete partial.id_check;const reload=p.getByRole('button',{name:'Reload ID status',exact:true});await reload.waitFor();f.setRecord(partial);f.setFail(false);await reload.click();await p.waitForTimeout(150)
  assert.equal(await p.getByRole('button',{name:'ID checked',exact:true}).count(),0);await p.getByRole('alert').waitFor();assert.deepEqual(f.posts,[])
 })
 await check('STF-04 valid Other ID trims payload rejects blanks and prevents duplicates',async p=>{
  const f=await idFixture(p,{outcome:'success'});await p.getByRole('combobox',{name:'ID shown',exact:true}).selectOption('other');const input=p.getByRole('textbox',{name:/^Specify ID type/}),save=p.getByRole('button',{name:'ID checked',exact:true});await input.fill('   ');assert.equal(await save.isDisabled(),true);assert.deepEqual(f.posts,[])
  await input.fill('  Synthetic employee ID  ');await save.focus();await save.press('Space');await p.getByText(/ID checked: Other valid ID/).waitFor();assert.deepEqual(f.posts.map(x=>x.body),[{id_type:'other',other_details:'Synthetic employee ID'}]);assert.equal(await p.getByRole('button',{name:'ID checked',exact:true}).count(),0);assert.match((await p.evaluate(()=>window.qa06.feedback))[0][0],/ID/)
 })
 for(const [name,record]of [['foreign Patient',idRecord('patient-B')],['partial access',{id:'patient-A',profile_access:'identity'}],['malformed existing check',{...idRecord('patient-A'),id_check:{type:'philid',at:123}}]])await check('STF-04 '+name+' never becomes writable or verified',async p=>{
  const f=await idFixture(p,{failed:true}),b=p.getByRole('button',{name:'Reload ID status',exact:true});await b.waitFor();f.setRecord(record);f.setFail(false);await b.click();await p.waitForTimeout(120);assert.equal(await p.getByRole('button',{name:'ID checked',exact:true}).count(),0);assert.equal(await p.getByText(/ID checked:/).count(),0);assert.deepEqual(f.posts,[])
 })
 await check('GEN-13 ID A B A reordered reads cannot adopt obsolete identity',async p=>{
  const requests=[];await p.route('**/api/patients/**',r=>new Promise(resolve=>requests.push({id:new URL(r.request().url()).pathname.split('/')[3],release:async data=>{await r.fulfill({json:{data}});resolve()}})))
  await p.goto(base+'/tests/fixtures/qa-batch06.html');await p.waitForFunction(()=>document.querySelector('[role=status]'));await p.waitForTimeout(50);await p.evaluate(()=>window.qa06.setPatient('patient-B'));await p.waitForTimeout(50);await p.evaluate(()=>window.qa06.setPatient('patient-A'));await p.waitForTimeout(50);assert.deepEqual(requests.map(r=>r.id),['patient-A','patient-B','patient-A'])
  await requests[2].release(idRecord('patient-A'));await p.getByRole('combobox',{name:'ID shown',exact:true}).waitFor();await requests[0].release({...idRecord('patient-A'),id_check:{type:'other',other_details:'OBSOLETE-A',at:'2026-11-14T10:00:00+08:00'}});await requests[1].release({...idRecord('patient-B'),id_check:{type:'other',other_details:'FOREIGN-B',at:'2026-11-14T10:00:00+08:00'}});await p.waitForTimeout(100);assert.equal(await p.getByText(/OBSOLETE-A|FOREIGN-B/).count(),0);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[])
 })
 await check('GEN-13 ID reload does not steal focus from another control',async p=>{
  const f=await idFixture(p,{failed:true}),b=p.getByRole('button',{name:'Reload ID status',exact:true});await b.waitFor();f.setFail(false);f.setHold(true);await b.press('Enter');await p.getByText('Loading patient ID status…',{exact:true}).waitFor();await p.evaluate(()=>{const b=document.createElement('button');b.id='synthetic-next';b.textContent='Synthetic next control';document.body.append(b);b.focus()});f.setHold(false);f.release();await p.getByRole('combobox',{name:'ID shown',exact:true}).waitFor();assert.equal(await p.evaluate(()=>document.activeElement.id),'synthetic-next')
 })
 for(const mode of ['id','hmo'])await check('GEN-13 '+mode+' changed auth generation before rerender prevents dispatch',async p=>{
  const posts=[];let release;await p.route('**/sanctum/**',r=>new Promise(resolve=>{release=async()=>{await r.fulfill({status:204});resolve()}}));await p.route('**/api/**',r=>{if(r.request().method()==='GET')return r.fulfill({json:{data:idRecord('patient-A')}});posts.push(r.request().postDataJSON());return r.fulfill({json:{data:{}}})});await p.goto(base+'/tests/fixtures/qa-batch06.html?mode='+mode)
  if(mode==='id')await p.getByRole('button',{name:'ID checked',exact:true}).click();else{await p.locator('.hmo-case-row').filter({hasText:'Synthetic Patient A'}).first().click();await p.getByRole('button',{name:'Record Provider Response',exact:true}).click();const d=p.getByRole('dialog');await d.getByRole('combobox',{name:'Channel',exact:true}).selectOption('Phone');await d.getByRole('combobox',{name:'Provider outcome received',exact:true}).selectOption('Rejected');await d.getByRole('textbox',{name:'Response details / pasted source text',exact:true}).fill('Synthetic note');await d.getByRole('button',{name:'Save',exact:true}).click()}
  await p.waitForTimeout(100);assert.ok(release);await p.evaluate(()=>{window.qa06.auth=2});await release();await p.waitForTimeout(100);assert.deepEqual(posts,[]);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[])
 })
 await check('GEN-13 HMO membership branch change cancels pending dispatch',async p=>{
  const posts=[];let release;await p.route('**/api/patients/**/hmo-membership',r=>r.fulfill({json:{data:member('patient-A')}}));await p.route('**/sanctum/**',r=>new Promise(resolve=>{release=async()=>{await r.fulfill({status:204});resolve()}}));await p.route('**/api/visits/**/hmo-membership',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{data:{}}})});await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo');await p.evaluate(()=>window.qa06.setScopes(['b1','b2']));await p.locator('.hmo-membership summary').click();await p.getByRole('combobox',{name:'Visit',exact:true}).selectOption('visit-A');await p.getByRole('combobox',{name:'Provider name',exact:true}).selectOption({index:1});await p.getByRole('textbox',{name:'Member number',exact:true}).fill('SYNTHETIC-NEW');await p.getByRole('button',{name:'Replace membership',exact:true}).click();await p.waitForTimeout(100);assert.ok(release);await p.evaluate(()=>window.qa06.setVisitBranch('b2'));await p.waitForTimeout(100);await release();await p.waitForTimeout(100);assert.deepEqual(posts,[]);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[])
 })
 for(const width of [375,430,768,1024,1440])for(const mode of ['id','hmo'])await check('GEN-12 GEN-08 '+mode+' recovery keyboard target at '+width,async p=>{
  await p.setViewportSize({width,height:1000});if(mode==='id')await idFixture(p,{failed:true});else{await p.route('**/api/patients/**/hmo-membership',r=>r.fulfill({status:503,json:{message:'Synthetic unavailable'}}));await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo');await p.locator('.hmo-membership summary').click();await p.getByRole('combobox',{name:'Visit',exact:true}).selectOption('visit-A')}
  const b=p.getByRole('button',{name:mode==='id'?'Reload ID status':'Reload membership',exact:true});await b.waitFor();const box=await b.boundingBox();assert.ok(box.width>=44&&box.height>=44);assert.equal(await b.getAttribute('type'),'button');assert.equal(await b.textContent(),'');await p.keyboard.press('Tab');await b.focus();assert.equal(await b.evaluate(e=>e.matches(':focus-visible')),true);const style=await b.evaluate(e=>{const s=getComputedStyle(e);return{outline:s.outlineStyle,width:s.outlineWidth,shadow:s.boxShadow}});assert.ok(style.outline!=='none'&&parseFloat(style.width)>0||style.shadow!=='none');assert.equal(await b.getAttribute('aria-label'),mode==='id'?'Reload ID status':'Reload membership');assert.equal(await p.getByRole('alert').count()>0,true)
 })
 await check('GEN-13 Follow-ups recovery icon duplicate guard keyboard and read-only result',async p=>{
  let fail=true,hold=false,release;const calls=[];await p.route('**/api/followups*',async r=>{calls.push({method:r.request().method(),path:new URL(r.request().url()).pathname});if(hold)await new Promise(resolve=>{release=resolve});return fail?r.fulfill({status:503,json:{message:'Synthetic read failure'}}):r.fulfill({json:{data:[],meta:{counts:{open:0,overdue:0,due_today:0}}}})})
  await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=followups');const b=p.getByRole('button',{name:'Reload follow-ups',exact:true});await b.waitFor();assert.equal(await b.textContent(),'');assert.equal(await b.locator('svg').count(),1);fail=false;hold=true;await b.press('Enter');await p.getByText('Loading follow-ups…',{exact:true}).waitFor();await p.waitForTimeout(60);assert.equal(calls.length,2);hold=false;release();await p.getByText('No follow-ups here.',{exact:true}).waitFor();assert.equal(calls.every(c=>c.method==='GET'),true);assert.deepEqual(await p.evaluate(()=>window.qa06.feedback),[]);assert.notEqual(await p.evaluate(()=>document.activeElement.tagName),'BODY')
 })
 for(const action of ['open','selfPay'])await check('GEN-13 HMO '+action+' changed public Patient cancels dispatch',async p=>{
  const posts=[];let release;await p.route('**/sanctum/**',r=>new Promise(resolve=>{release=async()=>{await r.fulfill({status:204});resolve()}}));await p.route('**/api/visits/**',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{data:{}}})});await p.goto(base+'/tests/fixtures/qa-batch06.html?mode=hmo&decisions=1')
  if(action==='open')await p.getByRole('button',{name:'Open HMO case',exact:true}).click();else{await p.getByRole('button',{name:'Proceed self-pay',exact:true}).click();await p.getByRole('dialog').getByRole('textbox',{name:/Reason/}).fill('Synthetic reason');await p.getByRole('button',{name:'Record self-pay decision',exact:true}).click()}
  await p.waitForTimeout(100);assert.ok(release);await p.evaluate(()=>window.qa06.setDecisionPatient('patient-B'));await p.waitForTimeout(100);await release();await p.waitForTimeout(100);assert.deepEqual(posts,[]);assert.ok((await p.evaluate(()=>window.qa06.feedback)).every(x=>x[1]!=='success'))
 })
 console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,results},null,2));if(results.some(r=>!r.ok))process.exitCode=1
}finally{await browser.close()}
