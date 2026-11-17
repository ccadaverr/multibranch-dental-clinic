// M14 documents, consent and GEN-07 leave field browser QA. HTTP fixtures only: backend authorization, content validation, storage and audit are
// covered by the Laravel tests. No operational record is created or changed; artifacts go outside the repository.
// Usage: PLAYWRIGHT_MODULE=<path to an installed playwright> QA_BASE_URL=http://127.0.0.1:5187 node scripts/m14-documents-browser-qa.mjs
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import * as data from '../src/data.js'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({channel:'chrome'})
const base=process.env.QA_BASE_URL||'http://127.0.0.1:5187'
const output=process.env.QA_OUTPUT||'/tmp/m14-browser'
await mkdir(output,{recursive:true})
let checks=0
const results=[],errors=[]
const check=(value,message)=>{assert.ok(value,message);checks++}

const branches=data.INITIAL_BRANCHES.map((b,i)=>({id:b.id,public_id:`01K0000000000000000000000${i+1}`,branch_code:b.branchCode,name:b.name,city:b.city,address:b.address,phone:b.phone,open_time:b.open,close_time:b.close,status:b.status,capacity_threshold:b.threshold,latitude:null,longitude:null,data_provenance:'unconfirmed'}))
const services=data.INITIAL_SERVICES.map(s=>({id:s.id,code:s.code,name:s.name,duration_minutes:s.duration,reference_fee_php:s.baseFee,category:s.category,status:s.status}))
const dentists=data.INITIAL_DENTISTS.map(d=>({...d,id:d.id,branch_ids:d.branches.map(name=>branches.find(b=>b.name===name).id),service_ids:services.map(s=>s.id),shiftStart:d.shiftStart,shiftEnd:d.shiftEnd}))
const staff=data.INITIAL_STAFF.map(s=>({...s,title:s.staffType,branchId:branches.find(b=>b.name===s.branch)?.id||null}))
const branchServices=data.INITIAL_BRANCH_SERVICES.map(b=>({branch_ref:b.branchId,service_ref:b.serviceId,active:b.active}))

const SERVER_ID='01j0000000000000000000a001',OWN_ID='01K00000000000000000000011',DOC_PDF='01j0000000000000000000d001',DOC_PNG='01j0000000000000000000d002'
const today=new Date(Date.now()+8*3600e3).toISOString().slice(0,10)
const record={id:SERVER_ID,code:'PAT-0101',name:'Qa Server',first_name:'Qa',last_name:'Server',date_of_birth:'1991-02-03',sex:'Female',phone:'+639171234567',emergency_contact:'',revision:1,email:'qa@example.test',address:'',preferred_branch:null,has_portal_account:false,profile_access:'full',created_at:'2026-09-01T09:00:00+08:00',updated_at:'2026-09-01T09:00:00+08:00'}
const docRow=(id,over={})=>({id,category:'hmo_card',title:'Card',original_filename:'card.pdf',mime_type:'application/pdf',file_size_bytes:2048,checksum_sha256:'a'.repeat(64),status:'Active',metadata:null,patient:{id:SERVER_ID,code:'PAT-0101',name:'Qa Server'},visit_id:null,hmo_case_id:null,branch:{id:'b1',name:'Branch A'},uploaded_by:{role:'staff'},retracted_at:null,retraction_reason:null,text_extraction:'draft_available',security_scan:'not_performed',created_at:'2026-09-28T10:00:00+08:00',extractions:[{id:'e1',method:'native_text',status:'Draft',is_draft:true,confidence_score:null,extracted_at:'2026-09-28T10:00:00+08:00'}],...over})
const docs=[docRow(DOC_PDF,{title:'Insurance card',uploaded_by:{role:'patient'}}),docRow(DOC_PNG,{title:'Scan photo',original_filename:'scan.png',mime_type:'image/png',text_extraction:'unavailable_ocr_not_configured',extractions:[]})]
const uploadedDoc=docRow('01j0000000000000000000d003',{title:'New upload',category:'other',other_description:'Synthetic school clearance'})
const detail={...docs[0],extractions:[{...docs[0].extractions[0],raw_text:'Maxicare member MAX-12345678 valid 2026-05-01',structured_payload:{provider_candidate:'Maxicare',member_number_candidate:'MAX-12345678',detected_dates:['2026-05-01'],is_draft_only:true,provenance:{source:'document_text'}}}]}
const appointmentRow={id:'01k0000000000000000000ap01',code:'APT-0101',patient:{id:SERVER_ID,code:'PAT-0101',name:'Qa Server'},branch:{id:'b1',name:'Branch A'},service:{id:'svc1',name:'Oral Prophylaxis'},dentist:{id:'d1',name:'Dr. Miguel Reyes'},date:today,start_time:'10:00',end_time:'10:30',duration_minutes:30,starts_at:`${today}T10:00:00+08:00`,ends_at:`${today}T10:30:00+08:00`,status:'Confirmed',revision:1,source:'front_desk',assignment_method:'selected',notes:null,history:null}

async function openDocuments(page,role){
 const button=page.getByRole('button',{name:'Patient Records',exact:true}).filter({visible:true})
 if(!await button.count())await page.getByRole('button',{name:'Open navigation',exact:true}).click()
 await page.getByRole('button',{name:'Patient Records',exact:true}).filter({visible:true}).first().click()
 await page.getByRole('heading',{name:'Centralized Patient Records',exact:true}).waitFor()
 if(role==='staff')await page.getByRole('searchbox',{name:'Search patients',exact:true}).fill('Qa Server')
 await page.locator('.patient-list-scroll button').filter({hasText:'Qa Server'}).first().click()
}
const documentsTab=page=>page.getByRole('button',{name:/^Documents/}).click()

async function openRolePage(page, name) {
 await page.locator('.workspace-label').waitFor()
 const target=page.getByRole('button',{name,exact:true}).filter({visible:true})
 if(!await target.count())await page.getByRole('button',{name:'Open navigation',exact:true}).click()
 await target.first().click()
}

async function checkAssistantOther(page) {
 await openRolePage(page,'Assistant Answers')
 await page.getByRole('button',{name:'Add an answer',exact:true}).click()
 const dialog=page.getByRole('dialog')
 const category=dialog.getByRole('combobox',{name:'Category',exact:true})
 const specify=dialog.getByRole('textbox',{name:'Specify category'})
 await dialog.getByRole('textbox',{name:/^Question/}).fill('Where can visitors ask for assistance?')
 await dialog.getByRole('textbox',{name:/^Answer/}).fill('Please contact the branch for assistance.')
 await dialog.getByRole('button',{name:'Save',exact:true}).click()
 await dialog.getByText('Specify the category.',{exact:true}).waitFor()
 await specify.fill('Previous draft text')
 await category.selectOption('about')
 check(await specify.count()===0,'standard answer category hides Specify')
 await category.selectOption('other')
 check(await specify.inputValue()==='','answer detail clears when switching categories')
 await specify.fill('Accessibility information')
 await dialog.getByRole('button',{name:'Save',exact:true}).click()
 await dialog.getByText('Synthetic category refusal',{exact:true}).first().waitFor()
 check(await specify.inputValue()==='Accessibility information','answer form retains detail after a validation refusal')
 await dialog.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByText('Accessibility information',{exact:true}).waitFor()
 await page.reload()
 await openRolePage(page,'Assistant Answers')
 await page.getByText('Accessibility information',{exact:true}).waitFor()
 check(true,'saved answer category detail loads after refresh')
}

async function checkPatientCancellation(page) {
 await page.getByRole('button',{name:/^(My )?visits$/i}).filter({visible:true}).first().click()
 await page.getByRole('button',{name:'Cancel',exact:true}).first().click()
 const dialog=page.getByRole('dialog')
 const category=dialog.getByRole('combobox')
 const specify=dialog.getByRole('textbox',{name:'Specify reason'})
 const submit=dialog.getByRole('button',{name:'Cancel visit'})
 await category.selectOption('Other')
 check(await submit.isDisabled(),'blank Other cancellation is blocked')
 await specify.fill('Earlier entry')
 await category.selectOption('Schedule conflict')
 check(await specify.count()===0,'standard cancellation hides Specify')
 await category.selectOption('Other')
 check(await specify.inputValue()==='','cancellation clears stale Other detail')
 await specify.fill('Schedule conflict')
 await submit.click()
 await dialog.getByText('Synthetic cancellation refusal',{exact:true}).waitFor()
 check(await specify.inputValue()==='Schedule conflict','server refusal keeps the cancellation detail')
 await submit.click()
 await page.getByRole('button',{name:'Cancelled',exact:true}).click()
 await page.getByText('Other: Schedule conflict',{exact:true}).waitFor()
 check(true,'cancelled visit shows category and independently saved detail')
}

async function checkStaffCancellation(page) {
 await openRolePage(page,'Appointments')
 await page.getByRole('button',{name:'Cancel',exact:true}).first().click()
 const dialog=page.getByRole('dialog')
 const select=dialog.getByRole('combobox',{name:'Cancellation reason'})
 const specify=dialog.getByRole('textbox',{name:'Specify Cancellation reason'})
 const confirm=dialog.getByRole('button',{name:'Cancel appointment',exact:true})
 check(await confirm.isDisabled(),'staff cancellation requires a category')
 await select.selectOption('Other')
 await specify.fill('Earlier detail')
 await select.selectOption('Patient requested cancellation')
 check(await specify.count()===0,'standard staff cancellation hides Specify')
 await select.selectOption('Other')
 check(await specify.inputValue()===''&&await confirm.isDisabled(),'staff cancellation clears stale detail')
 await specify.fill('Duplicate booking')
 await confirm.click()
 await dialog.getByText('Synthetic staff refusal',{exact:true}).waitFor()
 check(await specify.inputValue()==='Duplicate booking','staff cancellation retains detail on validation failure')
 await confirm.click()
 await page.getByText('Other — Duplicate booking',{exact:true}).first().waitFor()
 check(true,'staff appointment list displays the saved cancellation category and detail')
}

async function checkPrescriptionOther(page) {
 await openRolePage(page,'Prescriptions')
 const medicine=page.getByRole('combobox',{name:'Select medicine 1'})
 const specify=page.getByRole('textbox',{name:'Specify medicine name'})
 await medicine.selectOption('__other__')
 await specify.fill('An earlier custom entry')
 await medicine.selectOption('Amoxicillin')
 check(await specify.count()===0,'standard medicine hides the Other field')
 await medicine.selectOption('__other__')
 check(await specify.inputValue()==='','returning to Other clears stale medicine text')
 check(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),'unspecified medicine cannot be saved')
 await medicine.selectOption('Amoxicillin')
}

async function checkLeaveOther(page, role, submitted) {
 const navigation=page.getByRole('button',{name:role==='staff'?'Leave':'My Leave',exact:true}).filter({visible:true})
 if(!await navigation.count())await page.getByRole('button',{name:'Open navigation',exact:true}).click()
 await navigation.first().click()
 const category=page.getByRole('combobox',{name:'Type',exact:true})
 const privateNote=page.getByRole('textbox',{name:'Private note (optional)'})
 const specify=page.getByRole('textbox',{name:'Specify reason'})
 const submit=page.getByRole('button',{name:'Request leave',exact:true})
 await category.waitFor()
 await page.getByLabel('From',{exact:true}).fill('2099-01-15')
 await privateNote.fill('Original optional note')
 await category.selectOption('other')
 check(await submit.isDisabled(),'Other leave requires an explicit reason')
 await specify.fill('Synthetic caregiving')
 await submit.click()
 await page.getByText('Synthetic leave refusal',{exact:true}).waitFor()
 check(submitted[0]?.type==='other'&&submitted[0].private_note==='Synthetic caregiving','Other reason travels as the existing private leave note')
 check(await specify.inputValue()==='Synthetic caregiving','validation error retains the Other reason')
 await category.selectOption('sick')
 check(await specify.count()===0&&await privateNote.inputValue()==='Original optional note','standard leave restores its separate optional note')
 await category.selectOption('other')
 check(await specify.inputValue()===''&&await submit.isDisabled(),'returning to Other starts with an empty reason')
}


async function fillOtherUpload(page, submit, sent) {
 const category=page.getByRole('combobox',{name:'Category',exact:true})
 const description=page.getByRole('textbox',{name:'Specify document type'})
 await page.locator('input[type=file]').setInputFiles({name:'x.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')})
 await category.selectOption('other')
 await description.fill('Earlier details')
 await category.selectOption('valid_id')
 check(await description.count()===0,'the Other field hides for a standard category')
 await category.focus()
 await category.press('End')
 check(await category.inputValue()==='other','Other can be selected from the keyboard')
 check(await description.inputValue()==='','the previously entered detail clears')
 await submit.click()
 check(!sent.includes('POST /api/documents'),'blank Other cannot submit')
 await description.fill('Synthetic school clearance')
 await submit.click()
 await page.getByText(/not a permitted type/).waitFor()
 check(await description.inputValue()==='Synthetic school clearance','server refusal preserves Other detail')
 await submit.click()
 await page.getByText('Specified type: Synthetic school clearance',{exact:true}).waitFor()
}


try{
 for(const width of (process.env.QA_WIDTHS||'375,390,430,768,1024,1440').split(',').map(Number))for(const role of (process.env.QA_ROLES||'staff,dentist,owner,patient').split(',')){
  const context=await browser.newContext({viewport:{width,height:900}})
  const sent=[],leaveBodies=[]
  let savedAnswer=null, refuseAnswer=true, refuseCancel=true, refuseStaffCancel=true, staffAppointment=appointmentRow
  let patientAppointment={...appointmentRow,date:'2099-01-15',starts_at:'2099-01-15T10:00:00+08:00',ends_at:'2099-01-15T10:30:00+08:00',patient:{...appointmentRow.patient,id:OWN_ID}}
  const mode={docsFail:false,consentsFail:false,uploadFail:true,downloadStatus:404,uploaded:false}
  await context.route('**/sanctum/csrf-cookie',r=>r.fulfill({status:204}))
  await context.route('**/api/**',route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method()
   const email=role==='staff'?'staff.reception@example.test':`${role}@example.test`
   const me={selection_details_available:true,id:'01K00000000000000000000010',role,email,name:'QA account',account_status:'Active',branch_scopes:role==='staff'?[{id:'b1'}]:[],patient:role==='patient'?{id:OWN_ID,code:'PAT-0200'}:null,first_name:'Own',last_name:'Patient',phone:'+639170000000',date_of_birth:'1990-01-01'}
   sent.push(`${method} ${path}`)
   if(role==='staff'&&path==='/api/appointments'&&method==='GET'){
    const from=url.searchParams.get('from'), to=url.searchParams.get('to')
    const inWindow=(!from||staffAppointment.date>=from)&&(!to||staffAppointment.date<=to)
    return route.fulfill({json:{data:inWindow?[staffAppointment]:[],meta:{current_page:1,last_page:1}}})
   }
   if(role==='staff'&&path==='/api/appointments/'+appointmentRow.id+'/cancel'&&method==='POST'){
    const body=request.postDataJSON()
    check(body.reason_category==='Other'&&body.reason_detail==='Duplicate booking','staff cancellation submits category and detail independently')
    if(refuseStaffCancel){refuseStaffCancel=false;return route.fulfill({status:422,json:{message:'Synthetic staff refusal'}})}
    staffAppointment={...staffAppointment,status:'Cancelled',revision:2,cancellation_category:body.reason_category,cancellation_detail:body.reason_detail}
    return route.fulfill({json:{data:staffAppointment}})
   }
   if(role==='patient'&&path==='/api/appointments'&&method==='GET'){
    const status=url.searchParams.get('status')
    return route.fulfill({json:{data:!status||status===patientAppointment.status?[patientAppointment]:[],meta:{last_page:1}}})
   }
   if(role==='patient'&&path==='/api/appointments/'+appointmentRow.id+'/cancel'&&method==='POST'){
    const body=request.postDataJSON()
    check(body.reason_category==='Other'&&body.reason_detail==='Schedule conflict','cancellation sends independent selection and detail')
    if(refuseCancel){refuseCancel=false;return route.fulfill({status:422,json:{message:'Synthetic cancellation refusal'}})}
    patientAppointment={...patientAppointment,status:'Cancelled',revision:2,cancellation_category:body.reason_category,cancellation_detail:body.reason_detail}
    return route.fulfill({json:{data:patientAppointment}})
   }
   if(path==='/api/prescriptions/visits')return route.fulfill({json:{data:[],meta:{common_medicines:[]}}})
   if(path==='/api/assistant-answers'&&method==='GET')return route.fulfill({json:{data:savedAnswer?[savedAnswer]:[],meta:{categories:['other','about'],drafts:0}}})
   if(path==='/api/assistant-answers'&&method==='POST'){
    const body=request.postDataJSON()
    check(body.category==='other'&&body.category_detail==='Accessibility information'&&!!request.headers()['idempotency-key'],'Owner answer sends explicit detail and stable request key')
    if(refuseAnswer){refuseAnswer=false;return route.fulfill({status:422,json:{message:'Synthetic category refusal',errors:{category_detail:['Synthetic category refusal']}}})}
    savedAnswer={...body,id:'answer-qa',active:true,revision:1}
    return route.fulfill({status:201,json:{data:savedAnswer}})
   }
   if(path==='/api/leave/mine')return route.fulfill({status:200,json:{data:[],meta:{commands_available:true}}})
   if(path==='/api/leave'&&method==='POST'){
    leaveBodies.push(request.postDataJSON())
    return route.fulfill({status:422,json:{message:'Synthetic leave refusal',errors:{private_note:['Synthetic leave refusal']}}})
   }
   if(path==='/api/me')return route.fulfill({status:200,json:{data:me}})
   if(path==='/api/patients'&&method==='GET')return route.fulfill({status:200,json:{data:[{id:SERVER_ID,code:'PAT-0101',name:'Qa Server',first_name:'Qa',last_name:'Server',phone:'+639171234567',date_of_birth:'1991-02-03'}],meta:{current_page:1,last_page:1,total:1}}})
   if(path===`/api/patients/${SERVER_ID}`)return route.fulfill({status:200,json:{data:record}})
   if(path===`/api/patients/${SERVER_ID}/records`)return route.fulfill({status:200,json:{data:{patient:{id:SERVER_ID},appointments:[],visits:[],treatments:[],invoices:[],hmo_cases:[],limit_per_list:100,unavailable:[]}}})
   if(path===`/api/patients/${OWN_ID}`)return route.fulfill({status:200,json:{data:{...record,id:OWN_ID,name:'Own Patient',email:'patient@example.test',has_portal_account:true}}})
   if(path==='/api/documents/mine')return mode.docsFail?route.fulfill({status:500,json:{message:'boom'}}):route.fulfill({status:200,json:{data:mode.uploaded?[...docs,uploadedDoc]:docs}})
   if(path==='/api/consents/mine')return mode.consentsFail?route.fulfill({status:500,json:{message:'boom'}}):route.fulfill({status:200,json:{data:[]}})
   if(path==='/api/documents'&&method==='GET')return mode.docsFail?route.fulfill({status:500,json:{message:'boom'}}):route.fulfill({status:200,json:{data:mode.uploaded?[...docs,uploadedDoc]:docs}})
   if(path==='/api/documents'&&method==='POST'){
    sent.push(`UPLOAD key=${request.headers()['idempotency-key']||''} body=${(request.postData()||'').slice(0,4000).includes('name="branch_id"')?'has-branch':'no-branch'}`)
    check((request.postData()||'').includes('name="other_description"\r\n\r\nSynthetic school clearance'),'the upload sends the explicit Other detail as a separate part')
    if(mode.uploadFail){mode.uploadFail=false;return route.fulfill({status:422,json:{message:'This file’s content (\'text/html\') is not a permitted type.',code:'disallowed_mime_type'}})}
    mode.uploaded=true
    return route.fulfill({status:201,json:{data:uploadedDoc}})
   }
   if(path===`/api/documents/${DOC_PDF}`)return route.fulfill({status:200,json:{data:detail}})
   if(path.endsWith('/download'))return route.fulfill({status:mode.downloadStatus,json:{message:'x'}})
   if(path===`/api/patients/${SERVER_ID}/consents`)return mode.consentsFail?route.fulfill({status:500,json:{message:'boom'}}):route.fulfill({status:200,json:{data:[]}})
   const values={'/api/branches':branches,'/api/services':services,'/api/branch-services':branchServices,'/api/dentists':dentists,'/api/staff':staff,'/api/appointments':role==='dentist'?[appointmentRow]:[]}
   return route.fulfill({status:200,json:{data:values[path]??[]}})
  })
  const page=await context.newPage()
  page.on('pageerror',e=>errors.push(`${role}/${width}: ${e.message}`))
  page.on('console',m=>{if(m.type()==='error')errors.push(`${role}/${width}: ${m.text()}`)})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto(role==='patient' ? `${base}/#p/documents` : `${base}/#sign-in`)
  if(role!=='patient')await page.locator('.workspace-label').waitFor()

  if(role==='staff'||role==='dentist')await checkLeaveOther(page,role,leaveBodies)

  if(role==='staff'){
   await openDocuments(page,role)
   // documents list failure and consent failure are explicit, never an empty list
   mode.docsFail=true;mode.consentsFail=true
   await documentsTab(page)
   await page.getByText('Documents unavailable').waitFor();await page.getByText('Consent records unavailable').waitFor()
   check(await page.getByText('No documents are on file').count()===0&&await page.getByText('No consent records found').count()===0,'failed loads are not shown as empty')
   mode.docsFail=false;mode.consentsFail=false
   await page.getByRole('button',{name:'Retry',exact:true}).first().click()
   await page.getByText('Insurance card').first().waitFor();check(true,'retry recovers')
   check(await page.getByText(/Encrypted/i).count()===0,'no encryption claim')
   check(await page.getByText(/not scanned for malware/).count()>=1,'malware limitation is disclosed')
   check(await page.getByText('Text extraction is not available for images (OCR is not set up).').count()===1,'image extraction is reported unavailable, not fabricated')
   check(await page.getByRole('button',{name:'Retract'}).count()===2,'Staff may retract documents in their scope')
   await page.getByRole('button',{name:'View extracted text (draft)'}).click()
   await page.getByText(/Draft — not verified/).waitFor();await page.getByText('MAX-12345678').first().waitFor()
   check(await page.getByText('[object Object]').count()===0,'no raw object text')
   // upload: server refusal is explained, then success reloads the list
   await page.getByRole('button',{name:'Upload Document',exact:true}).first().click()
   const options=await page.locator('select').evaluateAll(els=>els.flatMap(e=>[...e.options].map(o=>o.value)))
   check(['consent_document','valid_id','clinical_attachment','hmo_card','treatment_request','referral','other'].every(v=>options.includes(v)),'categories match the server')
   check(!options.includes('prescription_source')&&!options.includes('invoice_proof'),'no unsupported categories')
   await fillOtherUpload(page,page.getByRole('button',{name:'Upload Document',exact:true}).last(),sent)
   check(sent.filter(s=>s.startsWith('UPLOAD')).every(s=>/key=\S+/.test(s)&&s.endsWith('has-branch')),'uploads carry an Idempotency-Key and an authorized branch')
   // download failure is explained
   await page.getByRole('button',{name:'Download'}).first().click()
   await page.getByText(/could not be found/).waitFor();check(true,'download failure is explained')
   await checkStaffCancellation(page)
  }else if(role==='dentist'){
   await openDocuments(page,role)
   await documentsTab(page)
   await page.getByText('Documents for your visits').waitFor()
   check(await page.getByRole('button',{name:'Upload Document',exact:true}).count()===0&&await page.getByRole('button',{name:'Record Consent',exact:true}).count()===0,'Dentist has no upload or consent actions')
   check(await page.getByRole('button',{name:'Retract'}).count()===0,'Dentist cannot retract')
   check(!sent.some(s=>s.includes('/consents')),'a Dentist session never requests consent records')
   await page.getByText('Insurance card').first().waitFor();check(true,'visit documents render')
   await checkPrescriptionOther(page)
  }else if(role==='owner'){
   const nav=page.getByRole('button',{name:'Patient Records',exact:true})
   if(!await page.getByRole('button',{name:'Branches',exact:true}).filter({visible:true}).count())await page.getByRole('button',{name:'Open navigation',exact:true}).click()
   check(await nav.count()===0,'Owner navigation exposes no documents page')
   await checkAssistantOther(page)
  }else{
   await page.getByText('Insurance card').first().waitFor()
   check(await page.getByRole('button',{name:'Retract'}).count()===1,'a Patient may retract only a document they uploaded')
   check(await page.getByText(/Encrypted/i).count()===0,'no encryption claim')
   mode.docsFail=true;mode.consentsFail=true
   await page.reload()
   await page.getByText('Documents unavailable').waitFor();await page.getByText('Consent records unavailable').waitFor()
   check(await page.getByText('You haven\'t uploaded any documents yet').count()===0,'a failed load is not an empty library')
   mode.docsFail=false;mode.consentsFail=false
   await page.getByRole('button',{name:'Retry',exact:true}).first().click()
   await page.getByText('Insurance card').first().waitFor();check(true,'retry recovers')
   await page.getByRole('button',{name:'Upload Document',exact:true}).click()
   await fillOtherUpload(page,page.getByRole('button',{name:'Upload',exact:true}),sent)
   await page.reload()
   await page.getByText('Specified type: Synthetic school clearance',{exact:true}).waitFor()
   await checkPatientCancellation(page)
  }
  await page.screenshot({path:`${output}/${role}-${width}.png`,fullPage:true})
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)
  check(overflow===0,`${role}/${width} overflow: ${overflow}`)
  results.push({role,width,overflow})
  await context.close()
 }
 const unexpected=errors.filter(e=>!/status of (500|404|422)/.test(e))
 check(unexpected.length===0,JSON.stringify(unexpected))
 await writeFile(`${output}/results.json`,JSON.stringify({checks,results,errors,mode:'HTTP fixtures'},null,2));console.log(JSON.stringify({checks,failures:0,errors:errors.length}))
}finally{await browser.close()}
