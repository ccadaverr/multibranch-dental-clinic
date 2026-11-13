import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { variableValue } from './support/source-behavior.js'
import { looksClean, parseDate, parseIdText, parseMrz, parsePhilIdQr, scanVerdict, splitFullName } from '../src/intake/id-parse.js'
import { publicViewFromHash } from '../src/public-route.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('PhilID QR: only the names and the birth date are read; the PCN is ignored', () => {
  const r = parsePhilIdQr(JSON.stringify({ subject: { lName: 'SPECIMEN', fName: 'JOANNA MARIE', mName: 'REYES', DOB: 'January 17, 1990', PCN: '0000-1111-2222-3333', POB: 'X' } }))
  assert.deepEqual(r.fields, { last_name: 'Specimen', first_name: 'Joanna Marie', date_of_birth: '1990-01-17' })
  assert.doesNotMatch(JSON.stringify(r), /0000-1111|PCN/)
  assert.equal(parsePhilIdQr('not json'), null)
})

test('passport MRZ: names from line 1 and the birth date from line 2', () => {
  const r = parseMrz('P<PHLSPECIMEN<<ANA<MARIA<<<<<<<<<<<<<<<<<<<<<<<<\nP0000000<0PHL9306219F3101012<<<<<<<<<<<<<<04')
  assert.deepEqual(r.fields, { last_name: 'Specimen', first_name: 'Ana Maria', date_of_birth: '1993-06-21' })
})

test('labelled IDs: bilingual labels, LAST, FIRST MIDDLE, full names with De La, frame junk and misread date slashes', () => {
  assert.deepEqual(parseIdText('PAMBANSANG PAGKAKAKILANLAN\nAPELYIDO / LAST NAME\nSPECIMEN\nMGA PANGALAN / GIVEN NAMES\nJOANNA MARIE\nGITNANG APELYIDO / MIDDLE NAME\nREYES\nPETSA NG KAPANGANAKAN / DATE OF BIRTH\nJANUARY 17, 1990', 90).fields,
    { first_name: 'Joanna Marie', last_name: 'Specimen', date_of_birth: '1990-01-17' })
  assert.deepEqual(parseIdText("DRIVER'S LICENSE\nLAST NAME, FIRST NAME, MIDDLE NAME\nSPECIMEN, MARIA CLARA SANTOS\nDATE OF BIRTH 1988/03/09", 90).fields,
    { first_name: 'Maria Clara', last_name: 'Specimen', date_of_birth: '1988-03-09' })
  assert.deepEqual(parseIdText('SENIOR CITIZEN ID\n~ NAME TERESITA DE LA SPECIMEN\nDATE OF BIRTH MARCH 3, 1950', 90).fields,
    { first_name: 'Teresita', last_name: 'De La Specimen', date_of_birth: '1950-03-03' })
  assert.deepEqual(parseIdText('VOTER\npemmm=— SURNAME\n~ SPECIMEN\n| FIRST NAME\nPHOTO | PEDRO\n| DATE OF BIRTH\nLo 1969111104', 80).fields,
    { first_name: 'Pedro', last_name: 'Specimen', date_of_birth: '1969-11-04' })
  assert.equal(parseIdText('UNIFIED MULTI-PURPOSE ID\nSURNAME X').id_type, 'umid')
  assert.equal(parseDate('12 AUG 1982'), '1982-08-12'); assert.equal(parseDate('05/21/1991'), '1991-05-21'); assert.equal(parseDate('2099-01-01'), null)
  assert.deepEqual(splitFullName('ROBERTO A. SPECIMEN'), { first_name: 'Roberto', last_name: 'Specimen' })
})

test('a poor read never fills the form: "We couldn’t read it clearly, please type it"', () => {
  assert.equal(scanVerdict(null).ok, false)
  assert.match(scanVerdict({ fields: { first_name: '', last_name: '', date_of_birth: '1980-01-01' }, confidence: 0.24 }).message, /couldn’t read it clearly, please type it/)
  assert.equal(scanVerdict({ fields: { first_name: 'Ana', last_name: 'Cruz', date_of_birth: '1990-01-01' }, confidence: 0.9 }).ok, true)
  assert.equal(looksClean({ fields: { first_name: 'Www Juan', last_name: 'Cruz', date_of_birth: '1990-01-01' }, confidence: 0.9 }), false) // frame noise
})

test('the scan runs on the device: lazy-loaded, self-hosted OCR, no upload, consent first, photo dropped', () => {
  const join = read('src/pages/Join.jsx'), scan = read('src/intake/id-scan.js'), register = read('src/pages/PatientRegister.jsx')
  assert.match(join, /import\('\.\.\/intake\/id-scan\.js'\)/) // a separate chunk, loaded on tap
  assert.doesNotMatch(join + register, /from '\.\.\/intake\/id-scan\.js'/) // never statically imported
  assert.match(scan, /workerPath: '\/ocr\/worker\.min\.js', corePath: '\/ocr', langPath: '\/ocr'/)
  assert.doesNotMatch(scan, /fetch\(|XMLHttpRequest|FormData|sendBeacon/)
  assert.match(scan, /canvas\.width = canvas\.height = 0/)
  assert.match(join, /photo is not uploaded and not kept, and your ID number is not read or stored/)
  assert.match(join, /scan: \{ id_type: scan\.id_type, fields: scan\.fields \}/) // only which fields came from the ID
  assert.match(read('scripts/copy-ocr-assets.mjs'), /public', 'ocr'/)
  assert.match(read('.gitignore'), /^public\/ocr\/$/m)
})

test('counter registration: routes, today’s code, consent, why each field, minors through a guardian', () => {
  assert.equal(publicViewFromHash('#join/b1'), 'join'); assert.equal(publicViewFromHash('#claim-account'), 'claim')
  const join = read('src/pages/Join.jsx')
  assert.match(join, /Today’s code at the front desk/); assert.match(join, /disabled=\{busy \|\| !consent/)
  for (const why of ['name:', 'date_of_birth:', 'phone:', 'email:', 'emergency:']) assert.ok(join.includes(why), why)
  assert.match(join, /Under 18\? A parent or guardian registers them here/)
  assert.doesNotMatch(join, /kiosk/i)
  assert.doesNotMatch(join, /60000/)
  const staff = read('src/pages/CounterIntake.jsx')
  assert.match(staff, /Self-registered: verify ID/); assert.match(staff, /Record found from \{d\.found_from/); assert.match(staff, /Nothing is merged automatically/)
  assert.match(staff, /Minor: guardian/)
})

test('demo reset keeps the worker, scheduler and Reverb alive and reloads their code', () => {
  const reset = read('scripts/demo-reset.sh'), start = read('scripts/demo-start.sh')
  assert.match(start, /supervise worker php artisan queue:work/); assert.match(start, /CACHE_STORE=file "\$@"/) // a restart loop, file cache
  assert.match(reset, /CACHE_STORE=file php artisan queue:restart/); assert.match(reset, /CACHE_STORE=file php artisan reverb:restart/)
  assert.match(reset, /fallback worker queue:work php artisan queue:work/); assert.match(reset, /up "$name" || supervised "$name" "$pattern"/) // never a duplicate; assert.match(reset, /worker, scheduler and Reverb are running/)
  assert.ok(reset.indexOf('HAD_WORKER=1') < reset.indexOf('migrate:fresh'), 'records what was running before the rebuild')
})

test('account claim: a one-time link route, the code goes to the stored email, the password only with the code', () => {
  assert.equal(publicViewFromHash('#claim-account/' + 'a'.repeat(48)), 'claim')
  const claim = read('src/pages/ClaimAccount.jsx'), staff = read('src/pages/CounterIntake.jsx')
  assert.match(claim, /claimAccount\(\{ email: form\.email, date_of_birth: form\.date_of_birth \}\)/) // no password at step 1
  assert.match(claim, /verifyClaim\(\{ \.\.\.\(token \? \{ token \} : \{ email: form\.email \}\), otp: form\.otp, password: form\.password/) // the link names the account
  assert.match(read('src/App.jsx'), /ClaimAccount onVerified=\{email=>\{setSignInNotice\(\{email,message:'Your account is verified\. Please sign in\.'\}\)/)
  assert.match(claim, /claimAccount\(\{ token \}\)/)
  assert.match(staff, /Offer online account/); assert.match(staff, /Confirm the patient’s email with them/)
})

test('walkthrough fixes: phone-only intake, honest invite outcome, a dependent named on success', () => {
  const join = read('src/pages/Join.jsx'), family = read('src/patient/pages/Family.jsx'), book = read('src/patient/pages/Book.jsx'), staff = read('src/pages/CounterIntake.jsx')
  assert.doesNotMatch(staff, /#kiosk\//)
  assert.match(join, /r\.kind === 'not_found' \? 'invalid' : 'offline'/)
  assert.doesNotMatch(family, /window\.prompt/)
  assert.match(family, /r\.data\?\.status === 'transport_accepted'/)
  assert.match(book, /\$\{forName\} is booked!/)
  assert.match(read('src/pages/Clinical.jsx'), /<IdCheck patientId=\{patient\.id\}/) // offer an account from the patient record
  assert.match(read('src/pages/CounterIntake.jsx'), /Under 18: no online account of their own/)
})

test('STF-04 counter intake ID check: "other" ID requires specify text and passes other_details', async () => {
  const calls = [], feedback = [], errors = []
  let record = {id:'patient-A',profile_access:'full'}, busy = false, touched = false
  const bindings = {
    patientId:'patient-A', record, type:'other', otherText:'   ', failure:null,
    live:{current:true}, verifying:{current:false}, setBusy:v=>{busy=v}, setFailure:v=>errors.push(v), setOtherTouched:v=>{touched=v},
    verifyPatientId:async(id,body)=>{calls.push({id,body:JSON.parse(JSON.stringify(body))});return {ok:false,kind:'validation'}},
    setRecord:update=>{record=update(record)}, toast:(...args)=>feedback.push(args),
  }
  await variableValue('src/pages/CounterIntake.jsx','go',bindings,'PatientIdCheck')()
  assert.equal(touched,true); assert.deepEqual(calls,[]); assert.equal(busy,false)
  bindings.otherText=' Company ID '
  await variableValue('src/pages/CounterIntake.jsx','go',bindings,'PatientIdCheck')()
  assert.deepEqual(calls,[{id:'patient-A',body:{id_type:'other',other_details:'Company ID'}}])
  assert.equal(record.id_check,undefined); assert.deepEqual(feedback,[])
  assert.equal(errors.at(-1).kind,'validation')
  bindings.type='philid'
  await variableValue('src/pages/CounterIntake.jsx','go',bindings,'PatientIdCheck')()
  assert.deepEqual(calls.at(-1),{id:'patient-A',body:{id_type:'philid'}})
  for(const kind of ['forbidden','unauthenticated','unconfirmed']) {
    bindings.failure={kind}; const count=calls.length
    await variableValue('src/pages/CounterIntake.jsx','go',bindings,'PatientIdCheck')()
    assert.equal(calls.length,count)
  }
  // The counter confirmation still conditionally includes a trimmed detail.
  const staff=read('src/pages/CounterIntake.jsx')
  assert.match(staff, /record\.id_check\.other_details/)
  assert.match(staff, /\.\.\.\(idType === 'other' \? \{ other_details: idOther\.trim\(\) \} : \{\}\)/)
  assert.match(staff, /disabled=\{!!busy \|\| \(idChecked && idType === 'other' && !idOther\.trim\(\)\)\}/)
})

for(const detail of [undefined,'Different ID type']) test('STF-04 mismatched ID receipt remains unverified: '+String(detail), async()=>{
  let record={id:'patient-A',profile_access:'full'}, failure=null; const feedback=[]
  const go=variableValue('src/pages/CounterIntake.jsx','go',{
    patientId:'patient-A',record,type:'other',otherText:'Company ID',failure:null,live:{current:true},verifying:{current:false},
    setBusy(){},setOtherTouched(){},setFailure:v=>{failure=v},setRecord:update=>{record=update(record)},toast:(...x)=>feedback.push(x),
    verifyPatientId:async()=>({ok:true,data:{id_type:'other',other_details:detail,id_verified_at:'2026-11-13T08:00:00+08:00'}}),
  },'PatientIdCheck')
  await go(); assert.equal(record.id_check,undefined); assert.equal(failure?.kind,'unconfirmed'); assert.deepEqual(feedback,[])
})

test('GEN-07 "other" choices require specify field and block saving without it in Join, Family, and Clinical', () => {
  const join = read('src/pages/Join.jsx'), family = read('src/patient/pages/Family.jsx'), clinical = read('src/pages/Clinical.jsx'), workflow = read('src/workflow.js')
  assert.match(join, /<SelectWithOther label="Relationship" required value=\{d\.relationship\}/)
  assert.match(join, /placeholder="e\.g\., Niece, Nephew, Cousin"/)
  assert.match(join, /deps\.some\(d => d\.relationship === 'Other' && !\(d\.relationship_other \|\| ''\)\.trim\(\)\)/)
  assert.match(family, /<SelectWithOther label="Relationship" required value=\{form\.relationship\}/)
  assert.match(family, /placeholder="e\.g\., Niece, Nephew, Cousin"/)
  assert.match(family, /\(form\.relationship === 'Other' && !\(form\.relationship_other \|\| ''\)\.trim\(\)\)/)
  assert.match(clinical, /disabled=\{newPatient\.sex==='Other'&&!\(newPatient\.sexOther\|\|''\)\.trim\(\)\} onClick=\{createPatient\}/)
  assert.match(workflow, /if\(person\.sex==='Other'&&!clean\(person\.sexOther\)\)return fail\('Please specify sex \/ gender when Other is selected\.'\)/)
  assert.match(workflow, /sex:person\.sex==='Other'\?clean\(person\.sexOther\):clean\(person\.sex\)/)
  assert.match(read('src/administration.js'), /if\('sex' in personPatch\)personPatch\.sexOther=\['Female','Male',''\]\.includes\(personPatch\.sex\)\?'':personPatch\.sex/)
})
