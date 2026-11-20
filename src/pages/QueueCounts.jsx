import React from 'react'
import { Card, Icon, MetricRow, Notice, ReadState, RefreshButton, StatCard } from '../components.jsx'
import { clinicNow } from '../clock.js'
import { countQueue, queueVisibility } from '../queue-counts.js'

/** Pure visibility of the server queue counts for this store/session (see src/queue-counts.js). 'demo' = offline demo session. */
export const queueVisibilityFor = store => queueVisibility({ session: store.session, status: store.appointmentsStatus, snapshot: store.queueSnapshot, today: clinicNow().date })

/**
 * Same as queueVisibilityFor, but re-evaluated every 15 s while mounted, so the Asia/Manila midnight turns shown counts
 * into "out of date" and requests a refresh immediately, instead of waiting for the next 30-second poll or a store change.
 */
export function useQueueVisibility(store) {
  const [day, setDay] = React.useState(() => clinicNow().date)
  React.useEffect(() => {
    const timer = setInterval(() => setDay(clinicNow().date), 15000)
    return () => clearInterval(timer)
  }, [])
  const vis = queueVisibilityFor(store)
  const refresh = store.appointmentFlow?.refresh
  React.useEffect(() => { if (vis.mode === 'stale') refresh?.() }, [day, vis.mode]) // eslint-disable-line react-hooks/exhaustive-deps
  return vis
}

/** Loading / failure / stale / incomplete notice. Null when counts are ready or the session is the offline demo. */
export function QueueCountsNotice({ vis, store }) {
  if (vis.mode === 'ready' || vis.mode === 'demo') return null
  // A stale read must never display invented zeroes; refresh happens via the
  // existing visibility hook. Only confirmed failures offer manual recovery.
  if (vis.mode === 'loading' || vis.mode === 'stale') {
    return <ReadState compact state="loading" message="Updating queue…"/>
  }
  return <ReadState compact state="error"
    message={vis.mode === 'incomplete' ? 'Queue results are incomplete. Counts are hidden.' : 'Queue is temporarily unavailable.'}
    onRetry={() => store.appointmentFlow?.refresh?.()}/>
}

const branchOf = (state, activeBranch) => state.branches.find(b => b.name === activeBranch) || null

/** Clearly labelled tallies of today's server queue statuses for the visible scope; numbers only after a complete response. */
export function QueueStatusCounts({ store, activeBranch, vis }) {
  const { state } = store
  const branch = branchOf(state, activeBranch)
  if (vis.mode !== 'ready') return <QueueCountsNotice vis={vis} store={store}/>
  const staff = store.session?.role === 'staff'
  if (staff && (!branch || branch.id !== store.session?.branchId)) return <Notice tone="warning">Assigned branch unavailable. Refresh the queue or contact the clinic Owner.</Notice>
  const c = countQueue(state.queue, { branchId: branch?.id ?? null, date: clinicNow().date })
  return <>
    <div className="stats-grid queue-count-grid" aria-label="Live queue counts for today">
      <StatCard label="Waiting" value={c.waiting} hint={staff?undefined:'Checked in, not yet called'} tone="blue" icon={<Icon name="queue" size={18}/>}/>
      <StatCard label="Called" value={c.called} hint={staff?undefined:'Called, not yet ready'} icon={<Icon name="queue" size={18}/>}/>
      <StatCard label="Treatment Ready" value={c.treatmentReady} hint={staff?undefined:'Ready for the Dentist'} icon={<Icon name="queue" size={18}/>}/>
      <StatCard label="Temporarily Away" value={c.away} hint={staff?undefined:'Kept open; not counted as awaiting'} tone="amber" icon={<Icon name="queue" size={18}/>}/>
    </div>
    {!staff&&<p className="muted-copy">Awaiting treatment = Waiting + Called + Treatment Ready: <b>{c.awaiting}</b>. Open queue entries = awaiting + Temporarily Away: <b>{c.active}</b>. Served patients are not counted. Counts are today’s entries (clinic day {clinicNow().date}) from the clinic server, within the records you can see; the clinic has not set any waiting-time or capacity limits, so none is shown.</p>}
  </>
}

/** One row per visible branch for Owner views. */
export function QueueByBranch({ store, activeBranch, vis, title = 'Live queue by branch', actions }) {
  const { state } = store
  const branches = state.branches.filter(b => activeBranch === 'All Branches' || b.name === activeBranch)
  return <Card title={title} subtitle="Counts of today’s queue entries by status. Not a workload or waiting-time measure." actions={actions}>
    {vis.mode !== 'ready' ? <QueueCountsNotice vis={vis} store={store}/> : branches.length ? branches.map(b => {
      const c = countQueue(state.queue, { branchId: b.id, date: clinicNow().date })
      return <MetricRow key={b.id} label={b.name} value={<span style={{whiteSpace:'nowrap'}}>{`${c.awaiting} awaiting`}</span>} note={`Waiting ${c.waiting} • Called ${c.called} • Treatment Ready ${c.treatmentReady} • Temporarily Away ${c.away}`}/>
    }) : <p className="muted-copy">No branches are visible.</p>}
  </Card>
}
