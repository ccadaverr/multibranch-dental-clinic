import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, FilterBar, Modal, Notice, PageHeader, Status, Table, Tabs } from '../components.jsx'
import { makeCsv, peso } from '../logic.js'
import { clinicDate } from '../clock.js'
import { inScope } from '../contracts.js'
import { canAccessPage, permitted } from '../safeguards.js'

const branchIdOf = item => {
  const nested = typeof item.branch === 'object' && item.branch !== null ? item.branch.id : null
  return nested && item.branchId && nested !== item.branchId ? null : nested || item.branchId || null
}
const patientIdOf = item => item.patientId || item.patientPublicId || item.patient?.id || null

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
    scopes, session?.dentistId, account?.accountStatus || account?.status, [...(account?.permissions || [])].sort(), enabled])
  return <ArchiveLifetime key={accessKey} store={store} role={role} session={session} scopes={scopes} enabled={enabled} activeBranch={activeBranch}/>
}

function ArchiveLifetime({ store, role, session, scopes, enabled, activeBranch }) {
  const { state, actions, toast } = store
  const live = useRef(false)
  const layoutEffect = typeof window === 'undefined' ? useEffect : React.useLayoutEffect
  layoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [tab, setTab] = useState('visits')
  const [query, setQuery] = useState('')
  const [selectedBranch, setSelectedBranch] = useState(
    role === 'owner' ? (activeBranch || 'All Branches') : (activeBranch && activeBranch !== 'All Branches' ? activeBranch : 'All Branches')
  )
  const [recordSelection, setRecordSelection] = useState(null)
  const setViewRecord = selection => setRecordSelection(selection ? {
    ...selection, id: selection.record.id, patientId: patientIdOf(selection.record),
  } : null)
  const noStaffScope = role === 'staff' && scopes.length === 0
  const branchLabel = item => {
    const canonical = (state.branches || []).find(branch => branch.id === branchIdOf(item))
    return canonical?.name || (typeof item.branch === 'object' && item.branch ? item.branch.name : item.branch || item.branchName) || 'Branch unavailable'
  }

  // Authorized branches by role and branch access policy
  const branches = useMemo(() => {
    const allBranches = state.branches || []
    if (role === 'owner') {
      return ['All Branches', ...allBranches.map(b => b.name)]
    }
    if (role === 'staff') {
      if (!scopes.length) return []
      const allowed = allBranches.filter(b => scopes.includes(b.id)).map(b => b.name)
      return allowed.length === 1 ? allowed : ['All Branches', ...allowed]
    }
    if (role === 'dentist') {
      const dentist = (state.dentists || []).find(d => d.id === session?.dentistId || d.userId === session?.userId)
      const allowed = dentist?.branches?.length ? dentist.branches : (activeBranch && activeBranch !== 'All Branches' ? [activeBranch] : allBranches.map(b => b.name))
      return allowed.length > 1 ? ['All Branches', ...allowed] : allowed
    }
    return ['All Branches']
  }, [state.branches, state.dentists, role, session, activeBranch, scopes])

  const effectiveBranch = branches.includes(selectedBranch) ? selectedBranch : (branches[0] || 'All Branches')
  useEffect(() => {
    if (!branches.includes(selectedBranch)) setSelectedBranch(branches[0] || 'All Branches')
  }, [branches, selectedBranch])

  // Filter helper enforcing both role/branch access scope and the selected branch dropdown
  const branchAndRoleFilter = item => {
    if (!enabled || noStaffScope) return false
    const bName = typeof item.branch === 'object' && item.branch !== null
      ? (item.branch.name || item.branch.id)
      : (item.branch || item.branchName)
    if (role === 'staff') {
      const inStaffBranch = !!branchIdOf(item) && scopes.includes(branchIdOf(item))
      if (!inStaffBranch) return false
    } else if (role === 'dentist') {
      const inDentistBranch = (bName && branches.includes(bName)) || inScope(item, session, state)
      const isDentistRecord = (item.dentistId && item.dentistId === session?.dentistId) || (item.dentist_id && item.dentist_id === session?.dentistId) || (item.dentist && (item.dentist.id === session?.dentistId || item.dentist === session?.dentistId)) || inScope(item, session, state)
      if (!inDentistBranch || !isDentistRecord) return false
    }
    if (effectiveBranch === 'All Branches') return true
    return (role === 'staff' ? branchLabel(item) : bName) === effectiveBranch
  }

  // 1. Historical appointments: preserve the existing past-or-terminal eligibility.
  const archivedVisits = useMemo(() => {
    const list = (state.appointments || []).filter(a => {
      const isPastOrDone = ['Completed', 'Served', 'Cancelled', 'No-Show'].includes(a.status) || a.date <= clinicDate()
      return isPastOrDone && branchAndRoleFilter(a)
    })
    if (!query.trim()) return list
    const q = query.toLowerCase()
    return list.filter(a =>
      (a.patientName || '').toLowerCase().includes(q) ||
      (a.serviceName || a.service?.name || a.service || '').toLowerCase().includes(q) ||
      (a.dentistName || a.dentist?.name || '').toLowerCase().includes(q) ||
      (a.code || '').toLowerCase().includes(q)
    )
  }, [state.appointments, effectiveBranch, query, role, branches, enabled])

  // 2. Archived prescriptions
  const archivedPrescriptions = useMemo(() => {
    const list = (state.prescriptions || []).filter(branchAndRoleFilter)
    if (!query.trim()) return list
    const q = query.toLowerCase()
    return list.filter(p =>
      (p.number || '').toLowerCase().includes(q) ||
      (p.patientName || '').toLowerCase().includes(q) ||
      (p.dentistName || '').toLowerCase().includes(q)
    )
  }, [state.prescriptions, effectiveBranch, query, role, branches, enabled])

  // 3. Archived receipts / settled invoices (Staff and Owner only; Dentists do not view financial records)
  const canViewFinancials = role !== 'dentist' && enabled && (role === 'owner' || role === 'staff' && permitted(state, session, 'billing'))
  const archivedInvoices = useMemo(() => {
    if (!canViewFinancials) return []
    const list = (state.invoices || []).filter(i => {
      const isSettled = ['Paid', 'Closed', 'Archived'].includes(i.status)
      return isSettled && branchAndRoleFilter(i)
    })
    if (!query.trim()) return list
    const q = query.toLowerCase()
    return list.filter(i =>
      (i.invoiceNumber || i.invoice_number || '').toLowerCase().includes(q) ||
      (i.patientName || '').toLowerCase().includes(q) ||
      (i.receiptNumber || i.receipt?.number || '').toLowerCase().includes(q)
    )
  }, [state.invoices, effectiveBranch, query, canViewFinancials, role, branches])

  // Resolve details from the CURRENT authorized projection, never the stored object.
  // Reused IDs with a different Patient also invalidate the previous selection.
  const detailRows = recordSelection?.kind === 'visit' ? archivedVisits
    : recordSelection?.kind === 'prescription' ? archivedPrescriptions : canViewFinancials ? archivedInvoices : []
  const currentRecord = recordSelection && detailRows.find(record => record.id === recordSelection.id &&
    (patientIdOf(record) ? patientIdOf(record) === recordSelection.patientId : !recordSelection.patientId && record === recordSelection.record))
  const viewRecord = currentRecord ? { kind: recordSelection.kind, record: currentRecord } : null
  useEffect(() => { if (recordSelection && !currentRecord) setViewRecord(null) }, [recordSelection, currentRecord])
  const recordsForTab = tab === 'visits' ? archivedVisits : tab === 'prescriptions' ? archivedPrescriptions : canViewFinancials ? archivedInvoices : []
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

  const handleExportCsv = () => {
    if (!live.current || !enabled || noStaffScope || !recordsForTab.length) return
    const scopeSlug = effectiveBranch.toLowerCase().replace(/[^a-z0-9]+/g, '-')
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
      logArchiveAudit('archive.exported', `visits:${scopeSlug}`, `Exported ${rows.length} archived visit(s) for ${effectiveBranch}`)
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
      logArchiveAudit('archive.exported', `prescriptions:${scopeSlug}`, `Exported ${rows.length} archived prescription(s) for ${effectiveBranch}`)
      toast?.('Archived prescriptions exported to CSV.', 'success')
    } else if (tab === 'financials' && canViewFinancials) {
      const rows = archivedInvoices.map(i => ({
        'Invoice Number': i.invoiceNumber || i.invoice_number || i.id || '',
        'Receipt Number': i.receiptNumber || i.receipt?.number || '',
        'Patient Name': i.patientName || '',
        'Issued Date': i.issued_at || i.date || '',
        'Gross Amount': i.gross_amount || i.total || 0,
        'Paid Amount': i.paid_amount || i.total || 0,
        'Branch': branchLabel(i),
        'Settlement Status': i.status || 'Paid',
      }))
      makeCsv(`archives-financial-receipts-${scopeSlug}.csv`, rows)
      logArchiveAudit('archive.exported', `financials:${scopeSlug}`, `Exported ${rows.length} archived financial record(s) for ${effectiveBranch}`)
      toast?.('Settled financial records exported to CSV.', 'success')
    }
  }

  const availableTabs = [
    { key: 'visits', label: `Historical Appointments (${archivedVisits.length})` },
    { key: 'prescriptions', label: `Prescriptions (${archivedPrescriptions.length})` },
    ...(canViewFinancials ? [{ key: 'financials', label: `Settled Invoices & Receipts (${archivedInvoices.length})` }] : []),
  ]

  return (
    <div className="archives-page" aria-label="Archives and Historical Records">
      <PageHeader
        kicker="Compliance & Record Retention"
        title="Archives & Historical Records Management"
        text="Role- and branch-scoped history of past or terminal appointments, prescriptions, and settled financial records."
      />

      <Notice tone="info" title="History viewing and restoration availability">
        <b>Viewing</b> inspects historical records read-only within your role and branch scope.
        <br/><span id="archive-restore-unavailable" tabIndex={0}>Retrieval / restoration is unavailable on this screen. Viewing a record does not restore it or flag it for active follow-up.</span><br/>
        <b>Permanent deletion</b> is not available on this screen.
      </Notice>

      {!enabled || noStaffScope ? <Notice tone="warning" title={noStaffScope && enabled ? 'No authorized archive branches' : 'Archive access unavailable'}>
        {noStaffScope && enabled ? 'This account has no authorized branches for archive viewing or export.' : 'These records are unavailable to the current account.'}
      </Notice> : <>

      <FilterBar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search by patient, code, number, dentist…"
        onClear={(query || effectiveBranch !== (branches[0] || 'All Branches')) ? () => { setQuery(''); setSelectedBranch(branches[0] || 'All Branches') } : null}
      >
        <select
          className="filter-select"
          aria-label="Filter archive by branch"
          value={effectiveBranch}
          disabled={branches.length <= 1}
          onChange={e => setSelectedBranch(e.target.value)}
        >
          {branches.map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <Button size="sm" variant="secondary" icon="download" disabled={!recordsForTab.length} onClick={handleExportCsv}>
          Export Archive CSV
        </Button>
      </FilterBar>

      <Tabs
        tabs={availableTabs}
        active={tab}
        onChange={setTab}
      />

      {tab === 'visits' && (
        <Card title="Historical Appointments" subtitle="Past or terminal appointments; inclusion here does not confirm completed care.">
          <Table
            rows={archivedVisits}
            emptyMessage={emptyMessage(state.appointments, 'Historical appointments')}
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
                    logArchiveAudit('archive.viewed', r.code || r.id, `Viewed archived visit ${r.code || r.id}`)
                    setViewRecord({ kind: 'visit', record: r })
                  }}>View details</Button>
                  <Button size="sm" variant="soft" disabled aria-describedby="archive-restore-unavailable">Retrieve / Restore (unavailable)</Button>
                </div>
              ) },
            ]}
          />
        </Card>
      )}

      {tab === 'prescriptions' && (
        <Card title="Archived Digital Prescriptions" subtitle="Historical prescriptions issued to patients, scoped by role and branch.">
          <Table
            rows={archivedPrescriptions}
            emptyMessage={emptyMessage(state.prescriptions, 'Prescriptions')}
            columns={[
              { key: 'number', label: 'Rx Number', render: r => <b>{r.number}</b> },
              { key: 'issued_at', label: 'Issued Date', render: r => r.issued_at || r.date || '—' },
              { key: 'patientName', label: 'Patient', render: r => r.patientName || (typeof r.patient === 'object' ? r.patient?.name : r.patient) || 'Patient' },
              { key: 'dentistName', label: 'Prescribing Doctor', render: r => r.dentistName || (typeof r.dentist === 'object' ? r.dentist?.name : r.dentist) || 'Dentist' },
              { key: 'branch', label: 'Branch', render: branchLabel },
              { key: 'medicines', label: 'Medicines', render: r => role === 'owner' ? <span className="au-muted">Metadata only (clinical privacy)</span> : ((r.lines || []).map(l => l.medicine).join(', ') || 'Medication list') },
              { key: 'status', label: 'Status', render: r => <Status tone={r.status === 'Void' ? 'danger' : 'neutral'}>{r.status || 'Issued'}</Status> },
              { key: 'actions', label: 'Actions', render: r => (
                <div className="row-actions">
                  <Button size="sm" variant="soft" icon="file" title="View details" aria-label={`View details for ${r.number || r.id}`} onClick={() => {
                    logArchiveAudit('archive.viewed', r.number || r.id, `Viewed archived prescription ${r.number || r.id}`)
                    setViewRecord({ kind: 'prescription', record: r })
                  }}>View details</Button>
                </div>
              ) },
            ]}
          />
        </Card>
      )}

      {tab === 'financials' && canViewFinancials && (
        <Card title="Settled Billing & Receipt Records" subtitle="Archived invoices and receipts settled via PayMongo or front-desk cash.">
          <Table
            rows={archivedInvoices}
            emptyMessage={emptyMessage(state.invoices, 'Settled financial records')}
            columns={[
              { key: 'invoiceNumber', label: 'Invoice #', render: r => <b>{r.invoiceNumber || r.invoice_number || r.id}</b> },
              { key: 'patientName', label: 'Patient', render: r => r.patientName || 'Patient' },
              { key: 'date', label: 'Issued Date', render: r => r.issued_at || r.date || '—' },
              { key: 'total', label: 'Gross Total', render: r => peso.format(r.gross_amount || r.total || 0) },
              { key: 'paid', label: 'Paid Amount', render: r => peso.format(r.paid_amount || r.total || 0) },
              { key: 'branch', label: 'Branch', render: branchLabel },
              { key: 'status', label: 'Settlement Status', render: r => <Status tone="success">{r.status || 'Paid'}</Status> },
              { key: 'actions', label: 'Actions', render: r => (
                <div className="row-actions">
                  <Button size="sm" variant="soft" icon="file" title="View details" aria-label={`View details for ${r.invoiceNumber || r.id}`} onClick={() => {
                    logArchiveAudit('archive.viewed', r.invoiceNumber || r.id, `Viewed archived financial record ${r.invoiceNumber || r.id}`)
                    setViewRecord({ kind: 'financial', record: r })
                  }}>View details</Button>
                </div>
              ) },
            ]}
          />
        </Card>
      )}

      {viewRecord && (
        <Modal
          open
          title="Archived Record Details (Read-Only)"
          subtitle="Historical archive inspection. Permanent deletion is disabled under clinic retention rules."
          onClose={() => setViewRecord(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <p><b>Record Type:</b> {viewRecord.kind.toUpperCase()}</p>
            <p><b>Reference:</b> <code>{viewRecord.record.code || viewRecord.record.number || viewRecord.record.invoiceNumber || viewRecord.record.id}</code></p>
            <p><b>Patient:</b> {viewRecord.record.patientName || viewRecord.record.patient?.name || 'Patient'}</p>
            <p><b>Branch:</b> {branchLabel(viewRecord.record)}</p>
            <p><b>Date:</b> {viewRecord.record.date || viewRecord.record.issued_at || '—'}</p>
            <p><b>Status:</b> {viewRecord.record.status || 'Archived'}</p>
          </div>
          <div className="row-actions" style={{ marginTop: '16px' }}>
            <Button variant="ghost" onClick={() => setViewRecord(null)}>Close</Button>
          </div>
        </Modal>
      )}
      </>}
    </div>
  )
}
export default ArchivesPage
