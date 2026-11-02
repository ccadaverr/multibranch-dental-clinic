import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({hasTouch:true})
const page=await context.newPage()
page.setDefaultTimeout(8000)
const evidence=process.env.QA_EVIDENCE_DIR||'docs/ui-review/yzh-qa-02', requests=[],posts=[],results=[],errors=[]
await mkdir(evidence,{recursive:true})
page.on('pageerror',e=>errors.push(e.message))
let quoteMode='cash', bookingMode='pending', hold=false,release, calendarBranch='b1'
await page.route('**/sanctum/**',r=>r.fulfill({status:204}))
await page.route('**/api/**',async r=>{
 const req=r.request(),u=new URL(req.url()),p=u.pathname,params=Object.fromEntries(u.searchParams)
 requests.push({path:p,params,method:req.method()})
 const ok=data=>r.fulfill({json:{data}})
 if(p==='/api/services')return ok([{id:'consult',name:'Synthetic consultation',status:'Active',category:'General',online_booking:'bookable'}])
 if(p.endsWith('/dependents'))return ok([{id:'child',first_name:'Synthetic child',name:'Synthetic child',relationship:'Child'}])
 if(p.endsWith('/branch-options'))return ok({branches:[{id:'b1',name:'Synthetic Central',city:'Synthetic city',address:'Fixture address'}]})
 if(p.endsWith('/calendar')){
  calendarBranch=params.branch_ref
  return ok({month:'2099-11',today:'2099-11-01',days:[{date:'2099-11-02',status:params.branch_ref==='b2'?'closed':'available',reason:params.branch_ref==='b2'?'Synthetic closure':null}]})
 }
 if(p.endsWith('/availability'))return ok({slots:[{start_time:'09:00'}]})
 if(p.endsWith('/booking-options')){
  if(quoteMode==='error')return r.fulfill({status:403,json:{message:'Synthetic dependent authorization revoked'}})
  return ok({...params,currency:'PHP',booking_fee_php:'500.00',pay_at_clinic_available:true,online_payment_available:quoteMode==='online',payment_methods:quoteMode==='online'?['gcash']:[],reserves_slot:false})
 }
 if(p==='/api/public/faq')return ok([])
 if(req.method()==='POST'&&p==='/api/appointments'){
  const body=req.postDataJSON();posts.push({body,key:req.headers()['idempotency-key']})
  if(hold)await new Promise(resolve=>{release=resolve})
  if(bookingMode==='conflict')return r.fulfill({status:409,json:{code:'schedule_conflict',message:'Synthetic slot taken'}})
  return ok({id:'synthetic-booking',date:body.date,start_time:body.start_time,status:'Pending',booking_payment_status:body.pay_at_clinic?'unpaid':'held'})
 }
 throw Error('Unexpected request '+req.method()+' '+p)
})
const go=()=>page.goto('http://127.0.0.1:5187/tests/fixtures/yzh-qa-02.html')
const overflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'document overflow')
const review=async()=>{
 await page.getByRole('button',{name:/Synthetic Central/}).click()
 await page.getByRole('gridcell',{name:/Nov 2, 2099/}).click()
 await page.getByRole('button',{name:'9:00 AM',exact:true}).click()
 await page.getByText('Booking fee:',{exact:false}).waitFor()
}
try{
 for(const width of [390,768,1024,1440]){
  await page.setViewportSize({width,height:1000});quoteMode='cash';bookingMode='pending';await go()
  await page.getByLabel('Booking for').selectOption('child');await review()
  for(const path of ['branch-options','calendar','availability','booking-options'])assert(requests.some(r=>r.path.endsWith('/'+path)&&r.params.for_patient_id==='child'),path+' dependent identity')
  assert.equal(await page.getByRole('radio',{name:'Pay online',exact:true}).count(),0)
  await page.getByRole('radio',{name:'Pay at the clinic',exact:true}).check()
  await overflow();await page.screenshot({path:`${evidence}/booking-${width}.png`,fullPage:true})
  const before=posts.length;hold=true
  await page.getByRole('button',{name:/Submit booking/}).dblclick()
  await page.waitForFunction(()=>document.body.innerText.includes('Checking your booking'))
  assert.equal(posts.length,before+1);assert.equal(posts.at(-1).body.for_patient_id,'child');assert.equal(posts.at(-1).body.pay_at_clinic,true)
  hold=false;release();await page.getByRole('heading',{name:'Pending front-desk confirmation'}).waitFor()
  // Same shared native controls used across role surfaces; this is component acceptance, not authenticated role acceptance.
  for(const role of ['Patient','Staff','Dentist','Owner']){
   await page.evaluate(role=>{window.qa02.setMode('controls');window.qa02.setRole(role)},role)
   const select=page.getByRole('combobox',{name:/^ID type/});await select.selectOption('Other')
   await page.getByRole('textbox',{name:/^Specify ID type/}).fill('Synthetic company card')
   await select.selectOption('Standard');assert.equal(await page.getByRole('textbox',{name:/^Specify ID type/}).count(),0)
   await select.selectOption('Other');assert.equal(await page.getByRole('textbox',{name:/^Specify ID type/}).inputValue(),'')
   await select.focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
   const opener=page.getByRole('button',{name:'Open form'});await opener.click()
   const dialog=page.getByRole('dialog',{name:'Synthetic form'});await dialog.getByRole('combobox',{name:/^Branch/}).selectOption('b2')
   for(let i=0;i<8;i++){await page.keyboard.press('Tab');if(await page.evaluate(()=>document.activeElement===document.body))await page.keyboard.press('Tab');assert(await dialog.evaluate(d=>d.contains(document.activeElement)))}
   await page.keyboard.press('Escape');assert(await opener.evaluate(e=>e===document.activeElement))
   await overflow()
  }
  await page.screenshot({path:`${evidence}/controls-${width}.png`,fullPage:true})
  results.push({width,dependentBooking:'pass',duplicateSubmit:'pass',sharedControlsFourRoles:'pass',modalFocus:'pass',overflow:'pass'})
 }
 quoteMode='online';await go();await review();await page.getByRole('radio',{name:'Pay online',exact:true}).check();await page.getByRole('button',{name:/Submit booking/}).click();await page.getByRole('heading',{name:'Pending payment verification'}).waitFor();assert.equal(posts.at(-1).body.pay_at_clinic,false)
 quoteMode='error';await go();await page.getByRole('button',{name:/Synthetic Central/}).click();await page.getByRole('gridcell',{name:/Nov 2, 2099/}).click();await page.getByRole('button',{name:'9:00 AM',exact:true}).click();await page.getByText('Synthetic dependent authorization revoked',{exact:true}).waitFor();assert(await page.getByRole('button',{name:/Submit booking/}).isDisabled())
 quoteMode='cash';await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('Booking fee:',{exact:false}).waitFor();await page.getByRole('radio',{name:'Pay at the clinic',exact:true}).check();bookingMode='conflict';await page.getByRole('button',{name:/Submit booking/}).click();await page.getByText('That time was just taken. Choose another time.',{exact:true}).waitFor()
 await page.getByLabel('Booking for').selectOption('child');await page.getByRole('heading',{name:'Choose a branch'}).waitFor();assert.equal(await page.getByRole('button',{name:/Submit booking/}).count(),0)
 await page.evaluate(()=>{window.qa02.setMode('calendar');window.qa02.setBranch('b1')});await page.getByRole('gridcell',{name:/available/}).waitFor();const count=requests.filter(r=>r.path.endsWith('/calendar')).length
 await page.evaluate(()=>window.qa02.setBranch('b2'));await page.getByRole('gridcell',{name:/Synthetic closure/}).waitFor();assert.equal(calendarBranch,'b2');assert(requests.filter(r=>r.path.endsWith('/calendar')).length>count)
 await page.emulateMedia({reducedMotion:'reduce'});await overflow();assert.deepEqual(errors,[])
 await writeFile(`${evidence}/browser-results.json`,JSON.stringify({results,additional:['online explicit intent','revoked authorization and retry','stale slot refusal','patient change clears slot','calendar context refresh','reduced motion'],requests:requests.length,syntheticMutations:posts.length,pageErrors:errors,authenticatedAcceptance:false},null,2))
 console.log(JSON.stringify({results,requests:requests.length,syntheticMutations:posts.length,errors}))
}finally{await browser.close()}
