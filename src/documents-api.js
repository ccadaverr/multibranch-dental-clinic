import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'

// M14 client. The clinic server is the only document authority: nothing here reads or writes browser storage, builds a file
// URL, or falls back to local data. Every function throws a normalized failure ({kind, message}) so callers can show an
// explicit error with Retry. Text extraction is always a DRAFT (see `textExtraction`); there is no OCR and no malware scan.

export const DOCUMENT_CATEGORIES = [
  ['consent_document', 'Consent Document'], ['valid_id', 'Valid ID'], ['clinical_attachment', 'Clinical Attachment'],
  ['hmo_card', 'HMO Card'], ['treatment_request', 'Treatment Request'], ['referral', 'Referral'], ['other', 'Other Document'],
]
export const CONSENT_TYPES = [
  ['general_treatment', 'General Dental Treatment'], ['data_privacy', 'Data Privacy & Consent'], ['hmo_authorization', 'HMO Authorization'],
  ['photography_consent', 'Photography Consent'], ['minor_treatment', 'Minor Treatment (guardian)'],
]

export function mapExtraction(e) {
  return {
    id: e.id,
    method: e.method,
    status: e.status,
    isDraft: e.is_draft !== false,
    confidenceScore: e.confidence_score ?? null,
    extractedAt: e.extracted_at || null,
    rawText: e.raw_text ?? null,
    candidates: e.structured_payload || null,
  }
}

export function mapDocument(row) {
  return {
    id: row.id,
    title: row.title || row.original_filename,
    category: row.category,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    fileSizeFormatted: row.file_size_bytes < 1024 * 1024
      ? `${(row.file_size_bytes / 1024).toFixed(1)} KB`
      : `${(row.file_size_bytes / (1024 * 1024)).toFixed(2)} MB`,
    checksumSha256: row.checksum_sha256,
    status: row.status,
    patient: row.patient || null,
    branch: row.branch || null,
    visitId: row.visit_id || null,
    hmoCaseId: row.hmo_case_id || null,
    uploader: row.uploaded_by || null,
    uploadedByPatient: row.uploaded_by?.role === 'patient',
    retractionReason: row.retraction_reason || null,
    retractedAt: row.retracted_at || null,
    createdAt: row.created_at,
    metadata: row.metadata || {},
    // draft_available | no_text_layer | unavailable_ocr_not_configured
    textExtraction: row.text_extraction || 'unavailable_ocr_not_configured',
    securityScan: row.security_scan || 'not_performed',
    extractions: (row.extractions || []).map(mapExtraction),
  }
}

export function mapConsent(row) {
  return {
    id: row.id,
    consentType: row.consent_type,
    version: row.version,
    status: row.status,
    signedAt: row.signed_at,
    withdrawnAt: row.withdrawn_at,
    notes: row.notes,
    patientId: row.patient_id || null,
    documentId: row.document_id || null,
    recordedBy: row.recorded_by || null,
    createdAt: row.created_at,
  }
}

export async function fetchDocuments(params) {
  const res = await api.listDocuments(params)
  if (!res.ok) throw normalizeFailure(res)
  return (res.data || []).map(mapDocument)
}

export async function fetchMyDocuments() {
  const res = await api.myDocuments()
  if (!res.ok) throw normalizeFailure(res)
  return (res.data || []).map(mapDocument)
}

export async function fetchDocument(id) {
  const res = await api.getDocument(id)
  if (!res.ok) throw normalizeFailure(res)
  return mapDocument(res.data)
}

export async function submitDocumentUpload(formData, key) {
  const res = await api.uploadDocument(formData, key)
  if (!res.ok) throw normalizeFailure(res)
  return mapDocument(res.data)
}

export async function retractDocument(id, reason) {
  const res = await api.retractDocument(id, { reason })
  if (!res.ok) throw normalizeFailure(res)
  return mapDocument(res.data)
}

export async function fetchPatientConsents(patientId) {
  const res = await api.listPatientConsents(patientId)
  if (!res.ok) throw normalizeFailure(res)
  return (res.data || []).map(mapConsent)
}

export async function fetchMyConsents() {
  const res = await api.myConsents()
  if (!res.ok) throw normalizeFailure(res)
  return (res.data || []).map(mapConsent)
}

export async function grantConsent(patientId, payload) {
  const res = await api.grantPatientConsent(patientId, payload)
  if (!res.ok) throw normalizeFailure(res)
  return mapConsent(res.data)
}

export async function withdrawConsent(patientId, consentId) {
  const res = await api.withdrawPatientConsent(patientId, consentId)
  if (!res.ok) throw normalizeFailure(res)
  return mapConsent(res.data)
}

const DOWNLOAD_MESSAGES = {
  401: 'Your session has ended. Sign in again.',
  403: 'You do not have permission to download this document.',
  404: 'The stored file for this document could not be found. Contact the clinic.',
  409: 'The stored file does not match its record. Contact the clinic.',
  410: 'This document has been retracted and is no longer available for download.',
}

export async function downloadDocumentFile(id, filename, {patientId,checksum,mimeType,size,isCurrent=()=>true}={}) {
  if(!isCurrent())throw new Error('This document view is no longer current.')
  const baseUrl = api.apiBase()
  const url = `${baseUrl}/api/documents/${encodeURIComponent(id)}/download`
  let res
  try { res = await fetch(url, { credentials: 'include' }) } catch { throw new Error('Could not reach the clinic system. Check your connection and try again.') }
  if (!res.ok) throw new Error(DOWNLOAD_MESSAGES[res.status] || 'Could not download the document. Try again.')
  if(!isCurrent())throw new Error('This document view is no longer current.')
  if(patientId&&(res.headers.get('X-Document-Id')!==id||res.headers.get('X-Patient-Id')!==patientId||res.headers.get('Content-Type')?.split(';')[0]!==mimeType))throw new Error('The download did not confirm the selected document and Patient. No file was downloaded.')
  const blob = await res.blob()
  if(checksum){
    const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())
    const observed=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')
    if(observed!==checksum||blob.size!==size)throw new Error('The downloaded file did not match its record. No file was downloaded.')
  }
  if(!isCurrent())throw new Error('This document view is no longer current.')
  const blobUrl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename || 'document'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(blobUrl)
}
