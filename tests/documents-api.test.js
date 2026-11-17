import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as api from '../src/api-client.js'
import { CONSENT_TYPES, DOCUMENT_CATEGORIES, downloadDocumentFile, fetchDocument, fetchDocuments, fetchMyConsents, fetchMyDocuments, mapDocument, submitDocumentUpload } from '../src/documents-api.js'

// M14 client: the clinic server is the only document authority; failures throw (callers show Retry), never an empty or demo list.

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
let calls
function stubFetch(...responses) {
  let i = 0
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, method: options.method || 'GET', headers: options.headers || {} }); return responses[Math.min(i++, responses.length - 1)] }
}
beforeEach(() => { calls = []; globalThis.document = { cookie: 'XSRF-TOKEN=t' }; api.__resetCsrfCacheForTests() })

const ROW = {
  id: '01j0000000000000000000d001', category: 'hmo_card', title: 'Card', original_filename: 'card.pdf', mime_type: 'application/pdf', file_size_bytes: 2048,
  checksum_sha256: 'a'.repeat(64), status: 'Active', metadata: null, patient: { id: 'p', code: 'PAT-1', name: 'A B' }, visit_id: null, hmo_case_id: null,
  branch: { id: 'b1', name: 'Dr. Dana Roxas Dental Clinic' }, uploaded_by: { role: 'patient' }, retracted_at: null, retraction_reason: null,
  text_extraction: 'draft_available', security_scan: 'not_performed', created_at: '2026-09-28T10:00:00+08:00',
  extractions: [{ id: 'e1', method: 'native_text', status: 'Draft', is_draft: true, confidence_score: null, extracted_at: '2026-09-28T10:00:00+08:00' }],
}

test('a document row maps with uploader role, extraction state and the honest scan status; list rows carry no extracted text', () => {
  const d = mapDocument(ROW)
  assert.deepEqual([d.uploadedByPatient, d.textExtraction, d.securityScan, d.fileSizeFormatted], [true, 'draft_available', 'not_performed', '2.0 KB'])
  assert.deepEqual([d.extractions[0].isDraft, d.extractions[0].rawText, d.extractions[0].candidates, d.extractions[0].confidenceScore], [true, null, null, null])
  const staff = mapDocument({ ...ROW, uploaded_by: { id: 'u', name: 'Staff', role: 'staff' }, text_extraction: undefined, mime_type: 'image/png', extractions: [] })
  assert.deepEqual([staff.uploadedByPatient, staff.textExtraction, staff.extractions], [false, 'unavailable_ocr_not_configured', []])
})

test('upload categories and consent types match the server enumerations exactly', () => {
  const list = (file, constant) => [...readFileSync(new URL(`../backend/app/Models/${file}`, import.meta.url), 'utf8').match(new RegExp(`${constant} = \\[([^\\]]*)\\]`))[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
  assert.deepEqual(DOCUMENT_CATEGORIES.map(([v]) => v).sort(), list('Document.php', 'CATEGORIES').sort())
  assert.deepEqual(CONSENT_TYPES.map(([v]) => v).sort(), list('PatientConsent.php', 'TYPES').sort())
})

test('every load failure throws a message instead of returning an empty list', async () => {
  for (const [status, kind] of [[403, 'forbidden'], [404, 'not_found'], [500, 'server']]) {
    for (const load of [() => fetchDocuments({ patient_id: 'x' }), fetchMyDocuments, fetchMyConsents, () => fetchDocument('x')]) {
      stubFetch(json(status, {}))
      await assert.rejects(load, error => error.ok === false && error.kind === kind && typeof error.message === 'string' && error.message.length > 0)
    }
  }
  globalThis.fetch = async () => { throw new TypeError('offline') }
  await assert.rejects(fetchMyDocuments, error => error.kind === 'network')
})

test('an upload carries the Idempotency-Key and is addressed to the documents endpoint only', async () => {
  stubFetch(json(200, {}), json(201, { data: ROW }))
  const doc = await submitDocumentUpload(new FormData(), 'key-123')
  assert.equal(doc.id, ROW.id)
  const post = calls.find(c => c.method === 'POST')
  assert.ok(post.url.endsWith('/api/documents'))
  assert.equal(post.headers['Idempotency-Key'], 'key-123')
})

test('download failures are explained per status and never expose a path', async () => {
  const expected = { 403: /permission/, 404: /could not be found/, 409: /does not match/, 410: /retracted/, 401: /session/ }
  for (const [status, message] of Object.entries(expected)) {
    stubFetch(json(Number(status), {}))
    await assert.rejects(() => downloadDocumentFile('01j0000000000000000000d001', 'x.pdf'), error => message.test(error.message) && !/documents\//.test(error.message))
  }
  globalThis.fetch = async () => { throw new TypeError('offline') }
  await assert.rejects(() => downloadDocumentFile('x', 'x.pdf'), /Could not reach/)
  stubFetch(json(200, {}))
  await assert.rejects(() => downloadDocumentFile('a/b?c', 'x'), () => true)
  assert.ok(calls.at(-1).url.endsWith('/api/documents/a%2Fb%3Fc/download'))
})

test('the document screens show errors with Retry, hide actions by role, never claim encryption and keep no local document authority', () => {
  const api = readFileSync(new URL('../src/documents-api.js', import.meta.url), 'utf8')
  const clinical = readFileSync(new URL('../src/pages/Clinical.jsx', import.meta.url), 'utf8')
  const me = readFileSync(new URL('../src/pages/PatientMe.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(api, /localStorage|sessionStorage|base64|createObjectURL\(new Blob/)
  for (const source of [clinical, me]) {
    assert.doesNotMatch(source, /[Ee]ncrypted|integrity verification/, 'no unsupported security claim')
    assert.doesNotMatch(source, /fetch(Patient|My)Consents\([^)]*\)\.catch\(\(\) => \[\]\)|fetchMyConsents\(\)\.catch|fetchMyDocuments\(\)\.catch/, 'a failed load is never turned into an empty list')
    assert.match(source, /Documents unavailable/)
    assert.match(source, /Consent records unavailable/)
    assert.match(source, /not scanned for malware/)
  }
  assert.match(clinical, /canRetract = doc => isStaff/)
  assert.match(clinical, /\{isStaff && <Button size="sm" disabled=\{!uploadBranchId\}/)
  assert.match(clinical, /Consent records and uploads are not available to Dentists yet/)
  assert.match(clinical, /Draft — not verified/)
  assert.match(clinical, /OCR is not set up/)
  assert.match(me, /doc\.uploadedByPatient/)
  assert.match(clinical, /const patientIdentifier = patient\?\.publicId \|\| null/)
})

test('GEN-07 reads an explicit Other description and preserves unlabelled legacy titles', () => {
  const row = { title: 'Legacy filename.pdf', category: 'other', file_size_bytes: 1024 }
  assert.equal(mapDocument(row).title, 'Legacy filename.pdf')
  assert.equal(mapDocument(row).otherDescription, null)
  assert.equal(mapDocument({ ...row, other_description: 'School clearance' }).otherDescription, 'School clearance')
  assert.equal(mapDocument({ ...row, category: 'valid_id', other_description: 'Stale detail' }).otherDescription, null)
})
