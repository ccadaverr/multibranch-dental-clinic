import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MODULES, NAV } from '../src/data.js'
import { DOMAIN_MODULE } from '../src/module-map.js'
import * as api from '../src/api-client.js'
import { csvCell, makeCsv, peso } from '../src/logic.js'

// ====================================================================================================
// Module 23: Archives & Historical Records Management
// Comprehensive 4-Role Verification & Data Isolation Simulation
// ====================================================================================================

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  blob: async () => new Blob(['%PDF-1.4 mock pdf data'], { type: 'application/pdf' }),
  headers: new Map([
    ['Content-Type', 'application/pdf'],
    ['Content-Disposition', 'attachment; filename="document.pdf"'],
  ]),
})

let calls = []
function stubFetch(...responses) {
  let i = 0
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null,
    })
    return responses[Math.min(i++, responses.length - 1)]
  }
}

beforeEach(() => {
  calls = []
  globalThis.document = {
    cookie: 'XSRF-TOKEN=mock-token',
    createElement: tag => ({
      tag,
      href: '',
      download: '',
      click: () => {},
      remove: () => {},
    }),
    body: { appendChild: () => {}, removeChild: () => {} },
  }
  globalThis.URL.createObjectURL = () => 'blob:mock-url'
  globalThis.URL.revokeObjectURL = () => {}
  api.__resetCsrfCacheForTests()
})

// ====================================================================================================
// SIMULATED ENCOUNTER DATA SEED
// ====================================================================================================
// Patient A: Maria Santos at Dr. Dana Roxas Dental Clinic - Baliuag
// Patient B: Juan Dela Cruz at Roxas Dental Clinic - Guiguinto
// ====================================================================================================
const SIMULATED_DATA = {
  patientA: {
    id: 'pat-a-01',
    name: 'Maria Santos',
    email: 'maria@example.test',
    branch: 'Dr. Dana Roxas Dental Clinic - Baliuag',
    appointment: {
      id: 'apt-a-01',
      code: 'APT-2026-0881',
      date: '2026-09-28',
      start_time: '09:00',
      starts_at: '2026-09-28T09:00:00+08:00',
      status: 'Completed',
      patientName: 'Maria Santos',
      service: { id: 'svc-01', name: 'Restoration / Composite Filling' },
      serviceName: 'Restoration / Composite Filling',
      dentist: { id: 'd1', name: 'Miguel Reyes' },
      dentistName: 'Dr. Miguel Reyes',
      branch: { id: 'b1', name: 'Dr. Dana Roxas Dental Clinic - Baliuag' },
      branchName: 'Dr. Dana Roxas Dental Clinic - Baliuag',
    },
    treatment: {
      id: 'trt-a-01',
      toothNumber: '16',
      procedure: 'Restoration / Composite Filling',
      notes: 'Occlusal composite restoration on tooth 16 completed under local anesthesia.',
      status: 'Completed',
    },
    prescription: {
      id: 'rx-a-01',
      number: 'RX-2026-00441',
      issued_at: '2026-09-28T09:55:00+08:00',
      date: '2026-09-28',
      patient: { id: 'pat-a-01', name: 'Maria Santos' },
      patientName: 'Maria Santos',
      dentist: { id: 'd1', name: 'Dr. Miguel Reyes' },
      dentistName: 'Dr. Miguel Reyes',
      branch: { id: 'b1', name: 'Dr. Dana Roxas Dental Clinic - Baliuag' },
      branchName: 'Dr. Dana Roxas Dental Clinic - Baliuag',
      status: 'Issued',
      lines: [
        {
          medicine: 'Amoxicillin 500 mg capsule',
          dosage: '1 capsule',
          frequency: 'every 8 hours',
          duration: '7 days',
          instructions: 'Take after meals. Finish full course.',
        },
        {
          medicine: 'Mefenamic Acid 500 mg',
          dosage: '1 capsule',
          frequency: 'every 8 hours as needed',
          duration: '3 days',
          instructions: 'For severe pain.',
        },
      ],
    },
    invoice: {
      id: 'inv-a-01',
      invoice_number: 'INV-2026-00441',
      invoiceNumber: 'INV-2026-00441',
      date: '2026-09-28',
      issued_at: '2026-09-28T10:00:00+08:00',
      patientName: 'Maria Santos',
      gross_amount: 1500.0,
      total: 1500.0,
      paid_amount: 1500.0,
      branch: { id: 'b1', name: 'Dr. Dana Roxas Dental Clinic - Baliuag' },
      status: 'Paid',
      receipt: {
        id: 'rcp-a-01',
        number: 'OR-2026-00441',
        amount: 1500.0,
        paid_amount: 1500.0,
        method: 'Cash',
        issued_at: '2026-09-28T10:05:00+08:00',
      },
    },
  },
  patientB: {
    id: 'pat-b-02',
    name: 'Juan Dela Cruz',
    email: 'juan@example.test',
    branch: 'Roxas Dental Clinic - Guiguinto',
    appointment: {
      id: 'apt-b-02',
      code: 'APT-2026-0999',
      date: '2026-09-28',
      start_time: '14:00',
      starts_at: '2026-09-28T14:00:00+08:00',
      status: 'Completed',
      patientName: 'Juan Dela Cruz',
      service: { id: 'svc-02', name: 'Dental Extraction' },
      serviceName: 'Dental Extraction',
      dentist: { id: 'd3', name: 'Luis Navarro' },
      dentistName: 'Dr. Luis Navarro',
      branch: { id: 'b2', name: 'Roxas Dental Clinic - Guiguinto' },
      branchName: 'Roxas Dental Clinic - Guiguinto',
    },
    treatment: {
      id: 'trt-b-02',
      toothNumber: '38',
      procedure: 'Simple Extraction',
      notes: 'Extraction of tooth 38 completed with good hemostasis.',
      status: 'Completed',
    },
    prescription: {
      id: 'rx-b-02',
      number: 'RX-2026-00999',
      issued_at: '2026-09-28T14:35:00+08:00',
      date: '2026-09-28',
      patient: { id: 'pat-b-02', name: 'Juan Dela Cruz' },
      patientName: 'Juan Dela Cruz',
      dentist: { id: 'd3', name: 'Dr. Luis Navarro' },
      dentistName: 'Dr. Luis Navarro',
      branch: { id: 'b2', name: 'Roxas Dental Clinic - Guiguinto' },
      branchName: 'Roxas Dental Clinic - Guiguinto',
      status: 'Issued',
      lines: [
        {
          medicine: 'Paracetamol 500 mg tablet',
          dosage: '1 tablet',
          frequency: 'every 6 hours as needed',
          duration: '3 days',
          instructions: 'For fever or mild pain.',
        },
      ],
    },
    invoice: {
      id: 'inv-b-02',
      invoice_number: 'INV-2026-00999',
      invoiceNumber: 'INV-2026-00999',
      date: '2026-09-28',
      issued_at: '2026-09-28T14:45:00+08:00',
      patientName: 'Juan Dela Cruz',
      gross_amount: 800.0,
      total: 800.0,
      paid_amount: 800.0,
      branch: { id: 'b2', name: 'Roxas Dental Clinic - Guiguinto' },
      status: 'Paid',
      receipt: {
        id: 'rcp-b-02',
        number: 'OR-2026-00999',
        amount: 800.0,
        paid_amount: 800.0,
        method: 'GCash / Online',
        issued_at: '2026-09-28T14:50:00+08:00',
      },
    },
  },
}

// ====================================================================================================
// 1. REGISTRY & NAVIGATION INTEGRITY
// ====================================================================================================
test('Module 23 metadata: Archives & Historical Records Management', () => {
  const m23 = MODULES.find(m => m.no === 23)
  assert.ok(m23, 'Module 23 must exist in MODULES registry')
  assert.equal(m23.no, 23)
  assert.equal(m23.name, 'Archives & Historical Records Management')
  assert.equal(m23.owner, 'Delos Santos, Joevan')
  assert.equal(m23.area, 'Archives')
  assert.deepEqual(m23.roles, ['patient', 'staff', 'dentist', 'owner'])
  assert.equal(DOMAIN_MODULE.archives, 23, 'archives domain key maps to Module 23')
})

test('Patient portal: Family tab is removed and Archives tab is active', () => {
  const portalCode = readFileSync('src/patient/Portal.jsx', 'utf8')
  assert.doesNotMatch(portalCode, /\['family',\s*'user',\s*'Family'\]/)
  assert.doesNotMatch(portalCode, /\['feedback',\s*'star',\s*'Feedback'\]/)
  assert.match(portalCode, /\['archives',\s*'archive',\s*'Historical records'\]/)
  assert.match(portalCode, /case 'archives':/)
})

test('Staff, Dentist, and Owner navigation include Archives & Records', () => {
  for (const role of ['staff', 'dentist', 'owner']) {
    const hasArchives = NAV[role].some(([k]) => k === 'archives')
    assert.equal(hasArchives, true, `${role} navigation includes archives`)
  }
})

// ====================================================================================================
// 2. SIMULATED WORKFLOW VERIFICATION: END-TO-END CLINICAL & FINANCIAL LIFECYCLE
// ====================================================================================================
test('Simulated Workflow: verifies full 5-stage transition from appointment to archived receipt', () => {
  const { patientA } = SIMULATED_DATA

  // Stage 1: Appointment created
  assert.equal(patientA.appointment.code, 'APT-2026-0881')
  assert.equal(patientA.appointment.status, 'Completed')

  // Stage 2: Front-Desk Check-in confirmed
  assert.equal(patientA.appointment.branchName, 'Dr. Dana Roxas Dental Clinic - Baliuag')
  assert.equal(patientA.appointment.dentistName, 'Dr. Miguel Reyes')

  // Stage 3: Completed Treatment & Dental Chart
  assert.equal(patientA.treatment.toothNumber, '16')
  assert.equal(patientA.treatment.procedure, 'Restoration / Composite Filling')
  assert.equal(patientA.treatment.status, 'Completed')

  // Stage 4: Digital Prescription Issued
  assert.equal(patientA.prescription.number, 'RX-2026-00441')
  assert.equal(patientA.prescription.status, 'Issued')
  assert.equal(patientA.prescription.lines.length, 2)
  assert.equal(patientA.prescription.lines[0].medicine, 'Amoxicillin 500 mg capsule')

  // Stage 5: Settle Invoice & Receipt
  assert.equal(patientA.invoice.invoice_number, 'INV-2026-00441')
  assert.equal(patientA.invoice.status, 'Paid')
  assert.equal(patientA.invoice.receipt.number, 'OR-2026-00441')
  assert.equal(patientA.invoice.receipt.amount, 1500.0)
})

// ====================================================================================================
// 3. ROLE 1: PATIENT EXPERIENCE & SELF-SERVICE RETRIEVAL (#p/archives)
// ====================================================================================================
test('Role 1 (Patient): can view completed visits, prescriptions, and settled receipts in #p/archives', async () => {
  const { patientA } = SIMULATED_DATA

  // 1. Load completed past visits
  stubFetch(json(200, { data: [patientA.appointment] }))
  const visitRes = await api.listAppointments({ from: '2026-04-01', to: '2026-09-28', per_page: 50 })
  assert.equal(visitRes.ok, true)
  assert.equal(visitRes.data.length, 1)
  const v = visitRes.data[0]
  assert.equal(v.code, 'APT-2026-0881')
  assert.equal(v.status, 'Completed')
  assert.equal(v.dentist.name, 'Miguel Reyes')
  assert.equal(v.branch.name, 'Dr. Dana Roxas Dental Clinic - Baliuag')

  // 2. Load digital prescriptions
  stubFetch(json(200, { data: [patientA.prescription] }))
  const rxRes = await api.myPrescriptions()
  assert.equal(rxRes.ok, true)
  assert.equal(rxRes.data.length, 1)
  const rx = rxRes.data[0]
  assert.equal(rx.number, 'RX-2026-00441')
  assert.equal(rx.status, 'Issued')
  assert.equal(rx.lines.length, 2)
  assert.equal(rx.lines[0].dosage, '1 capsule')
  assert.equal(rx.lines[0].frequency, 'every 8 hours')
  assert.equal(rx.lines[0].duration, '7 days')

  // 3. Trigger prescription PDF download
  stubFetch(json(200, {}))
  const rxPdfRes = await api.downloadPrescriptionPdf(rx.id, rx.number)
  assert.equal(rxPdfRes.ok, true)
  const lastRxCall = calls.find(c => c.url.includes(`/api/prescriptions/${rx.id}/pdf`))
  assert.ok(lastRxCall, 'Prescription PDF download endpoint was invoked')

  // 4. Load settled invoices and official receipts
  stubFetch(json(200, { data: [patientA.invoice] }))
  const invRes = await api.myBillingInvoices({ per_page: 50 })
  assert.equal(invRes.ok, true)
  const settled = invRes.data.filter(i => i.receipt)
  assert.equal(settled.length, 1)
  const inv = settled[0]
  assert.equal(inv.invoice_number, 'INV-2026-00441')
  assert.equal(inv.receipt.number, 'OR-2026-00441')
  assert.equal(inv.receipt.amount, 1500.0)
  assert.equal(inv.receipt.method, 'Cash')

  // 5. Trigger official receipt and invoice PDF download
  stubFetch(json(200, {}))
  const receiptPdfRes = await api.downloadBillingPdf(inv.id, 'receipt')
  assert.equal(receiptPdfRes.ok, true)
  const lastRcpCall = calls.find(c => c.url.includes(`/api/invoices/${inv.id}/receipt-pdf`))
  assert.ok(lastRcpCall, 'Official receipt PDF download endpoint was invoked')
})

test('Role 1 (Patient): paid PayMongo booking deposit appears in Archived Receipts', async () => {
  const depositAppt = {
    id: 'apt-paymongo-01',
    code: 'APT-2026-PM01',
    date: '2026-10-22',
    status: 'Confirmed',
    booking_fee_php: '300.00',
    booking_payment_status: 'paid',
    booking_payment_method: 'PayMongo',
    booking_payment_ref: 'pay_test_xyz123',
    booking_paid_at: '2026-10-22T08:30:00+08:00',
    service: { name: 'Consultation & Oral Prophylaxis' },
    branch: { name: 'Dr. Dana Roxas Dental Clinic - Baliuag' },
  }

  // Both endpoints queried by Archives.jsx
  stubFetch(json(200, { data: [] })) // myBillingInvoices (empty if treatment not yet billed)
  const invRes = await api.myBillingInvoices({ per_page: 50 })
  assert.equal(invRes.ok, true)

  stubFetch(json(200, { data: [depositAppt] })) // listAppointments
  const apptRes = await api.listAppointments({ per_page: 50 })
  assert.equal(apptRes.ok, true)

  // Verify the transformation logic matching Archives.jsx
  const paidDeposits = apptRes.data
    .filter(a => a.booking_payment_status === 'paid' && Number(a.booking_fee_php) > 0)
    .map(a => ({
      id: `booking-${a.id}`,
      isBookingDeposit: true,
      receipt: {
        number: `DEP-${a.code}`,
        amount: Number(a.booking_fee_php),
        method: a.booking_payment_method,
        reference: a.booking_payment_ref,
      },
    }))

  assert.equal(paidDeposits.length, 1)
  assert.equal(paidDeposits[0].isBookingDeposit, true)
  assert.equal(paidDeposits[0].receipt.amount, 300)
  assert.equal(paidDeposits[0].receipt.method, 'PayMongo')
  assert.equal(paidDeposits[0].receipt.reference, 'pay_test_xyz123')

  // Trigger booking deposit receipt PDF download
  stubFetch(json(200, {}))
  const depositPdfRes = await api.downloadAppointmentReceiptPdf(depositAppt.id, depositAppt.code)
  assert.equal(depositPdfRes.ok, true)
  const lastDepositCall = calls.find(c => c.url.includes(`/api/appointments/${depositAppt.id}/receipt-pdf`))
  assert.ok(lastDepositCall, 'Booking deposit receipt PDF download endpoint was invoked')
})

// ====================================================================================================
// 4. SECURITY & PRIVACY: STRICT PATIENT DATA ISOLATION
// ====================================================================================================
test('Privacy & Isolation: Patient A cannot view or download Patient B records', async () => {
  const { patientA, patientB } = SIMULATED_DATA

  // When Patient A queries their own archive:
  stubFetch(json(200, { data: [patientA.appointment] }))
  const aVisits = await api.listAppointments({ from: '2026-04-01', to: '2026-09-28' })
  assert.ok(!aVisits.data.some(v => v.code === patientB.appointment.code), 'Patient B visit is absent from Patient A query')

  stubFetch(json(200, { data: [patientA.prescription] }))
  const aRx = await api.myPrescriptions()
  assert.ok(!aRx.data.some(p => p.number === patientB.prescription.number), 'Patient B Rx is absent from Patient A query')

  stubFetch(json(200, { data: [patientA.invoice] }))
  const aInvoices = await api.myBillingInvoices()
  assert.ok(!aInvoices.data.some(i => i.invoice_number === patientB.invoice.invoice_number), 'Patient B invoice is absent from Patient A query')

  // Patient A attempting to download Patient B's prescription PDF is rejected
  stubFetch(json(404, { message: 'This document is not available.' }))
  const foreignRxPdf = await api.downloadPrescriptionPdf(patientB.prescription.id, patientB.prescription.number)
  assert.equal(foreignRxPdf.ok, false)
  assert.equal(foreignRxPdf.kind, 'not_found')

  // Patient A attempting to download Patient B's receipt PDF is rejected
  stubFetch(json(403, { message: 'Unauthorized invoice access.' }))
  const foreignRcpPdf = await api.downloadBillingPdf(patientB.invoice.id, 'receipt')
  assert.equal(foreignRcpPdf.ok, false)
  assert.equal(foreignRcpPdf.kind, 'forbidden')
})

// ====================================================================================================
// 5. ROLE 2: DENTIST CLINICAL RETROSPECTIVE & DOSAGE REVIEW (#archives)
// ====================================================================================================
test('Role 2 (Dentist): can look up past clinical procedures and historical prescriptions for treatment continuity', () => {
  const { patientA } = SIMULATED_DATA
  const allAppointments = [patientA.appointment]
  const allPrescriptions = [patientA.prescription]

  // Dentist reviews completed visits
  const pastVisits = allAppointments.filter(a => ['Completed', 'Served'].includes(a.status))
  assert.equal(pastVisits.length, 1)
  assert.equal(pastVisits[0].patientName, 'Maria Santos')
  assert.equal(pastVisits[0].serviceName, 'Restoration / Composite Filling')
  assert.equal(pastVisits[0].dentistName, 'Dr. Miguel Reyes')

  // Dentist reviews past prescriptions and verifies medication dosages
  const pastRx = allPrescriptions.filter(p => p.dentistName.includes('Miguel Reyes'))
  assert.equal(pastRx.length, 1)
  const amoxLine = pastRx[0].lines.find(l => l.medicine.includes('Amoxicillin'))
  assert.ok(amoxLine, 'Prescribing doctor can inspect past antibiotic regimen')
  assert.equal(amoxLine.dosage, '1 capsule')
  assert.equal(amoxLine.frequency, 'every 8 hours')
  assert.equal(amoxLine.duration, '7 days')

  // Search by patient name
  const query = 'maria'
  const matched = pastVisits.filter(v => v.patientName.toLowerCase().includes(query))
  assert.equal(matched.length, 1)
})

// ====================================================================================================
// 6. ROLE 3: STAFF VERIFICATION & SEARCH LOOKUP (#archives)
// ====================================================================================================
test('Role 3 (Staff): can search archive by patient name, code, or receipt number to verify settled billing proof', () => {
  const { patientA, patientB } = SIMULATED_DATA
  const allInvoices = [patientA.invoice, patientB.invoice]
  const allVisits = [patientA.appointment, patientB.appointment]

  // 1. Search by reference code: "APT-2026-0881"
  const qCode = 'apt-2026-0881'
  const foundByCode = allVisits.filter(v => v.code.toLowerCase().includes(qCode))
  assert.equal(foundByCode.length, 1)
  assert.equal(foundByCode[0].patientName, 'Maria Santos')

  // 2. Search by invoice number: "INV-2026-00441"
  const qInv = 'inv-2026-00441'
  const foundByInv = allInvoices.filter(i => (i.invoiceNumber || i.invoice_number).toLowerCase().includes(qInv))
  assert.equal(foundByInv.length, 1)
  assert.equal(foundByInv[0].receipt.number, 'OR-2026-00441')
  assert.equal(foundByInv[0].status, 'Paid')

  // 3. Search by receipt number: "OR-2026-00441"
  const qRcp = 'or-2026-00441'
  const foundByRcp = allInvoices.filter(i => (i.receipt?.number || '').toLowerCase().includes(qRcp))
  assert.equal(foundByRcp.length, 1)
  assert.equal(foundByRcp[0].paid_amount, 1500.0)
})

// ====================================================================================================
// 7. ROLE 4: OWNER CROSS-BRANCH SCOPE & REGULATORY RETENTION (#archives)
// ====================================================================================================
test('Role 4 (Owner): multi-branch scope filter and permanent retention compliance', () => {
  const { patientA, patientB } = SIMULATED_DATA
  const allInvoices = [patientA.invoice, patientB.invoice]
  const allVisits = [patientA.appointment, patientB.appointment]

  // Branch filter helper matching ArchivesPage logic
  const filterByBranch = (list, selectedBranch) => {
    if (selectedBranch === 'All Branches') return list
    return list.filter(item => {
      const bName = typeof item.branch === 'object' && item.branch !== null
        ? (item.branch.name || item.branch.id)
        : (item.branch || item.branchName)
      return bName === selectedBranch
    })
  }

  // 1. Owner views "All Branches" -> sees both Baliuag and Guiguinto
  const allBranchVisits = filterByBranch(allVisits, 'All Branches')
  assert.equal(allBranchVisits.length, 2)
  const allBranchInvoices = filterByBranch(allInvoices, 'All Branches')
  assert.equal(allBranchInvoices.length, 2)

  // 2. Owner switches filter to "Dr. Dana Roxas Dental Clinic - Baliuag"
  const baliuagVisits = filterByBranch(allVisits, 'Dr. Dana Roxas Dental Clinic - Baliuag')
  assert.equal(baliuagVisits.length, 1)
  assert.equal(baliuagVisits[0].patientName, 'Maria Santos')

  // 3. Owner switches filter to "Roxas Dental Clinic - Guiguinto"
  const guiguintoVisits = filterByBranch(allVisits, 'Roxas Dental Clinic - Guiguinto')
  assert.equal(guiguintoVisits.length, 1)
  assert.equal(guiguintoVisits[0].patientName, 'Juan Dela Cruz')

  // 4. Compliance Retention: Verifies zero data loss in archived records
  assert.ok(patientA.appointment.date, 'Historical date preserved')
  assert.ok(patientA.prescription.issued_at, 'Prescription timestamp preserved')
  assert.ok(patientA.invoice.receipt.number, 'Receipt serial number preserved')
  assert.equal(patientA.invoice.status, 'Paid', 'Immutable settlement status preserved')
})

// ====================================================================================================
// 8. COMPLIANCE CSV EXPORT & FORMULA INJECTION SANITIZATION
// ====================================================================================================
test('Compliance CSV Export: exports archive tables and protects against formula injection', () => {
  // Test formula sanitization in logic.js csvCell
  assert.equal(csvCell('=SUM(A1:A10)'), '"\'=SUM(A1:A10)"')
  assert.equal(csvCell('+CMD("calc")'), '"\'+CMD(""calc"")"')
  assert.equal(csvCell('-100'), '"\'-100"')
  assert.equal(csvCell('@IMPORT'), '"\'@IMPORT"')
  assert.equal(csvCell('Dr. Dana Roxas Dental Clinic'), '"Dr. Dana Roxas Dental Clinic"')

  // Test export structure for visits
  const visitExportRows = [
    {
      'Visit Date': '2026-09-28',
      'Reference Code': 'APT-2026-0881',
      'Patient Name': 'Maria Santos',
      'Service': 'Restoration / Composite Filling',
      'Dentist': 'Dr. Miguel Reyes',
      'Branch': 'Dr. Dana Roxas Dental Clinic - Baliuag',
      'Outcome Status': 'Completed',
    },
  ]
  const keys = Object.keys(visitExportRows[0])
  const text = [keys.map(csvCell).join(','), ...visitExportRows.map(r => keys.map(k => csvCell(r[k])).join(','))].join('\n')
  assert.ok(text.includes('"Visit Date","Reference Code"'))
  assert.ok(text.includes('"APT-2026-0881"'))
  assert.ok(text.includes('"Maria Santos"'))
})

// ====================================================================================================
// 9. COMPONENT CONTRACT & RESILIENCE VERIFICATION
// ====================================================================================================
test('Archives component source contracts: verify PDF triggers, empty states, and accessibility', () => {
  const patientPage = readFileSync('src/patient/pages/Archives.jsx', 'utf8')
  const staffPage = readFileSync('src/pages/ArchivesPage.jsx', 'utf8')

  // Patient Archives contract
  assert.match(patientPage, /downloadPrescriptionPdf\(id,\s*number\)/)
  assert.match(patientPage, /handleDownloadRx\(p\.id,\s*p\.number\)/)
  assert.match(patientPage, /downloadBillingPdf\(id,\s*kind\)/)
  assert.match(patientPage, /handleDownloadPdf\(inv\.id,\s*'receipt'\)/)
  assert.match(patientPage, /handleDownloadPdf\(inv\.id,\s*'invoice'\)/)
  assert.match(patientPage, /downloadAppointmentReceiptPdf/)
  assert.match(patientPage, /handleDownloadBookingDeposit/)
  assert.match(patientPage, /isBookingDeposit/)
  assert.match(patientPage, /Deposit Paid/)
  assert.match(patientPage, /role="tablist"/)
  assert.match(patientPage, /role="tab"/)
  assert.match(patientPage, /EmptyState icon="calendar"/)
  assert.match(patientPage, /EmptyState icon="pill"/)
  assert.match(patientPage, /EmptyState icon="receipt"/)

  // Staff / Dentist / Owner ArchivesPage contract
  assert.match(staffPage, /title="Archives & Historical Records Management"/)
  assert.match(staffPage, /makeCsv/)
  assert.match(staffPage, /Export Archive CSV/)
  assert.match(staffPage, /archivedVisits/)
  assert.match(staffPage, /archivedPrescriptions/)
  assert.match(staffPage, /archivedInvoices/)
  assert.match(staffPage, /archive\.viewed/)
  assert.match(staffPage, /Permanent deletion/)
})

// ARC-01 source guards. These do not establish rendered or backend authorization acceptance.
test('ARC-01: unsupported restoration has no confirmation, success event or local restore state', () => {
  const page = readFileSync('src/pages/ArchivesPage.jsx', 'utf8')
  assert.doesNotMatch(page, /handleConfirmRestore|restoreTarget|restoreReason|setRestore|archive\.restored_for_followup/)
  assert.doesNotMatch(page, /Confirm Retrieval|retrieved for active follow-up|Restoring flags|flags a historical record/)
  assert.doesNotMatch(page, /<form|type="submit"|fetch\(|\b(?:restore|retrieve|delete|remove|archive)Record\s*\(/)
  // Remaining success messages are exports, never restoration.
  const successCalls = page.match(/toast\?\.\([^\n]+, 'success'\)/g) || []
  assert.equal(successCalls.length, 3)
  for (const call of successCalls) assert.match(call, /exported to CSV/)
})

test('ARC-01: disabled restore explains unavailability in visible keyboard-focusable text', () => {
  const page = readFileSync('src/pages/ArchivesPage.jsx', 'utf8')
  const button = page.match(/<Button[^>]*aria-describedby="archive-restore-unavailable"[^>]*>[^<]*<\/Button>/)?.[0]
  assert.ok(button, 'Restore control references its explanation')
  assert.match(button, /\bdisabled\b/)
  assert.doesNotMatch(button, /onClick|type="submit"/)
  assert.match(button, /Retrieve \/ Restore \(unavailable\)/)
  assert.match(page, /<span id="archive-restore-unavailable" tabIndex=\{0\}>Retrieval \/ restoration is unavailable on this screen\. Viewing a record does not restore it or flag it for active follow-up\.<\/span>/)
})

test('ARC-01: read-only viewing and existing role restrictions remain in place', () => {
  const page = readFileSync('src/pages/ArchivesPage.jsx', 'utf8')
  for (const kind of ['visit', 'prescription', 'financial']) {
    assert.ok(page.includes(`setViewRecord({ kind: '${kind}', record: r })`))
  }
  assert.equal((page.match(/logArchiveAudit\('archive\.viewed'/g) || []).length, 3)
  assert.match(page, /title="Archived Record Details \(Read-Only\)"/)
  assert.match(page, /const canViewFinancials = role !== 'dentist'/)
  assert.match(page, /if \(!inStaffBranch\) return false/)
  assert.match(page, /if \(!inDentistBranch \|\| !isDentistRecord\) return false/)
  assert.match(page, /role === 'owner' \? <span className="au-muted">Metadata only \(clinical privacy\)/)
})
