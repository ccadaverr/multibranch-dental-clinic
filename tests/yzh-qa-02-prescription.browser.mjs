import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
import {mkdir,writeFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true})
const page=await browser.newPage();page.setDefaultTimeout(8000)
const errors=[],mutations=[]
let releaseFirst,firstRead,issued=false,revision=1
const url=process.env.QA_URL||'http://127.0.0.1:5187/tests/fixtures/yzh-qa-02.html'
const firstRequested=new Promise(resolve=>{firstRead=resolve})
const row=(id)=>({id,visit:'v'+id,patient:{id:'p'+id,name:'Synthetic patient '+id},status:'Draft',can_edit:true,revision,number:issued?'RX-SYNTHETIC-000002':null,lines:[{medicine:id==='1'?'Amoxicillin':'Paracetamol',dosage:'500mg',frequency:'',duration:'',instructions:''}],note:'',branch:'Synthetic branch',dentist:'Synthetic dentist'})
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort())
await page.route('**/sanctum/**',r=>r.fulfill({status:204}))
await page.route('**/api/**',async r=>{
 const req=r.request(),p=new URL(req.url()).pathname
 if(req.method()!=='GET'){mutations.push({p,body:req.postDataJSON()});revision++;if(p.endsWith('/issue'))issued=true;return r.fulfill({json:{data:{...row('2'),status:issued?'Issued':'Draft',can_edit:!issued}}})}
 let data=[]
 if(p==='/api/prescriptions')data=[row('1'),row('2')]
 if(p==='/api/prescriptions/visits')data=['1','2'].map(id=>({id:'v'+id,date:'2026-11-01',patient:row(id).patient,branch:'Synthetic branch'}))
 if(p==='/api/prescriptions/1'){firstRead();await new Promise(resolve=>{releaseFirst=resolve});data=row('1')}
 if(p==='/api/prescriptions/2')data={...row('2'),status:issued?'Issued':'Draft',can_edit:!issued}
 return r.fulfill({json:{data,meta:{license_no:'',allergy_notice:'Ask the patient'}}})
})
try{
 await page.goto(url);await page.evaluate(()=>window.qa02.setMode('rx'))
 await page.getByRole('button',{name:'Edit draft',exact:true}).first().click();await firstRequested
 await page.evaluate(()=>{window.rxActions=[];document.addEventListener('click',e=>{const b=e.target.closest('button');if(b)window.rxActions.push(b.textContent)});document.addEventListener('keydown',e=>{if(e.key==='Escape')window.rxActions.push('Escape')})})
 await page.getByRole('button',{name:'Edit draft',exact:true}).nth(1).click()
 await page.getByText('Edit draft for Synthetic patient 2',{exact:true}).waitFor()
 releaseFirst();await page.waitForTimeout(200)
 assert.equal(await page.getByText('Edit draft for Synthetic patient 1',{exact:true}).count(),0,'late first-patient response must not replace the selected second draft')
 assert.equal(await page.getByLabel('Select medicine 1',{exact:true}).inputValue(),'Paracetamol')
 assert.deepEqual(mutations,[]);assert.deepEqual(errors,[])
 await page.getByRole('button',{name:'Save draft',exact:true}).click()
 await page.getByRole('dialog').waitFor();assert.equal(mutations.length,1);assert.equal(mutations[0].p,'/api/prescriptions/2');assert.equal(mutations[0].body.lines[0].medicine,'Paracetamol');assert.equal(issued,false,'Save does not issue')
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Edit draft',exact:true}).nth(1).click();await page.getByText('Edit draft for Synthetic patient 2',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Issue prescription',exact:true}).click();assert.equal(issued,false,'opening confirmation does not issue')
 await page.getByRole('dialog',{name:'Issue and lock prescription?'}).getByRole('button',{name:'Issue prescription',exact:true}).click();await page.getByRole('dialog').getByText('Issued',{exact:true}).waitFor();assert(issued);assert.equal(mutations.filter(m=>m.p.endsWith('/issue')).length,1)
 const actions=await page.evaluate(()=>window.rxActions)
 assert.deepEqual(actions,['Edit draft','Save draft','Escape','Edit draft','Issue prescription','Issue prescription'])
 assert.equal(mutations.at(-1).body.expected_revision,3,'Issue uses the revision returned by its preceding save')
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Edit draft',exact:true}).nth(1).click();await page.getByText('This prescription is no longer an editable draft.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Select medicine 1',{exact:true}).count(),0,'a stale edit control cannot reopen an issued prescription')
 const evidence=process.env.QA_EVIDENCE_DIR||'docs/ui-review/yzh-qa-02'
 // The added fixture lifetime is not an activation bypass: unknown auth still refuses Issue.
 issued=false;revision=1;await page.goto(url);await page.evaluate(()=>window.qa02.setMode('rx'))
 await page.getByRole('button',{name:'Edit draft',exact:true}).nth(1).click();await page.getByText('Edit draft for Synthetic patient 2',{exact:true}).waitFor()
 await page.evaluate(()=>window.qa02.invalidateClinicalAuth());const before=mutations.length
 await page.getByRole('button',{name:'Issue prescription',exact:true}).click()
 await page.getByRole('dialog',{name:'Issue and lock prescription?'}).getByRole('button',{name:'Issue prescription',exact:true}).click()
 await page.getByText(/Your authentication could not be confirmed/).waitFor();assert.equal(mutations.length,before)
 assert.deepEqual(errors,[])
 await mkdir(evidence,{recursive:true});await writeFile(`${evidence}/prescription-results.json`,JSON.stringify({staleDraftResponse:'pass',actions,activationCount:actions.length,comparison:'Current list-to-draft review/save/reopen/issue segment; same six actions as the historical documented segment, no click reduction claimed.',revokedAuthRefusesIssue:true,mutations,errors,synthetic:true},null,2))
 console.log('PASS prescription identity, Save stays Draft, exact Issue revision, revoked-auth refusal; measured six actions, three intercepted mutations')
}finally{releaseFirst?.();await browser.close()}
