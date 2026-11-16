import React, { useState, useEffect, useRef } from 'react'
import { Brand } from '../Brand.jsx'
import { Button, Card, Field, FilterBar, Modal, Notice, PageHeader, Status, Table } from '../components.jsx'
import { fetchAuditLogs, downloadAuditLogsCsv } from '../audit-api.js'
import { canAccessPage } from '../safeguards.js'

export function AuditTrailPage({ store }) {
  const session=store.session,auth=store.getAuthGeneration?.()
  const allowed=!!session?.serverUserId&&session.role==='owner'&&session.active&&canAccessPage(store.state,session,'audit')&&(!store.getAuthGeneration||auth!=null)
  if(!allowed)return <Notice title="Audit trail unavailable">An active Owner server session is required to inspect operational archive activity and audit history.</Notice>
  return <AuditLifetime key={JSON.stringify([session.serverUserId,session.userId,session.role,session.active,auth])} store={store}/>
}

function AuditLifetime({ store }) {
  const { state, toast } = store
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [branchId, setBranchId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selection, setInspectLog] = useState(null)
  const [target, setTarget] = useState(null)
  const [loadedKey,setLoadedKey]=useState(null),[action,setAction]=useState('')
  const epoch=useRef(0),mounted=useRef(false),morePending=useRef(false),exportPending=useRef(false),currentKey=useRef('')
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
  layoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++}},[])

  // Debounced server query. A response for an older filter set is discarded, and a failure is an explicit error with Retry:
  // never an empty list and never browser-held or demo activity.
  useEffect(() => {
    const ticket={epoch:++epoch.current,key:filterKey,auth}
    morePending.current=false;setLoadingMore(false);setInspectLog(null)
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
    if (!nextCursor || loadingMore || morePending.current || loadedKey!==filterKey || rangeInvalid) return
    morePending.current=true
    const ticket={epoch:epoch.current,key:filterKey,auth}
    setLoadingMore(true)
    try {
      const page = await fetchAuditLogs({ ...filters(), per_page: 50, cursor: nextCursor })
      if(!owns(ticket))return
      setLogs(previous => [...previous, ...page.rows.filter(row => !previous.some(p => p.id === row.id))])
      setNextCursor(page.nextCursor)
    } catch (err) {
      if(owns(ticket))toast(err.message || 'More audit records could not be loaded.', 'warning')
    } finally {
      if(owns(ticket)){morePending.current=false;setLoadingMore(false)}
    }
  }

  const handleExport = async () => {
    if(rangeInvalid||loadedKey!==filterKey||viewStatus!=='ready'||exportPending.current)return
    const ticket={epoch:epoch.current,key:filterKey,auth}
    exportPending.current=true
    try {
      setExporting(true)
      const result = await downloadAuditLogsCsv(filters(),()=>owns(ticket))
      if(!owns(ticket))return
      toast(result.truncated ? `Export generated, but cut at the newest ${result.limit} matching events. Narrow the filters for the rest.` : 'Audit trail export generated.', result.truncated ? 'warning' : 'success')
    } catch (err) {
      if(owns(ticket))toast(err.message || 'Failed to export audit logs.', 'warning')
    } finally {
      exportPending.current=false;if(mounted.current)setExporting(false)
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
            <Button size="sm" variant="soft" onClick={handleExport} disabled={exporting||rangeInvalid||viewStatus!=='ready'}>
              {exporting ? 'Generating Export...' : 'Export Audit Trail (CSV)'}
            </Button>
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
          <span role="status">Record filter: {target.type} <code>{target.id}</code></span>
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

      {viewStatus === 'ready' && !rangeInvalid && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: '700' }}>Events loaded</span>
          <b style={{ display: 'block', fontSize: '20px', marginTop: '4px' }}>{shownLogs.length}</b>
        </div>
        <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: '700' }}>Security & warnings (loaded)</span>
          <b style={{ display: 'block', fontSize: '20px', marginTop: '4px', color: securityCount > 0 ? '#b91c1c' : 'inherit' }}>{securityCount}</b>
        </div>
        <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: '700' }}>Financial (loaded)</span>
          <b style={{ display: 'block', fontSize: '20px', marginTop: '4px' }}>{financialCount}</b>
        </div>
        <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--surface)' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: '700' }}>Clinical (loaded)</span>
          <b style={{ display: 'block', fontSize: '20px', marginTop: '4px' }}>{clinicalCount}</b>
        </div>
      </div>}

      <div style={{ marginTop: '20px' }}>
        <Card title="Activity Log" subtitle="Newest first, recorded by the clinic server. Entries cannot be edited or deleted from the application.">
          {rangeInvalid ? (
            <Notice tone="warning">Fix the date range to load audit records.</Notice>
          ) : viewStatus === 'loading' ? (
            <Notice>Loading audit records...</Notice>
          ) : viewStatus === 'error' ? (
            <Notice tone="warning" title="Audit trail unavailable">{loadError} <Button size="sm" variant="ghost" onClick={() => setAttempt(attempt + 1)}>Retry</Button></Notice>
          ) : shownLogs.length === 0 ? (
            <Notice tone="info">No audit records match the current filter criteria.</Notice>
          ) : (
            <Table
              rows={shownLogs}
              columns={[
                {
                  key: 'createdAt',
                  label: 'Timestamp',
                  render: l => (
                    <div>
                      <b>{l.createdAt ? new Date(l.createdAt).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'}) : 'Date unavailable'}</b>
                      <small style={{ display: 'block', color: 'var(--muted)', fontSize: '10px' }}>
                        {l.createdAt ? new Date(l.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone:'Asia/Manila' }) : '—'}
                      </small>
                    </div>
                  ),
                },
                {
                  key: 'severity',
                  label: 'Severity',
                  render: l => <Status tone={severityTone(l.severity)}>{l.severity}</Status>,
                },
                {
                  key: 'category',
                  label: 'Category',
                  render: l => <span style={{ textTransform: 'capitalize', fontSize: '11px', fontWeight: '600' }}>{l.category}</span>,
                },
                {
                  key: 'action',
                  label: 'Action',
                  render: l => <code style={{ fontSize: '11px', padding: '2px 4px', background: '#f1f5f9', borderRadius: '4px' }}>{l.action}</code>,
                },
                {
                  key: 'actor',
                  label: 'Actor',
                  render: l => (
                    <div>
                      <b>{l.actor?.name || 'Anonymous'}</b>
                      <small style={{ display: 'block', color: 'var(--muted)', fontSize: '10px' }}>{l.actor?.role || 'anonymous'}</small>
                    </div>
                  ),
                },
                {
                  key: 'branch',
                  label: 'Branch',
                  render: l => l.branch?.name || 'No branch recorded',
                },
                {
                  key: 'target',
                  label: 'Target',
                  render: l => l.auditableType ? (
                    <small style={{ fontSize: '10px' }}>
                      <b>{l.auditableType}</b>: {l.auditableId || '—'}
                    </small>
                  ) : <span style={{ color: 'var(--muted)', fontSize: '11px' }}>—</span>,
                },
                {
                  key: 'actions',
                  label: 'Details',
                  render: l => (
                    <Button size="sm" variant="ghost" onClick={() => setInspectLog(l)}>
                      Inspect
                    </Button>
                  ),
                },
              ]}
            />
          )}
          {viewStatus === 'ready' && nextCursor && !rangeInvalid && (
            <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center' }}>
              <Button variant="soft" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older events'}</Button>
            </div>
          )}
          {viewStatus === 'ready' && !nextCursor && shownLogs.length > 0 && <p className="muted" style={{ textAlign: 'center', marginTop: '12px', fontSize: '11px' }}>End of the matching history.</p>}
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
                <small style={{ color: 'var(--muted)', display: 'block' }}>Timestamp</small>
                <span>{inspectLog.createdAt}</span>
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
                <Button variant="soft" onClick={() => {
                  setTarget({ type: inspectLog.auditableType, id: inspectLog.auditableId })
                  setInspectLog(null)
                }}>Filter to this record</Button>
              )}
              <Button onClick={() => setInspectLog(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
