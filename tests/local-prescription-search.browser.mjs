// NEW verified synthetic target only. Real API writes/readback; faults affect reads, never fake success.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {browser,login,get,api,evidence,target,base} from './local-visit-support.mjs'
const visit=JSON.parse(readFileSync(process.env.LOCAL_VISIT_JOURNAL||target.runtime+'/browser/journey.json','utf8')).visit
assert.ok(visit?.id)
const journal=evidence+'/search-acceptance.json',state=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):{}
state.widths=[];state.accepted=false
const save=()=>writeFileSync(journal,JSON.stringify(state,null,2))
save()
const rxPath=r=>new URL(r.url()).pathname==='/api/prescriptions'&&r.request().method()==='GET'
const list=page=>page.locator('.dentist-prescriptions ul.fd-list')
const search=page=>page.getByRole('searchbox',{name:'Search by number, patient, dentist, or branch…',exact:true})
const loaded=async page=>{await page.getByRole('button',{name:'Reload prescriptions',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Reload prescriptions"]')?.getAttribute('aria-busy')==='false')}
try {
  const dentist=await login('sprint02.dentist@example.test'),page=dentist.page
  await page.getByRole('button',{name:'Prescriptions',exact:true}).first().click()
  if(!state.issued){
  const compose=page.locator('details.rx-compose').first()
  if(!await compose.evaluate(el=>el.open))await compose.locator(':scope > summary').click()
  await page.getByRole('combobox',{name:/^Visit/}).selectOption(visit.id)
  await page.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('__other__')
  await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).fill('Synthetic search acceptance medicine; not for clinical use')
  const issued=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/issue')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Issue prescription',exact:true}).click()
  await page.getByRole('dialog',{name:'Issue and lock prescription?',exact:true}).getByRole('button',{name:'Issue prescription',exact:true}).click()
  const issueResponse=await issued;assert.equal(issueResponse.status(),200);state.issued=(await issueResponse.json()).data;save()
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  }
  // Populate pages through the authenticated clinical API with the current session context.
  const made=state.drafts||await page.evaluate(async visitId=>{
    const api=await import('/src/api-client.js'),me=await api.me(),ids=[]
    for(let i=0;i<22;i++){
      const r=await api.createPrescription({visit_id:visitId,lines:[{medicine:`Synthetic persisted page record ${i}`}],note:'Synthetic search acceptance only'},crypto.randomUUID(),undefined,me.data.clinical_context)
      if(!r.ok)throw Error(JSON.stringify({kind:r.kind,message:r.message,index:i}))
      ids.push(r.data.id)
    }
    return ids
  },visit.id)
  assert.equal(new Set(made).size,22);state.drafts=made;save()
  await page.getByRole('button',{name:'Reload prescriptions',exact:true}).click();await loaded(page)
  assert.equal(await list(page).locator(':scope > li').count(),20)
  await page.getByRole('button',{name:'Older prescriptions',exact:true}).click();await loaded(page)
  await list(page).getByText(state.issued.number,{exact:false}).waitFor()
  await page.getByRole('button',{name:'Newer prescriptions',exact:true}).click();await loaded(page)
  console.log('PASS real prescription create/issue and complete persisted page navigation')

  await search(page).fill(state.issued.number.toLowerCase());await loaded(page)
  await list(page).getByText(state.issued.number,{exact:false}).waitFor()
  assert.equal(await list(page).locator(':scope > li').count(),1)
  await page.reload();await page.getByRole('button',{name:'Prescriptions',exact:true}).first().click();await loaded(page)
  await search(page).fill(state.issued.number);await loaded(page)
  await list(page).getByRole('button',{name:'Open',exact:true}).click()
  const dialog=page.getByRole('dialog');await dialog.getByText('Synthetic search acceptance medicine; not for clinical use',{exact:true}).waitFor()
  assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true)
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Void');await loaded(page)
  await page.getByText('No prescriptions found.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();await loaded(page)
  assert.equal(await search(page).inputValue(),'');assert.equal(await page.getByRole('combobox',{name:'Status',exact:true}).inputValue(),'all')
  assert.equal(await page.getByRole('button',{name:'Clear filters',exact:true}).count(),0)
  console.log('PASS persisted search, exact detail, dialog keyboard focus and active-filter X reset')

  // A delayed old search must never overwrite the current query's verified page.
  let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r)
  await page.route(api+'/api/prescriptions?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('q')!==state.issued.number)return route.continue()
    const response=await route.fetch();started();await gate;await route.fulfill({response})
  })
  await search(page).fill(state.issued.number);await began
  await search(page).fill('synthetic-absent-search');await loaded(page)
  release();await page.unroute(api+'/api/prescriptions?*');await page.getByText('No prescriptions found.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();await loaded(page)
  let unblock,requested;const requestStarted=new Promise(r=>requested=r),hold=new Promise(r=>unblock=r)
  await page.route(api+'/api/prescriptions?*',async route=>{const response=await route.fetch();requested();await hold;await route.fulfill({response})},{times:1})
  await page.getByRole('button',{name:'Reload prescriptions',exact:true}).click();await requestStarted
  assert.equal(await page.getByRole('button',{name:'Reload prescriptions',exact:true}).getAttribute('aria-busy'),'true')
  assert.equal(await page.getByRole('button',{name:'Reload prescriptions',exact:true}).isDisabled(),true)
  unblock();await loaded(page)
  await page.route(api+'/api/prescriptions?*',r=>r.abort('failed'),{times:1})
  await page.getByRole('button',{name:'Reload prescriptions',exact:true}).click()
  await page.getByRole('button',{name:'Retry prescriptions',exact:true}).click();await loaded(page)
  assert.equal(await list(page).locator(':scope > li').count(),20)
  console.log('PASS delayed-search isolation, real loading and failed-read retry')

  for(const width of [375,390,430,768,1024,1440]){
    await page.setViewportSize({width,height:1000})
    await search(page).fill('Patient');await loaded(page)
    const geometry=await page.evaluate(()=>{
      const input=document.querySelector('.dentist-prescriptions input[type=search]'),icon=document.querySelector('.dentist-prescriptions .search-input-icon'),box=input.getBoundingClientRect(),i=icon.getBoundingClientRect()
      return {overflow:document.documentElement.scrollWidth>innerWidth+1,padding:parseFloat(getComputedStyle(input).paddingLeft),iconRight:i.right-box.left}
    })
    assert.equal(geometry.overflow,false,`page overflow at ${width}`);assert.ok(geometry.padding>=geometry.iconRight,`search overlaps icon at ${width}`)
    await page.screenshot({path:evidence+`/dentist-search-${width}.png`,fullPage:true})
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();await loaded(page)
    state.widths.push(width);save()
  }
  console.log('PASS six populated Dentist widths, aligned search icon and clear controls')
  const patient=await login('sprint02.patient@example.test',390),p=patient.page
  await p.getByRole('button',{name:'More',exact:true}).click()
  await p.getByRole('dialog',{name:'More',exact:true}).getByRole('button',{name:'Prescriptions',exact:true}).click()
  await p.getByText(state.issued.number,{exact:false}).waitFor()
  assert.equal((await get(p,'/api/me/prescriptions')).body.data.length,1)
  for(const width of [375,390,430,768,1024,1440]){
    await p.setViewportSize({width,height:1000})
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
    await p.screenshot({path:evidence+`/patient-prescriptions-${width}.png`,fullPage:true})
  }
  let releasePatient,patientStarted;const patientBegan=new Promise(r=>patientStarted=r),patientGate=new Promise(r=>releasePatient=r)
  await p.route(api+'/api/me/prescriptions',async route=>{const response=await route.fetch();patientStarted();await patientGate;await route.fulfill({response})},{times:1})
  await p.getByRole('button',{name:'Reload my prescriptions',exact:true}).click();await patientBegan
  assert.equal(await p.getByRole('button',{name:'Reload my prescriptions',exact:true}).getAttribute('aria-busy'),'true')
  releasePatient();await p.getByText(state.issued.number,{exact:false}).waitFor()
  await p.route(api+'/api/me/prescriptions',r=>r.abort('failed'),{times:1})
  await p.getByRole('button',{name:'Reload my prescriptions',exact:true}).click()
  await p.getByRole('button',{name:'Try again',exact:true}).click();await p.getByText(state.issued.number,{exact:false}).waitFor()
  const download=p.waitForEvent('download');await p.getByRole('button',{name:/^Download PDF for /}).click()
  const document=await download;await document.saveAs(evidence+'/patient-issued.pdf');assert.equal(readFileSync(evidence+'/patient-issued.pdf').subarray(0,5).toString(),'%PDF-')
  await p.reload();await p.getByText(state.issued.number,{exact:false}).waitFor()
  console.log('PASS own Patient exact readback, six widths, loading, failure recovery and real PDF/reload')
  // Corrupt one read response only: never accept a foreign clinical identity as own history.
  await p.route(api+'/api/me/prescriptions',async route=>{const response=await route.fetch(),body=await response.json();body.data[0].patient.id='synthetic-foreign-patient';await route.fulfill({response,json:body})},{times:1})
  await p.getByRole('button',{name:'Reload my prescriptions',exact:true}).click()
  await p.getByText('The returned prescriptions did not confirm your Patient and visit identities. No records were adopted.',{exact:true}).waitFor()
  assert.equal(await p.locator('ul.pp-rx-list').count(),0)
  await p.getByRole('button',{name:'Try again',exact:true}).click();await p.getByText(state.issued.number,{exact:false}).waitFor()
  // A PDF already fetched from the server must not download after leaving its owning view.
  let releasePdf,pdfStarted;const pdfBegan=new Promise(r=>pdfStarted=r),pdfGate=new Promise(r=>releasePdf=r),downloads=[]
  p.on('download',file=>downloads.push(file))
  await p.route(api+'/api/prescriptions/'+state.issued.id+'/pdf',async route=>{const response=await route.fetch();pdfStarted();await pdfGate;await route.fulfill({response})},{times:1})
  await p.getByRole('button',{name:/^Download PDF for /}).evaluate(b=>{b.click();b.click()});await pdfBegan
  let releaseChart,chartStarted;const chartBegan=new Promise(r=>chartStarted=r),chartGate=new Promise(r=>releaseChart=r)
  // Hold both initial StrictMode reads, including the abandoned effect's request.
  await p.route(api+'/api/me/chart',async route=>{const response=await route.fetch();chartStarted();await chartGate;await route.fulfill({response})})
  await p.getByRole('button',{name:'My teeth',exact:true}).click();await chartBegan
  assert.equal(await p.getByRole('button',{name:'Reload my chart',exact:true}).getAttribute('aria-busy'),'true')
  releaseChart();releasePdf();await p.getByText('Nothing recorded yet',{exact:true}).waitFor()
  await p.unroute(api+'/api/me/chart')
  await p.waitForTimeout(800);assert.equal(downloads.length,0)
  await p.route(api+'/api/me/chart',r=>r.abort('failed'),{times:1})
  await p.getByRole('button',{name:'Reload my chart',exact:true}).click();await p.getByRole('button',{name:'Try again',exact:true}).click()
  await p.getByText('Nothing recorded yet',{exact:true}).waitFor()
  state.accepted=true;save();console.log('PASS foreign-response refusal, abandoned PDF suppression and real chart loading/retry')
} finally {await browser.close()}
