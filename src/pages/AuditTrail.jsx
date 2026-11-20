import React, { useState, useEffect, useRef } from 'react'
import './owner-record-workspace.css'
import { Brand } from '../Brand.jsx'
import { Button, Card, Field, FilterBar, Modal, Notice, PageHeader, RefreshButton, Status, Table } from '../components.jsx'
import { fetchAuditLogs, requestAuditLogsCsv } from '../audit-api.js'
import { saveClinicCsv } from '../clinic-csv.js'
import { me } from '../api-client.js'
import { canAccessPage } from '../safeguards.js'
import { addDays, clinicDate } from '../clock.js'

export function AuditTrailPage({ store }) {
  const session=store.session,auth=store.getAuthGeneration?.()
  const allowed=!!session?.serverUserId&&session.role==='owner'&&session.active&&canAccessPage(store.state,session,'audit')&&(!store.getAuthGeneration||auth!=null)
  if(!allowed)return <Notice title="Audit trail unavailable">An active Owner server session is required to inspect operational archive activity and audit history.</Notice>
  return <AuditLifetime key={JSON.stringify([session.serverUserId,session.userId,session.role,session.active,auth])} store={store}/>
}

const manilaAuditTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium',
})

function AuditTimestamp({ value }) {
  const instant = new Date(value)
  return value && Number.isFinite(instant.getTime())
    ? <time dateTime={value}>{manilaAuditTime.format(instant)}</time>
    : 'Time unavailable'
}

function AuditLifetime({ store }) {
  const { state, toast } = store
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [branchId, setBranchId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selection, setInspectLog] = useState(null)
  const [target, setTarget] = useState(null)
  const recordFilterStatus = useRef(null)
  const activityLog = useRef(null)
  const historyPagination = useRef(null)
  const [loadedKey,setLoadedKey]=useState(null),[action,setAction]=useState('')
  const epoch=useRef(0),mounted=useRef(false),morePending=useRef(false),exportRequest=useRef(null),currentKey=useRef('')
  const auth=store.getAuthGeneration?.()
  const [exporting, setExporting] = useState(false)
  const rangeInvalid = !!(dateFrom && dateTo && dateFrom > dateTo)

  const filters = () => ({
    search: search.trim() || undefined,
    category: category !== 'all' ? category : undefined,
    severity: severity !== 'all' ? severity : undefined,
    branch_id: branchId || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    action: action || undefined,
    target_type: target?.type,
    target_id: target?.id,
  })
  const filterKey=JSON.stringify(filters())
  currentKey.current=filterKey
  const owns=ticket=>mounted.current&&ticket.epoch===epoch.current&&ticket.key===currentKey.current&&ticket.auth===store.getAuthGeneration?.()
  const shownLogs=loadedKey===filterKey&&!rangeInvalid?logs:[]
  const inspectLog=shownLogs.find(row=>row.id===selection?.id)||null
  const viewStatus=loadedKey===filterKey?status:'loading'
  const layoutEffect=typeof window==='undefined'?useEffect:React.useLayoutEffect
  layoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; epoch.current++ }
  }, [])
  layoutEffect(() => {
    setExporting(false)
    return () => {
      const request = exportRequest.current
      exportRequest.current = null
      request?.abort()
    }
  }, [filterKey, attempt, auth])

  const refresh = () => {
    epoch.current++
    setStatus('loading')
    setAttempt(current => current + 1)
  }

  const retryAuditRead = () => {
    activityLog.current?.focus()
    refresh()
  }

  const filterToRecord = ({ auditableType, auditableId }) => {
    setTarget({ type: auditableType, id: auditableId })
    setInspectLog(null)
  }

  const applyDateRange = (days) => {
    const today = clinicDate()
    setDateFrom(addDays(today, 1 - days))
    setDateTo(today)
  }

  useEffect(() => {
    if (target) recordFilterStatus.current?.focus()
  }, [target])

  // Debounced server query. A response for an older filter set is discarded, and a failure is an explicit error with Retry:
  // never an empty list and never browser-held or demo activity.
  useEffect(() => {
    const ticket={epoch:++epoch.current,key:filterKey,auth}
    morePending.current=false;setLoadingMore(false);setMoreError(false);setInspectLog(null)
    if (rangeInvalid) return undefined
    let live = true
    setStatus('loading')
    setLoadError('')
    const timer = setTimeout(async () => {
      try {
        const page = await fetchAuditLogs({ ...filters(), per_page: 50 })
        if (!live) return
        if (!owns(ticket)) return
        setLogs(page.rows)
        setLoadedKey(filterKey)
        setNextCursor(page.nextCursor)
        setStatus('ready')
      } catch (err) {
        if (!live) return
        if (!owns(ticket)) return
        setLogs([])
        setNextCursor(null)
        setLoadError(err.message || 'The audit trail could not be loaded.')
        setStatus('error')
        setLoadedKey(filterKey)
      }
    }, 200)
    return () => { live = false; clearTimeout(timer) }
  }, [filterKey, attempt])

  const loadMore = async () => {
    if (!nextCursor || loadingMore || morePending.current || loadedKey!==filterKey || viewStatus !== 'ready' || rangeInvalid) return
    morePending.current=true
    const ticket={epoch:epoch.current,key:filterKey,auth}
    setLoadingMore(true)
    setMoreError(false)
    try {
      const page = await fetchAuditLogs({ ...filters(), per_page: 50, cursor: nextCursor })
      if(!owns(ticket))return
      if (!page.nextCursor && historyPagination.current?.contains(document.activeElement)) {
        historyPagination.current.focus()
      }
      setLogs(previous => [...previous, ...page.rows.filter(row => !previous.some(p => p.id === row.id))])
      setNextCursor(page.nextCursor)
    } catch (err) {
      if (!owns(ticket)) return
      if (err?.kind === 'unauthenticated' || err?.kind === 'forbidden') {
        if (historyPagination.current?.contains(document.activeElement)) activityLog.current?.focus()
        exportRequest.current?.abort()
        exportRequest.current = null
        setExporting(false)
        setLogs([])
        setNextCursor(null)
        setInspectLog(null)
        setLoadError('Audit access could not be verified. Sign in with an active Owner account.')
        setStatus('error')
      } else {
        setMoreError(true)
      }
    } finally {
      if(owns(ticket)){morePending.current=false;setLoadingMore(false)}
    }
  }

  const cancelExport = () => {
    const request = exportRequest.current
    if (!request) return
    exportRequest.current = null
    request.abort()
    setExporting(false)
    toast('Audit export cancelled.')
  }

  const handleExport = async () => {
    if (rangeInvalid || loadedKey !== filterKey || viewStatus !== 'ready' || exportRequest.current) return
    const ticket = { epoch: epoch.current, key: filterKey, auth, actorId: store.session.serverUserId }
    const request = new AbortController()
    const isCurrent = () => owns(ticket) && exportRequest.current === request && !request.signal.aborted
      && store.session.serverUserId === ticket.actorId
    exportRequest.current = request
    try {
      setExporting(true)
      const options = { signal: request.signal }
      const result = await requestAuditLogsCsv(filters(), options)
      if (!isCurrent()) return
      const identity = await me(options)
      if (!isCurrent()) return
      if (!identity.ok || identity.data?.id !== ticket.actorId || identity.data?.role !== 'owner' || identity.data?.account_status !== 'Active') {
        throw new Error('Your Owner access could not be verified. Sign in and try again.')
      }
      saveClinicCsv(result)
      toast(result.truncated ? `Export generated, but cut at the newest ${result.limit} matching events. Narrow the filters for the rest.` : 'Audit trail export generated.', result.truncated ? 'warning' : 'success')
    } catch (err) {
      if (isCurrent()) toast(err.message || 'Failed to export audit logs.', 'warning')
    } finally {
      if (exportRequest.current === request) {
        exportRequest.current = null
        setExporting(false)
      }
    }
  }

  const securityCount = shownLogs.filter(l => l.severity === 'warning' || l.severity === 'critical' || l.category === 'security').length
  const financialCount = shownLogs.filter(l => l.category === 'financial').length
  const clinicalCount = shownLogs.filter(l => l.category === 'clinical').length

  const severityTone = (sev) => {
    if (sev === 'critical') return 'danger'
    if (sev === 'warning') return 'warning'
    return 'default'
  }

  return (
    <>
      <PageHeader
        title="Audit Trail & Activity Monitoring"
        text="Append-only record of significant events written by the clinic server. The Owner can review and export it; nothing in this screen can change or delete an entry. Details are kept minimal and credentials are redacted."
        aside={
          <div className="row-actions">
            <RefreshButton recovery={viewStatus === 'error'} size="sm" title="Retry audit events" ariaLabel="Refresh audit events"
              loading={viewStatus === 'loading' && !rangeInvalid} disabled={rangeInvalid} onClick={refresh}/>
            <Button size="sm" variant="soft" onClick={handleExport} disabled={exporting||rangeInvalid||viewStatus!=='ready'}>
              Export Audit Trail (CSV)
            </Button>
            {exporting && <>
              <span role="status">Preparing audit CSV...</span>
              <Button size="sm" variant="ghost" onClick={cancelExport}>Cancel audit export</Button>
            </>}
            <Button size="sm" variant="ghost" disabled={rangeInvalid||viewStatus!=='ready'} onClick={() => window.print()} icon="file">
              Print loaded audit events
            </Button>
          </div>
        }
      />

      <div className="audit-print-header" style={{ display: 'none', marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid #0f172a' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Brand />
          <div style={{ textAlign: 'right' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>Audit Trail</h3>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Generated on {new Date().toLocaleDateString('en-PH',{timeZone:'Asia/Manila'})}</span>
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          .audit-print-header { display: block !important; }
          .card { border: none !important; box-shadow: none !important; }
        }
      `}</style>
<Card title="Audit Event Filters">
        <Field label="Operational activity"><select aria-label="Operational activity" value={action} onChange={e=>setAction(e.target.value)}><option value="">All authorized audit events</option><option value="notification.archived">Notification archive activity (metadata only)</option><option value="staff_profile.updated">Staff profile changes</option><option value="staff_roster.draft_saved">Dated Staff draft preparation</option><option value="staff_roster.saved">Staff roster drafts and requests</option><option value="staff_roster.approved">Staff roster approvals</option><option value="staff_roster.published">Staff roster publications</option></select></Field>
        {action==='notification.archived'&&<Notice>Archive activity shows who archived a notification and when. Notification contents remain private to their recipient. This view cannot restore or delete records.</Notice>}
        {target && <div className="row-actions">
          <span role="status" tabIndex={-1} ref={recordFilterStatus} style={{ overflowWrap: 'anywhere' }}>
            Record filter: {target.type} <code>{target.id}</code>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>Clear record filter</Button>
        </div>}
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Action, actor, target ID, IP…"
          filters={[
            {
              key: 'category',
              label: 'Category',
              value: category,
              onChange: setCategory,
              options: [
                { value: 'all', label: 'All Categories' },
                { value: 'security', label: 'Security' },
                { value: 'clinical', label: 'Clinical' },
                { value: 'financial', label: 'Financial' },
                { value: 'administrative', label: 'Administrative' },
                { value: 'automation', label: 'Automation' },
                { value: 'general', label: 'General' },
              ],
            },
            {
              key: 'severity',
              label: 'Severity',
              value: severity,
              onChange: setSeverity,
              options: [
                { value: 'all', label: 'All Severities' },
                { value: 'info', label: 'Info' },
                { value: 'warning', label: 'Warning' },
                { value: 'critical', label: 'Critical' },
              ],
            },
            {
              key: 'branch',
              label: 'Branch',
              value: branchId,
              onChange: setBranchId,
              options: [
                { value: '', label: 'All Branches' },
                ...state.branches.map(b => ({ value: b.id, label: b.name })),
              ],
            },
          ]}
          count={viewStatus === 'ready' && !rangeInvalid ? shownLogs.length : undefined}
          onReset={search || category !== 'all' || severity !== 'all' || branchId || dateFrom || dateTo || action || target ? () => {
            setSearch('')
            setCategory('all')
            setSeverity('all')
            setBranchId('')
            setDateFrom('')
            setDateTo('')
            setAction('')
            setTarget(null)
          } : null}
        />
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid var(--line)' }}>
          <div role="group" aria-label="Manila date shortcuts" className="row-actions">
            <Button variant="soft" onClick={() => applyDateRange(1)}>Today</Button>
            <Button variant="soft" onClick={() => applyDateRange(7)}>Last 7 days</Button>
          </div>
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: '600', color: 'var(--muted)' }}>From:</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '13px' }}/>
          </label>
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: '600', color: 'var(--muted)' }}>To:</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '13px' }}/>
          </label>
          {rangeInvalid && <span style={{ color: '#dc2626', fontSize: '12px', fontWeight: '600' }}>The end date is before the start date.</span>}
        </div>
      </Card>

      {viewStatus === 'ready' && !rangeInvalid && <section className="audit-loaded-summary" aria-label="Audit summary">
        <div className="audit-summary-heading"><h2>Activity overview</h2><p>Counts reflect loaded events for the active filters.</p></div>
        <dl className="owner-audit-counts" aria-label="Counts for loaded events">
        <div><dt>Events loaded</dt><dd>{shownLogs.length}</dd></div>
        <div><dt>Security &amp; warnings</dt><dd>{securityCount}</dd></div>
        <div><dt>Financial</dt><dd>{financialCount}</dd></div>
        <div><dt>Clinical</dt><dd>{clinicalCount}</dd></div>
        </dl>
      </section>}

      <div ref={activityLog} role="region" aria-label="Activity Log" tabIndex={-1} style={{ marginTop: '20px' }}>
        <Card title="Activity Log" subtitle="Newest first · Manila time · Read only" className="owner-record-workspace">
          {rangeInvalid ? (
            <Notice tone="warning">Fix the date range to load audit records.</Notice>
          ) : viewStatus === 'loading' ? (
            <Notice>Loading audit records...</Notice>
          ) : viewStatus === 'error' ? (
            <Notice tone="warning" title="Audit trail unavailable">{loadError} <Button size="sm" variant="ghost" onClick={retryAuditRead}>Retry</Button></Notice>
          ) : shownLogs.length === 0 ? (
            <Notice tone="info">No audit records match the current filter criteria.</Notice>
          ) : (
            <Table
              rows={shownLogs}
              columns={[
                {
                  key: 'createdAt',
                  label: 'Timestamp',
                  render: l => <AuditTimestamp value={l.createdAt}/>,
                },
                {
                  key: 'severity',
                  label: 'Severity and category',
                  render: l => <div className="owner-record-cell">
                    <span><Status tone={severityTone(l.severity)}>{l.severity}</Status></span>
                    <small>{l.category}</small>
                  </div>,
                },
                {
                  key: 'action',
                  label: 'Event and record',
                  render: l => <div className="owner-record-cell">
                    <b>{l.action}</b>
                    {l.auditableType && <small>{l.auditableType} {l.auditableId}</small>}
                  </div>,
                },
                {
                  key: 'actor',
                  label: 'Actor and branch',
                  render: l => (
                    <div className="owner-record-cell">
                      <b>{l.actor?.name || 'Anonymous'}</b>
                      <small>{l.actor?.role || 'anonymous'}</small>
                      <small>{l.branch?.name || 'No branch recorded'}</small>
                    </div>
                  ),
                },
                {
                  key: 'actions',
                  label: 'Details',
                  render: l => (
                    <div className="row-actions">
                      <Button size="sm" variant="ghost" onClick={() => setInspectLog(l)}>Inspect</Button>
                      {l.auditableType && l.auditableId && (target?.type !== l.auditableType || target?.id !== l.auditableId) && (
                        <Button variant="ghost" onClick={() => filterToRecord(l)}
                          aria-label={`Show record history for ${l.auditableType} ${l.auditableId}`}>
                          Record history
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}
          {viewStatus === 'ready' && !rangeInvalid && shownLogs.length > 0 && (
            <div ref={historyPagination} role="group" aria-label="Audit history pagination" tabIndex={-1} className={nextCursor ? 'owner-report-recovery' : undefined}>
              {nextCursor ? <>
                {moreError && <Notice tone="warning">Older events could not be loaded. The events already loaded are still available.</Notice>}
                <Button variant="soft" onClick={loadMore} aria-disabled={loadingMore} aria-busy={loadingMore}>
                  {loadingMore ? 'Loading older events…' : moreError ? 'Retry older events' : 'Load older events'}
                </Button>
              </> : <p role="status" className="muted" style={{ textAlign: 'center', marginTop: '12px', fontSize: '11px' }}>End of the matching history.</p>}
            </div>
          )}
        </Card>
      </div>

      <Modal open={!!inspectLog} onClose={() => setInspectLog(null)} title="Audit Event Inspection" subtitle={inspectLog?.id} wide>
        {inspectLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div>
                <small style={{ color: 'var(--muted)', display: 'block' }}>Action</small>
                <b>{inspectLog.action}</b>
              </div>
              <div>
                <small style={{ color: 'var(--muted)', display: 'block' }}>Category & Severity</small>
                <span>{inspectLog.category} • <Status tone={severityTone(inspectLog.severity)}>{inspectLog.severity}</Status></span>
              </div>
              <div>
                <small style={{ color: 'var(--muted)', display: 'block' }}>Actor</small>
                <b>{inspectLog.actor?.name}</b> ({inspectLog.actor?.role})
              </div>
              <div>
                <small style={{ color: 'var(--muted)', display: 'block' }}>Branch</small>
                <span>{inspectLog.branch?.name || 'No branch recorded'}</span>
              </div>
              <div>
                <small style={{ color: 'var(--muted)', display: 'block' }}>Timestamp (Manila)</small>
                <AuditTimestamp value={inspectLog.createdAt}/>
              </div>
              <div>
                <small style={{ color: 'var(--muted)', display: 'block' }}>Client IP</small>
                <code>{inspectLog.ipAddress || '—'}</code>
              </div>
            </div>

            {inspectLog.userAgent && (
              <div>
                <small style={{ color: 'var(--muted)', display: 'block' }}>User Agent</small>
                <code style={{ fontSize: '10px', wordBreak: 'break-all' }}>{inspectLog.userAgent}</code>
              </div>
            )}

            <div>
              <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Event Payload (Sanitized)</small>
              <pre
                style={{
                  background: '#f8fafc',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '12px',
                  fontSize: '11px',
                  maxHeight: '260px',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {JSON.stringify(inspectLog.payload, null, 2)}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              {inspectLog.auditableType && inspectLog.auditableId && (
                <Button variant="soft" onClick={() => filterToRecord(inspectLog)}>Filter to this record</Button>
              )}
              <Button onClick={() => setInspectLog(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
