import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('src/pages/ServerBilling.jsx', 'utf8')
const patient = fs.readFileSync('src/pages/PatientCare.jsx', 'utf8')
const api = fs.readFileSync('src/api-client.js', 'utf8')

test('M11 frontend exposes server invoice, treatment and receipt commands', () => {
  for (const name of ['listBillingInvoices', 'listBillingTreatments', 'createBillingDraft', 'reviewBillingInvoice', 'issueBillingInvoice', 'recordBillingPayment', 'myBillingInvoices']) assert.match(api, new RegExp(`export function ${name}`))
})

test('Staff billing begins from completed Treatment worklist and shows pricing unavailable', () => {
  assert.match(page, /Completed treatments awaiting billing/)
  assert.match(page, /pricing_unavailable/)
  assert.match(page, /Create Draft/)
})

test('Review, Issue and Payment actions use server commands', () => {
  assert.match(page, /reviewBillingInvoice/)
  assert.match(page, /issueBillingInvoice/)
  assert.match(page, /recordBillingPayment/)
  assert.match(page, /key: commandKey/)
})

test('payment UI requires an external reference for non-cash recording methods', () => {
  assert.match(page, /Card\/POS/)
  assert.match(page, /Bank Transfer/)
  assert.match(page, /E-Wallet/)
  assert.match(page, /required=\{method !== 'Cash'\}/)
})

test('Patient billing uses server-owned reads and shows HMO settlement clearly', () => {
  assert.match(patient, /myBillingInvoices/)
  assert.match(patient, /full_hmo_coverage/)
  assert.match(patient, /no Patient payment was collected/)
})

test('browser server failures do not silently become current local balances', () => {
  assert.match(patient, /Your invoices could not be loaded/)
  assert.match(page, /Billing records unavailable/)
  assert.match(page, /No current financial action is available until the server billing records load/)
})

test('new browser-local financial mutations are not added by M11', () => {
  assert.doesNotMatch(page, /actions\.createInvoice|actions\.postPayment\([^)]*server/)
  assert.match(page, /setRows/)
})
