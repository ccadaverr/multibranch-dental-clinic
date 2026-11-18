import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, FilterBar, Modal, Notice, PageHeader, Status, Table, Tabs } from '../components.jsx'
import { makeCsv, peso } from '../logic.js'
import { clinicDate } from '../clock.js'
import { inScope } from '../contracts.js'
import { canAccessPage, permitted } from '../safeguards.js'
import { readPrescriptionPage } from '../prescription-list.js'
import { downloadAppointmentReceiptPdf, downloadBillingPdf, listBillingInvoices, listPrescriptions } from '../api-client.js'
import { loadInvoiceHistory, readOwnedArchive } from '../patient/archive-readback.js'
import './owner-record-workspace.css'

const branchIdOf = item => {
  const nested = typeof item.branch === 'object' && item.branch !== null ? item.branch.id : null
  return nested && item.branchId && nested !== item.branchId ? null : nested || item.branchId || null
}
const patientIdOf = item => item.patientId || item.patientPublicId || item.patient?.id || null
const receiptReference = record => record.receiptNumber || record.receipt?.number
const archiveReference = (kind, record) => ({
  visit: record.code,
  prescription: record.number,
  financial: record.invoiceNumber || record.invoice_number || receiptReference(record),
}[kind] || record.id)
const archiveType = { visit: 'Appointment', prescription: 'Prescription', financial: 'Invoice / receipt' }
const archivePatientName = record => {
  const name = record.patientName || (typeof record.patient === 'object' ? record.patient?.name : record.patient)
  return typeof name === 'string' ? name : ''
}
const archivePatient = record => archivePatientName(record) || 'Patient'
const archiveDate = record => record.issued_at || record.date
const manilaIssuedDate = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
})

function archiveDateDisplay(value) {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value || 'Date unavailable'
  const instant = new Date(value)
  return Number.isFinite(instant.getTime()) ? manilaIssuedDate.format(instant) : 'Date unavailable'
}

async function readArchiveInvoices(guard, branch, scopes) {
  const result = await loadInvoiceHistory(guard(async params => {
    const page = await listBillingInvoices({ ...params, status: 'Paid', branch_id: branch || undefined })
    if (!page.ok) return page
    if (!page.meta || !Object.hasOwn(page.meta, 'next_cursor') || !Array.isArray(page.data) || page.data.some(row =>
      row?.status !== 'Paid' || !row.id || !row.invoice_number || !row.patient?.id || !row.branch?.id
      || (branch && row.branch.id !== branch) || (scopes && !scopes.includes(row.branch.id)))) return { ok: false }
    return page
  }))
  return result.ok ? { ok: true, data: result.data.map(row => ({
    id: row.id, status: row.status, invoiceNumber: row.invoice_number, receiptNumber: row.receipt?.number, receiptId: row.receipt?.id,
    bookingCredit: row.booking_credit, patientId: row.patient.id, patientName: row.patient.name, branchId: row.branch.id,
    issued_at: row.issued_at, gross_amount: row.gross_amount, paid_amount: row.paid_amount,
  })) } : result
}

async function readStaffArchivePrescriptions(guard, branch, scopes) {
  const read = guard(listPrescriptions)
  const seen = new Set()
  const rows = []
  let total
  for (let page = 1; ; page++) {
    const result = await readPrescriptionPage(read, { page, per_page: 100 }, 'staff')
    if (!result.ok) return result
    total ??= result.meta.total
    if (total !== result.meta.total || result.data.some(row => seen.has(row.id) || !scopes.includes(row.branch_id))) {
      return { ok: false }
    }
    for (const row of result.data) {
      seen.add(row.id)
      if (!branch || row.branch_id === branch) rows.push({
        id: row.id, number: row.number, status: row.status, date: row.date, issued_at: row.issued_at,
        branchId: row.branch_id, patientId: row.patient.id, patientName: row.patient.name, dentistName: row.dentist,
      })
    }
    if (page === result.meta.last_page) return { ok: true, data: rows }
  }
}

function useArchiveRead(enabled, branch, scopes, load) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  const scope = JSON.stringify([branch, scopes, attempt])
  useEffect(() => {
    if (!enabled) return
    let live = true
    setResult(null)
    const [, allowed] = JSON.parse(scope)
    readOwnedArchive(guard => load(guard, branch, allowed), () => live).then(response => {
      if (live) setResult({ scope, response })
    })
    return () => { live = false }
  }, [enabled, branch, scope, load])
  const current = enabled && result?.scope === scope ? result.response : null
  const denied = current?.kind === 'forbidden' || current?.kind === 'unauthenticated'
  return {
    rows: current?.ok ? current.data : undefined,
    pending: enabled && !current,
    denied,
    failed: !!current && !current.ok && !denied,
    retry: () => setAttempt(value => value + 1),
  }
}

export function ArchivesPage({ store, role: propRole, activeBranch = 'All Branches' }) {
  const { state } = store
  const role = propRole || store.session?.role || 'owner'
  const session = store.session
  const account = state.users?.find(user => user.id === session?.userId)
  const scopes = Array.isArray(session?.branchScopes) ? [...new Set(session.branchScopes)].sort()
    : !session?.serverUserId && session?.branchId ? [session.branchId] : []
  const enabled = role === session?.role && ['staff', 'dentist', 'owner'].includes(role) && canAccessPage(state, session, 'archives')
  // A keyed lifetime discards old selections, filters and event handlers on identity,
  // permission or scope replacement, including A→B→A. Names never grant Staff access.
  const accessKey = JSON.stringify([session?.serverUserId, session?.userId, role, session?.active, session?.branchId,
    scopes, session?.dentistId, activeBranch, store.getAuthGeneration?.(), account?.accountStatus || account?.status, [...(account?.permissions || [])].sort(), enabled])
  return <ArchiveLifetime key={accessKey} store={store} role={role} session={session} scopes={scopes} enabled={enabled} activeBranch={activeBranch}/>
}

function ArchiveLifetime({ store, role, session, scopes, enabled, activeBranch }) {
  const { state, actions, toast } = store
  const live = useRef(false)
  const layoutEffect = typeof window === 'undefined' ? useEffect : React.useLayoutEffect
  layoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [browseTab, setBrowseTab] = useState('visits')
  const [searchTab, setSearchTab] = useState('matches')
  const [query, setQuery] = useState('')
  const ownerSearch = role === 'owner' && !!query.trim()
  const tab = ownerSearch ? searchTab : browseTab
  const updateQuery = value => {
    if (role === 'owner' && value.trim().toLowerCase() !== query.trim().toLowerCase()) setSearchTab('matches')
    setQuery(value)
  }
  const archiveResults = useRef(null)
  const retryPending = useRef(false)
  const [retrying, setRetrying] = useState(false)
  const [retryFailed, setRetryFailed] = useState(false)
  const appointmentsLoading = retrying || !retryFailed && ['idle', 'loading'].includes(store.appointmentsStatus)
  const appointmentsFailed = !appointmentsLoading && (retryFailed || store.appointmentsStatus === 'error')
  useEffect(() => { setRetryFailed(false) }, [store.appointmentsStatus])
  const [selectedBranch, setSelectedBranch] = useState()
  const [recordSelection, setRecordSelection] = useState(null)
  const [documentError, setDocumentError] = useState('')
  const documentSelection = useRef(null)
  const setViewRecord = selection => {
    setDocumentError('')
    setRecordSelection(selection ? {
    ...selection, id: selection.record.id, patientId: patientIdOf(selection.record), branchId: branchIdOf(selection.record),
    } : null)
  }
  const noStaffScope = role === 'staff' && scopes.length === 0
  const retryAppointments = async () => {
    if (!live.current || !enabled || noStaffScope || retryPending.current || typeof store.appointmentFlow?.refresh !== 'function') return
    retryPending.current = true
    setRetrying(true)
    setRetryFailed(false)
    try {
      const result = await store.appointmentFlow.refresh()
      if (live.current && !result?.superseded) setRetryFailed(result?.ok === false)
    } catch {
      if (live.current) setRetryFailed(true)
    } finally {
      retryPending.current = false
      if (live.current) setRetrying(false)
    }
  }
  const allBranches = state.branches || []
  const displayBranch = branch => allBranches.some(other => other.id !== branch.id && other.name === branch.name)
    ? `${branch.name} (${branch.branchCode || branch.id})`
    : branch.name
  const branchLabel = item => {
    const canonical = allBranches.find(branch => branch.id === branchIdOf(item))
    if (canonical) return displayBranch(canonical)
    return (typeof item.branch === 'object' && item.branch ? item.branch.name : item.branch || item.branchName) || 'Branch unavailable'
  }

  const branches = useMemo(() => {
    if (role === 'staff') return allBranches.filter(branch => scopes.includes(branch.id))
    if (role === 'dentist') {
      const dentist = state.dentists?.find(d => d.id === session?.dentistId || d.userId === session?.userId)
      const assigned = dentist?.branchIds
      if (Array.isArray(assigned)) return allBranches.filter(branch => assigned.includes(branch.id))
      return allBranches.filter(branch => dentist?.branches?.includes(branch.name)
        && allBranches.filter(other => other.name === branch.name).length === 1)
    }
    return allBranches
  }, [allBranches, state.dentists, role, session, scopes])

  const canSelectAll = role === 'owner' || branches.length > 1
    || (role === 'staff' && branches.length === 0 && scopes.length > 0)
  const defaultBranch = canSelectAll ? '' : branches[0]?.id ?? null
  const namedBranch = activeBranch && activeBranch !== 'All Branches'
  const startingMatches = namedBranch ? allBranches.filter(branch => branch.name === activeBranch) : []
  const requestedBranch = selectedBranch !== undefined ? selectedBranch
    : namedBranch ? (startingMatches.length === 1 ? startingMatches[0].id : null) : defaultBranch
  const effectiveBranch = (requestedBranch === '' && canSelectAll) || branches.some(branch => branch.id === requestedBranch)
    ? requestedBranch : null
  const branchUnavailable = effectiveBranch === null
  const exportBranch = branches.find(branch => branch.id === effectiveBranch)
  const canViewFinancials = role !== 'dentist' && enabled && (role === 'owner' || role === 'staff' && permitted(state, session, 'billing'))
  const usesStaffServer = role === 'staff' && !!session?.serverUserId
  const usesServerInvoices = usesStaffServer || role === 'owner' && !!session?.serverUserId
  const canReadBranch = enabled && !noStaffScope && !branchUnavailable
  const serverInvoices = useArchiveRead(usesServerInvoices && canViewFinancials && canReadBranch,
    effectiveBranch, usesStaffServer ? scopes : null, readArchiveInvoices)
  const serverPrescriptions = useArchiveRead(usesStaffServer && canReadBranch, effectiveBranch, scopes, readStaffArchivePrescriptions)
  const invoiceRows = usesServerInvoices ? serverInvoices.rows : state.invoices
  const prescriptionRows = usesStaffServer ? serverPrescriptions.rows : state.prescriptions

  // Names are presentation data. Both role scope and the selected branch are matched by stable ID.
  const branchAndRoleFilter = item => {
    if (!enabled || noStaffScope || branchUnavailable) return false
    const id = branchIdOf(item)
    if (role === 'staff') {
      const inStaffBranch = !!id && scopes.includes(id)
      if (!inStaffBranch) return false
    } else if (role === 'dentist') {
      const inDentistBranch = branches.some(branch => branch.id === id)
      const isDentistRecord = (item.dentistId && item.dentistId === session?.dentistId) || (item.dentist_id && item.dentist_id === session?.dentistId) || (item.dentist && (item.dentist.id === session?.dentistId || item.dentist === session?.dentistId)) || inScope(item, session, state)
      if (!inDentistBranch || !isDentistRecord) return false
    }
    return effectiveBranch === '' || id === effectiveBranch
  }

  // 1. Historical appointments: preserve the existing past-or-terminal eligibility.
  const archivedVisits = useMemo(() => {
    const list = (state.appointments || []).filter(a => {
      const isPastOrDone = ['Completed', 'Served', 'Cancelled', 'No-Show'].includes(a.status) || a.date <= clinicDate()
      return isPastOrDone && branchAndRoleFilter(a)
    })
    if (!query.trim()) return list
    const q = (role === 'owner' ? query.trim() : query).toLowerCase()
    return list.filter(a =>
      (role === 'owner' ? archivePatientName(a) : (a.patientName || '')).toLowerCase().includes(q) ||
      (a.serviceName || a.service?.name || (typeof a.service === 'string' ? a.service : '')).toLowerCase().includes(q) ||
      (a.dentistName || a.dentist?.name || '').toLowerCase().includes(q) ||
      (a.code || '').toLowerCase().includes(q)
    )
  }, [state.appointments, effectiveBranch, query, role, branches, enabled])

  // 2. Archived prescriptions
  const archivedPrescriptions = useMemo(() => {
    const list = (prescriptionRows || []).filter(branchAndRoleFilter)
    if (!query.trim()) return list
    const q = (role === 'owner' ? query.trim() : query).toLowerCase()
    return list.filter(p =>
      (p.number || '').toLowerCase().includes(q) ||
      (role === 'owner' ? archivePatientName(p) : (p.patientName || '')).toLowerCase().includes(q) ||
      (p.dentistName || '').toLowerCase().includes(q)
    )
  }, [prescriptionRows, effectiveBranch, query, role, branches, enabled])

  // 3. Archived receipts / settled invoices
  const archivedInvoices = useMemo(() => {
    if (!canViewFinancials) return []
    const list = (invoiceRows || []).filter(i => {
      const isSettled = ['Paid', 'Closed', 'Archived'].includes(i.status)
      return isSettled && branchAndRoleFilter(i)
    })
    if (!query.trim()) return list
    const q = (role === 'owner' ? query.trim() : query).toLowerCase()
    return list.filter(i =>
      (i.invoiceNumber || i.invoice_number || '').toLowerCase().includes(q) ||
      (role === 'owner' ? archivePatientName(i) : (i.patientName || '')).toLowerCase().includes(q) ||
      (receiptReference(i) || '').toLowerCase().includes(q) || (i.bookingCredit?.receipt_number || '').toLowerCase().includes(q)
    )
  }, [invoiceRows, effectiveBranch, query, canViewFinancials, role, branches])

  // Resolve details from the CURRENT authorized projection, never the stored object.
  // A branch or patient identity change invalidates the existing detail selection.
  const detailRows = recordSelection?.kind === 'visit' ? archivedVisits
    : recordSelection?.kind === 'prescription' ? archivedPrescriptions : canViewFinancials ? archivedInvoices : []
  const currentRecord = recordSelection && detailRows.find(record =>
    record.id === recordSelection.id && branchIdOf(record) === recordSelection.branchId &&
    (recordSelection.branchId || record === recordSelection.record) &&
    (patientIdOf(record) ? patientIdOf(record) === recordSelection.patientId : !recordSelection.patientId && record === recordSelection.record))
  const viewRecord = currentRecord ? { kind: recordSelection.kind, record: currentRecord } : null
  useEffect(() => { if (recordSelection && !currentRecord) setViewRecord(null) }, [recordSelection, currentRecord])
  documentSelection.current = viewRecord?.kind === 'financial' ? viewRecord.record : null
  const downloadArchivedReceipt = async (record, booking = false) => {
    const isCurrent = () => live.current && documentSelection.current === record
      && store.getAuthGeneration?.() === downloadAuth
    const downloadAuth = store.getAuthGeneration?.()
    setDocumentError('')
    try {
      const result = booking
        ? await downloadAppointmentReceiptPdf(record.bookingCredit.appointment_id, null, { isCurrent })
        : await downloadBillingPdf(record.id, 'receipt', { receiptId: record.receiptId, patientId: record.patientId, isCurrent })
      if (isCurrent() && !result.ok) setDocumentError(result.message || 'The selected receipt could not be opened.')
    } catch {
      if (isCurrent()) setDocumentError('The selected receipt could not be opened.')
    }
  }
  const recordsForTab = tab === 'visits' ? archivedVisits : tab === 'prescriptions' ? archivedPrescriptions : tab === 'financials' ? archivedInvoices : []
  const emptyMessage = (collection, label) => !Array.isArray(collection) ? `${label} are unavailable in this view.`
    : query.trim() || collection.length > 0 ? `No matching ${label.toLowerCase()} in the current scope.`
      : `No ${label.toLowerCase()} are available in this archive view.`

  const logArchiveAudit = (actionName, targetId, detail) => {
    actions?.logAudit?.({
      action: actionName,
      module: 'Archives & Records',
      targetId: targetId || 'archive',
      detail,
    })
  }

  const logArchiveView = (kind, record) => {
    const reference = role !== 'owner' && kind === 'financial' ? (record.invoiceNumber || record.id) : archiveReference(kind, record)
    const description = kind === 'financial' ? 'financial record' : kind === 'visit' ? 'visit' : 'prescription'
    logArchiveAudit('archive.viewed', reference, `Viewed archived ${description} ${reference}`)
  }

  const handleExportCsv = () => {
    if (!live.current || !enabled || noStaffScope || branchUnavailable || !recordsForTab.length) return
    const scopeSlug = (exportBranch?.id || 'all-branches').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const scopeLabel = exportBranch ? displayBranch(exportBranch) : 'All Branches'
    if (tab === 'visits') {
      const rows = archivedVisits.map(v => ({
        'Visit Date': v.date || '',
        'Reference Code': v.code || v.id || '',
        'Patient Name': v.patientName || v.patient?.name || 'Patient',
        'Service': v.serviceName || v.service?.name || v.service || 'Service unavailable',
        'Dentist': v.dentistName || v.dentist?.name || '',
        'Branch': branchLabel(v),
        'Outcome Status': v.status || 'Status unavailable',
      }))
      makeCsv(`archives-historical-appointments-${scopeSlug}.csv`, rows)
      logArchiveAudit('archive.exported', `visits:${scopeSlug}`, `Exported ${rows.length} archived visit(s) for ${scopeLabel}`)
      toast?.('Historical appointments exported to CSV.', 'success')
    } else if (tab === 'prescriptions') {
      const rows = archivedPrescriptions.map(p => ({
        'Rx Number': p.number || '',
        'Issued Date': p.issued_at || p.date || '',
        'Patient Name': p.patientName || (typeof p.patient === 'object' ? p.patient?.name : p.patient) || '',
        'Prescribing Doctor': p.dentistName || (typeof p.dentist === 'object' ? p.dentist?.name : p.dentist) || '',
        'Branch': branchLabel(p),
        'Medicines': role === 'owner'
          ? 'Protected clinical details (Dentist/Staff/Patient only)'
          : (p.lines || []).map(l => `${l.medicine || ''} (${[l.dosage, l.frequency, l.duration].filter(Boolean).join(', ')})`).join('; '),
        'Status': p.status || 'Issued',
      }))
      makeCsv(`archives-prescriptions-${scopeSlug}.csv`, rows)
      logArchiveAudit('archive.exported', `prescriptions:${scopeSlug}`, `Exported ${rows.length} archived prescription(s) for ${scopeLabel}`)
      toast?.('Archived prescriptions exported to CSV.', 'success')
    } else if (tab === 'financials' && canViewFinancials) {
      const rows = archivedInvoices.map(i => ({
        'Invoice Number': i.invoiceNumber || i.invoice_number || i.id || '',
        'Receipt Number': i.receiptNumber || i.receipt?.number || '',
        'Booking Receipt': i.bookingCredit?.receipt_number || '',
        'Patient Name': i.patientName || '',
        'Issued Date': i.issued_at || i.date || '',
        'Gross Amount': i.gross_amount || i.total || 0,
        'Paid Amount': i.paid_amount || i.total || 0,
        'Branch': branchLabel(i),
        'Settlement Status': i.status || 'Paid',
      }))
      makeCsv(`archives-financial-receipts-${scopeSlug}.csv`, rows)
      logArchiveAudit('archive.exported', `financials:${scopeSlug}`, `Exported ${rows.length} archived financial record(s) for ${scopeLabel}`)
      toast?.('Settled financial records exported to CSV.', 'success')
    }
  }

  const searchMatches = ownerSearch ? [
    ...archivedVisits.map(record => ({ kind: 'visit', record })),
    ...archivedPrescriptions.map(record => ({ kind: 'prescription', record })),
    ...archivedInvoices.map(record => ({ kind: 'financial', record })),
  ].map(match => ({ ...match, id: `${match.kind}:${match.record.id}:${branchIdOf(match.record)}` })) : []
  const financialReadIncomplete = serverInvoices.pending || serverInvoices.failed || serverInvoices.denied
  const prescriptionReadIncomplete = serverPrescriptions.pending || serverPrescriptions.failed || serverPrescriptions.denied
  const availableTabs = [
    ...(ownerSearch ? [{ key: 'matches', label: financialReadIncomplete ? 'Available matches' : `All matches (${searchMatches.length})` }] : []),
    { key: 'visits', label: `Historical Appointments (${archivedVisits.length})` },
    { key: 'prescriptions', label: prescriptionReadIncomplete ? 'Prescriptions' : `Prescriptions (${archivedPrescriptions.length})` },
    ...(canViewFinancials ? [{ key: 'financials', label: financialReadIncomplete
      ? 'Settled Invoices & Receipts' : `Settled Invoices & Receipts (${archivedInvoices.length})` }] : []),
  ]
  const financialStatus = serverInvoices.pending ? <p role="status">Loading settled financial records…</p>
    : serverInvoices.denied ? <Notice tone="warning">You no longer have access to these financial records.</Notice>
    : serverInvoices.failed ? <Notice tone="warning" title="Settled financial records unavailable">
      <Button variant="soft" onClick={() => {
        archiveResults.current?.focus()
        serverInvoices.retry()
      }}>Retry financial records</Button>
    </Notice> : null

  const prescriptionStatus = serverPrescriptions.pending ? <p role="status">Loading archived prescriptions…</p>
    : serverPrescriptions.denied ? <Notice tone="warning">You no longer have access to these prescriptions.</Notice>
    : serverPrescriptions.failed ? <Notice tone="warning" title="Archived prescriptions unavailable">
      <Button variant="soft" onClick={() => {
        archiveResults.current?.focus()
        serverPrescriptions.retry()
      }}>Retry archived prescriptions</Button>
    </Notice> : null

  return (
    <div className={role === 'owner' ? 'archives-page owner-record-workspace' : 'archives-page'} aria-label="Archives and Historical Records">
      {role === 'owner' ? <PageHeader title="Archives & Records" text="Search read-only clinic records by branch."/> : <PageHeader
        kicker="Compliance & Record Retention"
        title="Archives & Historical Records Management"
        text="Role- and branch-scoped history of past or terminal appointments, prescriptions, and settled financial records."
      />}

      {role === 'owner' ? <p className="muted-copy owner-archive-access">Read-only. Restoration is unavailable.</p> : <Notice tone="info" title="History viewing and restoration availability">
        <b>Viewing</b> inspects historical records read-only within your role and branch scope.
        <br/><span id="archive-restore-unavailable" tabIndex={0}>Retrieval / restoration is unavailable on this screen. Viewing a record does not restore it or flag it for active follow-up.</span><br/>
        <b>Permanent deletion</b> is not available on this screen.
      </Notice>}

      {!enabled || noStaffScope ? <Notice tone="warning" title={noStaffScope && enabled ? 'No authorized archive branches' : 'Archive access unavailable'}>
        {noStaffScope && enabled ? 'This account has no authorized branches for archive viewing or export.' : 'These records are unavailable to the current account.'}
      </Notice> : <>

      <FilterBar
        search={query}
        onSearchChange={updateQuery}
        searchPlaceholder={role === 'owner' ? 'Patient, appointment, prescription or receipt reference…' : 'Search by patient, code, number, dentist…'}
        onClear={(query || effectiveBranch !== defaultBranch) ? () => {
          updateQuery('')
          setSelectedBranch(defaultBranch)
        } : null}
      >
        <select
          className="filter-select"
          aria-label="Filter archive by branch"
          value={effectiveBranch ?? '__unresolved__'}
          disabled={!branches.length || (!branchUnavailable && !canSelectAll)}
          onChange={e => setSelectedBranch(e.target.value)}
        >
          {branchUnavailable && <option value="__unresolved__" disabled>Choose an available branch</option>}
          {canSelectAll && <option value="">All Branches</option>}
          {branches.map(branch => (
            <option key={branch.id} value={branch.id}>{displayBranch(branch)}</option>
          ))}
        </select>
        {tab !== 'matches' && <Button size="sm" variant="secondary" icon="download" disabled={!recordsForTab.length} onClick={handleExportCsv}>
          {tab === 'visits' && store.appointmentsTruncated ? 'Export loaded appointments CSV' : 'Export Archive CSV'}
        </Button>}
      </FilterBar>

      {branchUnavailable && <Notice tone="warning" title="Archive branch unavailable">
        Choose an available branch to view or export records.
      </Notice>}

      {!branchUnavailable && <>
      <Tabs
        tabs={availableTabs}
        active={tab}
        onChange={ownerSearch ? setSearchTab : setBrowseTab}
      />

      <div ref={archiveResults} role={role === 'owner' || usesStaffServer ? 'region' : undefined} aria-label={role === 'owner' || usesStaffServer ? 'Archive results' : undefined} tabIndex={role === 'owner' || usesStaffServer ? -1 : undefined}>
      {tab === 'matches' && (
        <Card title="Matching archive records" subtitle="Select a record type to export its results.">
          {financialStatus}
          {store.appointmentsTruncated && <Notice>Search covers the loaded appointments. Older matches may exist.</Notice>}
          {appointmentsLoading && <p role="status">Refreshing historical appointments… {archivedVisits.length > 0 && 'Showing loaded records.'}</p>}
          {appointmentsFailed && <Notice tone="warning">Appointment history could not be refreshed.
            {store.appointmentFlow?.refresh && <Button variant="ghost" onClick={retryAppointments}>Retry historical appointments</Button>}
          </Notice>}
          <Table
            rows={searchMatches}
            caption="Matching archive records"
            empty={<span role="status">{appointmentsLoading || serverInvoices.pending ? 'Waiting for archive results.' :
              appointmentsFailed || financialReadIncomplete ? 'No matches in the available records.' : 'No matching archive records in this branch scope.'}</span>}
            columns={[
              { key: 'reference', label: 'Record', render: ({ kind, record }) => <div className="owner-record-cell">
                <b>{archiveReference(kind, record)}</b>
                <small>{archiveType[kind]}{record.status && ` · ${record.status}`}</small>
                {kind === 'financial' && receiptReference(record) && receiptReference(record) !== archiveReference(kind, record) &&
                  <small>{receiptReference(record)}</small>}
              </div> },
              { key: 'patient', label: 'Patient and branch', render: ({ record }) => <div className="owner-record-cell">
                <b>{archivePatient(record)}</b><small>{branchLabel(record)}</small>
              </div> },
              { key: 'date', label: 'Date (Manila)', render: ({ record }) => archiveDateDisplay(archiveDate(record)) },
              { key: 'actions', label: 'Details', render: match => <Button variant="soft"
                aria-label={`View details for ${archiveReference(match.kind, match.record)}`}
                onClick={() => {
                  logArchiveView(match.kind, match.record)
                  setViewRecord(match)
                }}>View details</Button> },
            ]}
          />
        </Card>
      )}

      {tab === 'visits' && (
        <Card title="Historical Appointments" subtitle="Past or terminal appointments; inclusion here does not confirm completed care.">
          {store.appointmentsTruncated && <Notice tone="warning" title="Appointment history is partial">
            Search, counts and CSV export cover the loaded appointments. Older matches may exist.
          </Notice>}
          {appointmentsLoading ? <Notice title="Loading historical appointments">
            Refreshing clinic records. {archivedVisits.length > 0 && 'Previously loaded appointments remain visible below.'}
          </Notice> : appointmentsFailed ? <Notice tone="error" title="Historical appointments could not be refreshed">
            {archivedVisits.length > 0 ? 'Previously loaded appointments may be out of date.' : 'No current result is available. This does not mean there are no historical appointments.'}
          </Notice> : null}
          {(appointmentsFailed || retrying || !Array.isArray(state.appointments)) && typeof store.appointmentFlow?.refresh === 'function' && <Button
            size="sm" variant="secondary" onClick={retryAppointments} disabled={appointmentsLoading}
          >{retrying ? 'Retrying historical appointments…' : 'Retry historical appointments'}</Button>}
          {(archivedVisits.length > 0 || !appointmentsLoading && !appointmentsFailed) && <Table
            rows={archivedVisits}
            caption="Historical appointments"
            empty={<span role="status">{emptyMessage(state.appointments, 'Historical appointments')}</span>}
            columns={[
              { key: 'date', label: 'Date', render: r => <b>{r.date}</b> },
              { key: 'code', label: 'Ref Code', render: r => <code>{r.code || r.id}</code> },
              { key: 'patientName', label: 'Patient', render: r => r.patientName || r.patient?.name || 'Patient' },
              { key: 'serviceName', label: 'Service / Procedure', render: r => r.serviceName || r.service?.name || r.service || 'Service unavailable' },
              { key: 'dentistName', label: 'Attending Dentist', render: r => r.dentistName || r.dentist?.name || 'Dentist unavailable' },
              { key: 'branch', label: 'Branch', render: branchLabel },
              { key: 'status', label: 'Outcome Status', render: r => <Status tone={r.status === 'Completed' || r.status === 'Served' ? 'success' : 'neutral'}>{r.status}</Status> },
              { key: 'actions', label: 'Actions', render: r => (
                <div className="row-actions">
                  <Button size="sm" variant="soft" icon="file" title="View details" aria-label={`View details for ${r.code || r.id}`} onClick={() => {
                    logArchiveView('visit', r)
                    setViewRecord({ kind: 'visit', record: r })
                  }}>View details</Button>
                  {role !== 'owner' && <Button size="sm" variant="soft" disabled aria-describedby="archive-restore-unavailable">Retrieve / Restore (unavailable)</Button>}
                </div>
              ) },
            ]}
          />}
        </Card>
      )}

      {tab === 'prescriptions' && (
        <Card title="Archived Digital Prescriptions" subtitle="Historical prescriptions issued to patients, scoped by role and branch.">
          {prescriptionStatus}
          {!prescriptionStatus && <Table
            rows={archivedPrescriptions}
            caption="Archived prescriptions"
            empty={<span role="status">{emptyMessage(prescriptionRows, 'Prescriptions')}</span>}
            columns={[
              { key: 'number', label: 'Rx Number', render: r => <b>{r.number}</b> },
              { key: 'issued_at', label: 'Issued Date', render: r => role === 'owner' ? archiveDateDisplay(archiveDate(r)) : (r.issued_at || r.date || '—') },
              { key: 'patientName', label: 'Patient', render: r => r.patientName || (typeof r.patient === 'object' ? r.patient?.name : r.patient) || 'Patient' },
              { key: 'dentistName', label: 'Prescribing Doctor', render: r => r.dentistName || (typeof r.dentist === 'object' ? r.dentist?.name : r.dentist) || 'Dentist' },
              { key: 'branch', label: 'Branch', render: branchLabel },
              ...(!usesStaffServer ? [{ key: 'medicines', label: 'Medicines', render: r => role === 'owner' ? <span className="au-muted">Metadata only (clinical privacy)</span> : ((r.lines || []).map(l => l.medicine).join(', ') || 'Medication list') }] : []),
              { key: 'status', label: 'Status', render: r => <Status tone={r.status === 'Void' ? 'danger' : 'neutral'}>{r.status || 'Issued'}</Status> },
              { key: 'actions', label: 'Actions', render: r => (
                <div className="row-actions">
                  <Button size="sm" variant="soft" icon="file" title="View details" aria-label={`View details for ${r.number || r.id}`} onClick={() => {
                    logArchiveView('prescription', r)
                    setViewRecord({ kind: 'prescription', record: r })
                  }}>View details</Button>
                </div>
              ) },
            ]}
          />}
        </Card>
      )}

      {tab === 'financials' && canViewFinancials && (
        <Card title="Settled Billing & Receipt Records" subtitle="Archived invoices and receipts settled via PayMongo or front-desk cash.">
          {financialStatus}
          {!financialStatus && <Table
            rows={archivedInvoices}
            caption="Settled invoices and receipts"
            empty={<span role="status">{emptyMessage(invoiceRows, 'Settled financial records')}</span>}
            columns={[
              { key: 'invoiceNumber', label: 'Invoice', render: r => <div className="owner-record-cell">
                <b>{r.invoiceNumber || r.invoice_number || r.id}</b>
                {(role === 'owner' || usesStaffServer) && receiptReference(r) && <small>{receiptReference(r)}</small>}
                {r.bookingCredit?.receipt_number && <small>{r.bookingCredit.receipt_number}</small>}
              </div> },
              { key: 'patientName', label: 'Patient', render: r => r.patientName || 'Patient' },
              { key: 'date', label: 'Issued Date', render: r => role === 'owner' || usesStaffServer ? archiveDateDisplay(archiveDate(r)) : (r.issued_at || r.date || '—') },
              { key: 'total', label: 'Gross Total', render: r => peso.format(r.gross_amount || r.total || 0) },
              { key: 'paid', label: 'Paid Amount', render: r => peso.format(r.paid_amount || r.total || 0) },
              { key: 'branch', label: 'Branch', render: branchLabel },
              { key: 'status', label: 'Settlement Status', render: r => <Status tone="success">{r.status || 'Paid'}</Status> },
              { key: 'actions', label: 'Actions', render: r => (
                <div className="row-actions">
                  <Button size="sm" variant="soft" icon="file" title="View details" aria-label={`View details for ${r.invoiceNumber || r.id}`} onClick={() => {
                    logArchiveView('financial', r)
                    setViewRecord({ kind: 'financial', record: r })
                  }}>View details</Button>
                </div>
              ) },
            ]}
          />}
        </Card>
      )}

      </div>

      {viewRecord && (
        <Modal
          open
          title="Archived Record Details (Read-Only)"
          subtitle="Historical archive inspection. Permanent deletion is disabled under clinic retention rules."
          onClose={() => setViewRecord(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <p><b>Record Type:</b> {role === 'owner' ? archiveType[viewRecord.kind] : viewRecord.kind.toUpperCase()}</p>
            <p><b>Reference:</b> <code>{role === 'owner' ? archiveReference(viewRecord.kind, viewRecord.record) :
              (viewRecord.record.code || viewRecord.record.number || viewRecord.record.invoiceNumber || viewRecord.record.id)}</code></p>
            {(role === 'owner' || usesStaffServer) && viewRecord.kind === 'financial' && receiptReference(viewRecord.record) &&
              <p><b>Receipt:</b> <code>{receiptReference(viewRecord.record)}</code></p>}
            {viewRecord.kind === 'financial' && viewRecord.record.bookingCredit?.receipt_number &&
              <p><b>Booking receipt:</b> <code>{viewRecord.record.bookingCredit.receipt_number}</code></p>}
            <p><b>Patient:</b> {role === 'owner' ? archivePatient(viewRecord.record) :
              (viewRecord.record.patientName || viewRecord.record.patient?.name || 'Patient')}</p>
            <p><b>Branch:</b> {branchLabel(viewRecord.record)}</p>
            <p><b>Date:</b> {role === 'owner' ? archiveDateDisplay(archiveDate(viewRecord.record)) : (viewRecord.record.date || viewRecord.record.issued_at || '—')}</p>
            <p><b>Status:</b> {viewRecord.record.status || 'Archived'}</p>
          </div>
          {documentError && <p role="alert">{documentError}</p>}
          {usesStaffServer && viewRecord.kind === 'financial' && <div className="row-actions">
            {viewRecord.record.receiptId && <Button variant="soft" onClick={() => downloadArchivedReceipt(viewRecord.record)}>Download Payment Receipt</Button>}
            {viewRecord.record.bookingCredit?.receipt_number && <Button variant="soft" onClick={() => downloadArchivedReceipt(viewRecord.record, true)}>Download Booking Deposit Receipt</Button>}
          </div>}
          <div className="row-actions" style={{ marginTop: '16px' }}>
            <Button variant="ghost" onClick={() => setViewRecord(null)}>Close</Button>
          </div>
        </Modal>
      )}
      </>}
      </>}
    </div>
  )
}
export default ArchivesPage
