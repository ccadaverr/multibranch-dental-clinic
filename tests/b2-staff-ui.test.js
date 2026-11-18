import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('STF-09: a filtered closure list has a visible empty result and preserves the unfiltered count', () => {
  const page = read('src/pages/ClosedDates.jsx')
  assert.match(page, /Upcoming closures \(\$\{active\.length\}\)/)
  assert.match(page, /!active\.length \? <p[^>]*>No upcoming closures\.<\/p>/)
  assert.match(page, /!visibleActive\.length \? <p[^>]*role="status"[^>]*>No closures matching your filters\.<\/p>/)
  assert.match(page, /visibleActive\.map\(c => <ClosureRow/)
})

test('STF-12: changing patient modes cannot submit a stale patient identity', () => {
  const page = read('src/pages/PatientFlow.jsx')
  assert.match(page, /const canWalkIn=!registering&&!!selectedPatient&&/)
  assert.match(page, /checked=\{registering\} disabled=\{registerBusy \|\| registerUncertain\} onChange=\{\(\)=>\{setRegistering\(true\);updateWalkin\('patientPublicId',''\);setSearch\(''\);setPatientMenuOpen\(false\);setActiveIndex\(-1\)\}\}/)
  assert.match(page, /onChange=\{e=>\{setSearch\(e\.target\.value\);setPatientMenuOpen\(true\);setActiveIndex\(-1\);if\(walkIn\.patientPublicId\)updateWalkin\('patientPublicId',''\)\}\}/)
  assert.match(page, /aria-activedescendant=\{patientMenuOpen&&directory\[activeIndex\]/)
})
