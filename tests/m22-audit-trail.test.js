import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as data from '../src/data.js'
import { normalizeClinicState, sessionForRole } from '../src/contracts.js'
import { mapAuditLog } from '../src/audit-api.js'
import { canAccessPage } from '../src/safeguards.js'

const api = fs.readFileSync('src/api-client.js', 'utf8')
const auditPage = fs.readFileSync('src/pages/AuditTrail.jsx', 'utf8')
const safeguards = fs.readFileSync('src/safeguards.js', 'utf8')
const dataContent = fs.readFileSync('src/data.js', 'utf8')

test('M22 api-client exports audit log endpoints', () => {
  assert.match(api, /export function listAuditLogs/)
  assert.match(api, /export function getAuditLog/)
})

test('mapAuditLog normalizes server audit resource into presentation shape', () => {
  const row = {
    id: '01k9aud1234567890abcdef',
    action: 'document.uploaded',
    category: 'administrative',
    severity: 'info',
    actor: { id: '01k9usr123', name: 'Alyssa Cruz', role: 'staff' },
    branch: { id: '01k9br123', name: 'Dr. Dana Roxas Dental Clinic' },
    auditable_type: 'Document',
    auditable_id: '01k9doc456',
    ip_address: '192.168.1.50',
    user_agent: 'Mozilla/5.0...',
    payload: { title: 'Consent Form', category: 'consent_document' },
    created_at: '2026-10-07T14:30:00+08:00',
  }

  const mapped = mapAuditLog(row)
  assert.equal(mapped.id, '01k9aud1234567890abcdef')
  assert.equal(mapped.action, 'document.uploaded')
  assert.equal(mapped.category, 'administrative')
  assert.equal(mapped.severity, 'info')
  assert.equal(mapped.actor.name, 'Alyssa Cruz')
  assert.equal(mapped.branch.name, 'Dr. Dana Roxas Dental Clinic')
  assert.equal(mapped.auditableType, 'Document')
  assert.equal(mapped.ipAddress, '192.168.1.50')
  assert.equal(mapped.payload.title, 'Consent Form')
})

test('Owner navigation includes Audit Trail and safeguards restrict to owner', () => {
  assert.match(dataContent, /\['audit','Audit Trail'\]/)
  assert.match(safeguards, /owner:\[.*'audit'.*\]/)

  const state = normalizeClinicState({
    persons: data.INITIAL_PERSONS,
    users: data.INITIAL_USERS,
    branches: data.INITIAL_BRANCHES,
    staff: data.INITIAL_STAFF,
    dentists: data.INITIAL_DENTISTS,
    patients: data.INITIAL_PATIENTS,
    appointments: [], visits: [], queue: [], treatments: [], invoices: [], prescriptions: [], followups: [], hmo: [],
  })

  const ownerSession = sessionForRole('owner', state)
  const staffSession = sessionForRole('staff', state)
  const patientSession = sessionForRole('patient', state)

  assert.equal(canAccessPage(state, ownerSession, 'audit'), true)
  assert.equal(canAccessPage(state, staffSession, 'audit'), false)
  assert.equal(canAccessPage(state, patientSession, 'audit'), false)
})

test('AuditTrail.jsx provides forensic filtering, inspection modal, and CSV export', () => {
  assert.match(auditPage, /Audit Event Filters/)
  assert.match(auditPage, /fetchAuditLogs/)
  assert.match(auditPage, /requestAuditLogsCsv/)
  assert.match(auditPage, /await me\(options\)/)
  assert.match(auditPage, /saveClinicCsv\(result\)/)
  assert.match(auditPage, /Export Audit Trail \(CSV\)/)
  assert.match(auditPage, /Audit Event Inspection/)
  assert.match(auditPage, /Event Payload \(Sanitized\)/)
})
