import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { INITIAL_PRESCRIPTIONS, NAV } from '../src/data.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('M19: prescriptions come from the clinic server; the browser mock and its seed are gone', () => {
  assert.deepEqual(INITIAL_PRESCRIPTIONS, [])
  assert.doesNotMatch(read('src/pages/Clinical.jsx'), /export function PrescriptionsPage/)
  assert.doesNotMatch(read('src/pages/PatientCare.jsx'), /export function PatientPrescriptionsPage/)
  assert.match(read('src/App.jsx'), /import\('\.\/pages\/ServerPrescriptions\.jsx'\)/)
  for (const role of ['dentist', 'staff', 'owner']) assert.ok(NAV[role].some(([k]) => k === 'prescriptions'), role)
})

test('M19: dentist form shows the allergy check, has no drug database or interaction claims, and issuing is final', () => {
  const page = read('src/pages/ServerPrescriptions.jsx')
  assert.match(page, /title="Check allergies before prescribing"/)
  assert.match(page, /There is no drug list and no interaction check/)
  assert.doesNotMatch(page, /interaction warning|drug database|e-signature|digitally signed/i)
  assert.match(page, /Issuing locks the prescription and gives it a number\. It cannot be edited afterwards, only voided\./)
  assert.match(page, /voidPrescription\(id, submitted\.reason, submitted\.revision, submitted\.key, owns, clinicalContext\)/)
})

test('M19 (4.4): medicine name autocomplete and Other free-text option exist with no dev-written dosing defaults', () => {
  const page = read('src/pages/ServerPrescriptions.jsx')
  assert.match(page, /<datalist id="rx-common">/)
  assert.match(page, /<option value="__other__">Other \(free-text entry\)<\/option>/)
  assert.doesNotMatch(page, /COMMON_PRESETS/)
  assert.doesNotMatch(page, /Every 8 hours|Every 4 to 6 hours|Every 12 hours|Maximum 4000mg/i)
})

test('M19: Other selection retains custom values and sends only clinical line fields', () => {
  const page = read('src/pages/ServerPrescriptions.jsx')
  const names = ['OTHER_OPTION', 'EMPTY_LINE', 'LINE_FIELDS', 'selectedOption', 'chooseOption', 'apiLine']
  const declarations = names.map(name => {
    const line = page.match(new RegExp(`^const ${name} = .+$`, 'm'))?.[0]
    assert.ok(line, `${name} helper is present`)
    return line
  })
  const { selectedOption, chooseOption, apiLine } = runInNewContext(`${declarations.join(';')}; ({ selectedOption, chooseOption, apiLine })`)
  const catalogs = { medicine: ['Amoxicillin'], dosage: ['500mg'], frequency: ['Once daily'], duration: ['3 days'] }
  let line = { medicine: '', dosage: '', frequency: '', duration: '', instructions: '' }
  for (const [field, custom] of Object.entries({ medicine: 'Custom medicine', dosage: '750mg', frequency: 'Every 4 hours', duration: '9 days' })) {
    line = chooseOption(line, field, '__other__')
    assert.equal(selectedOption(line, field, catalogs[field]), '__other__', `${field}: Other stays selected while empty`)
    assert.equal(apiLine(line)[field], '', `${field}: selection marker is not a clinical value`)
    line = { ...line, [field]: custom }
    assert.equal(selectedOption(line, field, catalogs[field]), '__other__', `${field}: custom input stays selected after typing`)
  }
  line = { ...line, instructions: 'After meals' }
  assert.deepEqual({ ...apiLine(line) }, { medicine: 'Custom medicine', dosage: '750mg', frequency: 'Every 4 hours', duration: '9 days', instructions: 'After meals' })
  assert.equal(Object.keys(apiLine(line)).some(key => key.endsWith('Other')), false, 'UI selection flags stay out of payload')
  for (const [field, catalog] of Object.entries(catalogs)) {
    line = chooseOption(line, field, catalog[0])
    assert.equal(selectedOption(line, field, catalog), catalog[0], `${field}: catalog value remains selectable`)
  }
  line = chooseOption(line, 'medicine', '__other__')
  line = { ...line, medicine: 'Amoxicillin' }
  assert.equal(selectedOption(line, 'medicine', catalogs.medicine), '__other__', 'custom editing keeps Other selected even when text matches catalog')
  assert.equal(selectedOption({ medicine: 'Previously saved custom' }, 'medicine', catalogs.medicine), '__other__', 'saved custom value remains editable')
  for (const field of Object.keys(catalogs)) {
    assert.match(page, new RegExp(`set\\(i, '${field}', e\\.target\\.value, true\\)`), `${field}: custom input preserves Other selection`)
    assert.match(page, new RegExp(`choose\\(i, '${field}', val\\)`), `${field}: selector uses separate option state`)
  }
  assert.match(page, /lines\.filter\(l => l\.medicine\.trim\(\)\)\.map\(apiLine\)/)
  assert.match(page, /const missingCustomValue = lines\.some/)
  assert.match(page, /\|\| missingCustomValue \|\| lines\.some\(l => !l\.medicine\.trim\(\)\)/)
})

test('M19: the patient sees issued prescriptions read-only with a PDF, and a void one is marked', () => {
  const page = read('src/patient/pages/Prescriptions.jsx')
  assert.match(page, /myPrescriptions\(\)/); assert.match(page, /downloadPrescriptionPdf\(p\.id,\s*p\.number,\{isCurrent:/)
  assert.match(page, /VOID — do not use/)
  assert.doesNotMatch(page, /updatePrescription|issuePrescription|voidPrescription/)
  assert.match(read('src/patient/Portal.jsx'), /\['prescriptions', 'file', 'Prescriptions'\]/)
})

test('DEN-06 / DEN-07 / DEN-08: medicine dropdown omits dosage, remove medicine is danger-styled, and license Save button uses standard size', () => {
  const page = read('src/pages/ServerPrescriptions.jsx'), foundation = read('src/foundation.css'), autoCss = read('src/automations.css')
  assert.doesNotMatch(page, /'Amoxicillin 500mg'|'Mefenamic Acid 500mg'|'Paracetamol 500mg'|'Ibuprofen 400mg'|'Co-amoxiclav 625mg'|'Clindamycin 300mg'|'Tranexamic Acid 500mg'|'Celecoxib 200mg'|'Chlorhexidine 0\.12% Oral Rinse'/)
  assert.match(page, /'Amoxicillin'/)
  assert.match(page, /<Button size="sm" variant="danger" onClick=\{\(\) => setLines\(ls => ls\.filter/)
  assert.match(foundation, /\.btn\.danger:hover:not\(:disabled\)/)
  assert.match(page, /<form className="au-form rx-license-row"/)
  assert.match(page, /<div className="au-actions"><Button type="submit" disabled=\{busy\}>\{busy \? 'Saving…' : 'Save'\}<\/Button><\/div>/)
  assert.match(autoCss, /\.rx-license-row \{ display: flex; flex-wrap: wrap; align-items: flex-end;/)
})
