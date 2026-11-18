import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toothLabel } from '../src/components/odontogram/toothShapes.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('M10: Universal numbering maps every FDI tooth (adult 1–32, primary A–T)', async () => {
  assert.equal(toothLabel('18', 'universal'), '1'); assert.equal(toothLabel('11', 'universal'), '8'); assert.equal(toothLabel('21', 'universal'), '9')
  assert.equal(toothLabel('28', 'universal'), '16'); assert.equal(toothLabel('38', 'universal'), '17'); assert.equal(toothLabel('31', 'universal'), '24')
  assert.equal(toothLabel('41', 'universal'), '25'); assert.equal(toothLabel('48', 'universal'), '32')
  assert.equal(toothLabel('55', 'universal'), 'A'); assert.equal(toothLabel('65', 'universal'), 'J'); assert.equal(toothLabel('75', 'universal'), 'K'); assert.equal(toothLabel('85', 'universal'), 'T')
  assert.equal(toothLabel('36', 'fdi'), '36')
})

test('M10: teeth are keyboard buttons with text labels (not colour alone); no diagnosis; front desk and patient read-only', () => {
  const chart = read('src/pages/DentalChart.jsx')
  const odSrc = read('src/components/odontogram/Odontogram.jsx')
  assert.match(odSrc, /role="button"/)
  assert.match(odSrc, /tabIndex=\{0\}/)
  assert.match(odSrc, /e\.key === 'Enter' \|\| e\.key === ' '/)
  assert.match(chart, /The system makes no diagnosis or suggestion/)
  assert.doesNotMatch(chart, /suggest(ed|ion) (treatment|diagnosis)|likely|probab/i)
  assert.match(read('src/pages/Clinical.jsx'), /<ChartView patientId=\{patient\.id\} canRecord=\{false\}/)
  assert.doesNotMatch(read('src/patient/pages/Teeth.jsx'), /recordChartEntry/)
  assert.match(read('src/patient/pages/Teeth.jsx'), /canRecord=\{false\}/)
})

test('M10: the record form starts fresh for each tooth (no surfaces carried over from another tooth)', () => {
  const odSrc = read('src/components/odontogram/Odontogram.jsx')
  const timelineSrc = read('src/components/odontogram/ToothTimeline.jsx')
  assert.match(odSrc, /<ToothTimeline[\s\S]*tooth=\{selected\}/)
  assert.match(timelineSrc, /surfaces:\s*\[\]/)
  assert.match(timelineSrc, /setF\(x => \(\{ \.\.\.x, status: '', surfaces: \[\], note: '' \}\)\)/)
})
