import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mapDocument, mapConsent } from '../src/documents-api.js'

const clinical = fs.readFileSync('src/pages/Clinical.jsx', 'utf8')
const patientMe = fs.readFileSync('src/pages/PatientMe.jsx', 'utf8')
const api = fs.readFileSync('src/api-client.js', 'utf8')
const docsApi = fs.readFileSync('src/documents-api.js', 'utf8')

test('M14 api-client exports server document and consent endpoints', () => {
  for (const name of [
    'listDocuments',
    'myDocuments',
    'getDocument',
    'uploadDocument',
    'retractDocument',
    'listPatientConsents',
    'myConsents',
    'grantPatientConsent',
    'withdrawPatientConsent',
  ]) {
    assert.match(api, new RegExp(`export function ${name}`))
  }
})

test('M14 rawFetch handles FormData uploads without overriding multipart Content-Type', () => {
  assert.match(api, /isForm = typeof FormData !== 'undefined' && options\.body instanceof FormData/)
  assert.match(api, /\.\.\.\(options\.body && !isForm \? \{ 'Content-Type': 'application\/json' \} : \{\}\)/)
})

test('mapDocument converts server document resource to presentation shape with formatted size and draft extractions', () => {
  const row = {
    id: '01k9doc1234567890abcdef',
    title: 'Valid ID Card',
    category: 'valid_id',
    original_filename: 'passport.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 204800,
    checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'Active',
    created_at: '2026-10-06T10:00:00+08:00',
    text_extraction: 'draft_available',
    extractions: [
      {
        id: '01k9ext1234567890abcdef',
        method: 'native_text',
        status: 'Draft',
        is_draft: true,
        confidence_score: null,
        raw_text: 'Sample passport text',
        structured_payload: { name_candidate: 'Maria Santos', is_draft_only: true },
        extracted_at: '2026-10-06T10:00:01+08:00',
      },
    ],
  }

  const mapped = mapDocument(row)
  assert.equal(mapped.id, '01k9doc1234567890abcdef')
  assert.equal(mapped.title, 'Valid ID Card')
  assert.equal(mapped.fileSizeFormatted, '200.0 KB')
  assert.equal(mapped.status, 'Active')
  assert.equal(mapped.checksumSha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(mapped.extractions.length, 1)
  assert.equal(mapped.extractions[0].status, 'Draft')
  assert.equal(mapped.extractions[0].isDraft, true)
  assert.equal(mapped.extractions[0].candidates.is_draft_only, true)
  assert.equal(mapped.textExtraction, 'draft_available')
})

test('mapConsent converts server consent resource to presentation model', () => {
  const row = {
    id: '01k9con1234567890abcdef',
    consent_type: 'general_treatment',
    version: '1.0',
    status: 'Granted',
    signed_at: '2026-10-06T09:30:00+08:00',
    withdrawn_at: null,
    notes: 'In-person signature',
  }

  const mapped = mapConsent(row)
  assert.equal(mapped.id, '01k9con1234567890abcdef')
  assert.equal(mapped.consentType, 'general_treatment')
  assert.equal(mapped.status, 'Granted')
  assert.equal(mapped.notes, 'In-person signature')
})

test('Clinical.jsx renders PatientDocumentsTab in centralized patient records', () => {
  assert.match(clinical, /PatientDocumentsTab/)
  assert.match(clinical, /tab==='documents'&&<PatientDocumentsTab/)
  assert.match(clinical, /fetchDocuments/)
  assert.match(clinical, /fetchPatientConsents/)
  assert.match(clinical, /submitDocumentUpload/)
  assert.match(clinical, /retractDocument/)
  assert.match(clinical, /downloadDocumentFile/)
})

test('Clinical.jsx displays draft extraction advisory note without automatically mutating clinical records', () => {
  assert.match(clinical, /Draft — not verified/)
  assert.match(clinical, /View extracted text \(draft\)/)
})

test('PatientMePage includes patient documents and consents views', () => {
  assert.match(patientMe, /My Documents/)
  assert.match(patientMe, /Consents & Agreements/)
  assert.match(patientMe, /readPatientDocuments\(myDocuments,patientId,valid\)/)
  assert.match(patientMe, /readPatientConsents\(myConsents,patientId,valid\)/)
  assert.match(patientMe, /downloadDocumentFile/)
  assert.match(patientMe, /retractDocument/)
  assert.match(patientMe, /<PageHead/)
})

test('Section 2.5: PatientMePage renders Uploaded by you vs Shared by clinic source badge from server-derived uploadedByPatient', () => {
  assert.match(patientMe, /doc\.uploadedByPatient \? 'Uploaded by you' : 'Shared by clinic'/)
  assert.equal(mapDocument({ id: 'd1', original_filename: 'a.pdf', file_size_bytes: 1024, uploaded_by: { role: 'patient' } }).uploadedByPatient, true)
  assert.equal(mapDocument({ id: 'd2', original_filename: 'b.pdf', file_size_bytes: 1024, uploaded_by: { role: 'staff' } }).uploadedByPatient, false)
})
