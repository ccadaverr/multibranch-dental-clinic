import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, Notice } from '../components.jsx'
import { confirmAppointment, frontDeskToday, undoNoShow, useFreeTimeForWalkIn } from '../api-client.js'

const REPLY = { on_my_way: ['On my way', 'is-ok'], attending: ['I’ll be there', 'is-ok'], cant_make_it: ['Can’t make it', 'is-late'], move_up_accepted: ['Took an earlier time', 'is-info'] }
const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work. Refresh and try again.'

/**
 * F2–F4 on the Check-In page (front desk and Owner): today's late patients with their replies, appointments released after the
 * late limit (Undo the same day), free times for walk-ins, and online bookings that wait for confirmation (cancellation policy).
 * Everything comes from GET /api/front-desk/today and refreshes every minute while the page is visible. Each panel hides when
 * it has nothing to show.
 */
export function FrontDeskToday({ toast = () => {}, onChanged }) {
  const [data, setData] = useState(null), [busy, setBusy] = useState('')
  const [readState, setReadState] = useState('loading')
  const read = useRef(0)
  const load = async () => {
    const generation = ++read.current
    setReadState(previous => previous === 'ready' ? 'ready' : 'loading')
    try {
      const result = await frontDeskToday()
      if (generation !== read.current) return
      if (result.ok && result.data) {
        setData(result.data)
        setReadState('ready')
        return
      }
    } catch {
      // A failed read has the same recovery as a non-success response.
    }
    if (generation === read.current) setReadState('error')
  }
  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    return () => { read.current++; clearInterval(t) }
  }, [])
  const act = async (id, run, done) => {
    setBusy(id)
    const r = await run()
    setBusy('')
    if (!r.ok) { toast(firstError(r), 'warning'); return load() }
    toast(done, 'success'); load(); onChanged?.()
  }
  if (readState === 'error') return <Notice tone="warning" title="Front Desk Today could not be loaded"><Button size="sm" onClick={load}>Retry</Button></Notice>
  if (readState === 'loading' || !data) return <p role="status">Loading Front Desk Today?</p>
  const s = data.settings
  const replied = data.replies.filter(r => !data.late.some(l => l.appointment_id === r.appointment_id))
  return <div className="fd-grid">
    {data.late.length > 0 && <Card className="fd-card-late" title={`Late (${data.late.length})`} subtitle={s ? `Not checked in ${s.late_minutes}+ minutes after the start. ${s.release_mode === 'automatic' ? `Released automatically at ${s.release_minutes} minutes.` : `Flagged for you at ${s.release_minutes} minutes.`} A late patient who checks in goes to the end of the dentist’s queue.` : null}>
      <ul className="fd-list">{data.late.map(a => <li key={a.appointment_id}>
        <div><b>{a.patient}<span className="fd-badge is-late">Late {a.minutes_late} min</span>{a.reply && <span className={`fd-badge ${REPLY[a.reply]?.[1] || 'is-info'}`}>{REPLY[a.reply]?.[0] || a.reply}</span>}</b>
          <span>{a.time} · {a.service} · {a.dentist} · {a.code}{a.asked ? ' · asked “Are you on your way?”' : ''}</span></div>
      </li>)}</ul>
    </Card>}
    {replied.length > 0 && <Card title={`Patient replies today (${replied.length})`} subtitle="From the reminder and “Are you on your way?” buttons.">
      <ul className="fd-list">{replied.map(a => <li key={a.appointment_id}><div><b>{a.patient}<span className={`fd-badge ${REPLY[a.reply]?.[1] || 'is-info'}`}>{REPLY[a.reply]?.[0] || a.reply}</span></b><span>{a.time} · {a.service} · {a.code}</span></div></li>)}</ul>
    </Card>}
    {data.released.length > 0 && <Card title={`Released today (${data.released.length})`} subtitle="Not checked in by the release time: recorded as no-show and the time was freed. Undo if the patient is here.">
      <ul className="fd-list">{data.released.map(a => <li key={a.appointment_id}>
        <div><b>{a.patient}</b><span>{a.time} · {a.service} · released {a.released_at} · {a.code}</span></div>
        <Button size="sm" variant="ghost" disabled={busy === a.appointment_id} onClick={() => act(a.appointment_id, () => undoNoShow(a.appointment_id, a.revision), `${a.patient} is booked again. Check them in now.`)}>Undo</Button>
      </li>)}</ul>
    </Card>}
    {data.free_times.length > 0 && <Card className="fd-card-free" title={`Free times today (${data.free_times.length})`} subtitle="Freed by a cancellation or release. Offered first to patients booked later today, then free for walk-ins.">
      <ul className="fd-list">{data.free_times.map(o => <li key={o.id}>
        <div><b>{o.from} – {o.to}<span className={`fd-badge ${o.stage === 'offered' ? 'is-info' : 'is-ok'}`}>{o.stage === 'offered' ? `Offered to ${o.offers_out} patient${o.offers_out === 1 ? '' : 's'}` : 'Open for a walk-in'}</span></b><span>{o.dentist} · {o.branch} · {o.minutes} minutes</span></div>
        {o.stage !== 'offered' && <Button size="sm" variant="soft" disabled={busy === o.id} onClick={() => act(o.id, () => useFreeTimeForWalkIn(o.id), 'Marked as used for a walk-in.')}>Used for a walk-in</Button>}
      </li>)}</ul>
    </Card>}
    {data.confirmations.length > 0 && <Card title={`Bookings to confirm (${data.confirmations.length})`} subtitle="Online bookings by patients over the late-cancellation and no-show limit wait for you to confirm them.">
      <ul className="fd-list">{data.confirmations.map(a => <li key={a.appointment_id}>
        <div><b>{a.patient}<span className="fd-badge is-late">{a.strikes} late cancellations or no-shows</span></b><span>{a.date}, {a.time} · {a.service} · {a.code}</span></div>
        <Button size="sm" disabled={busy === a.appointment_id} onClick={() => act(a.appointment_id, () => confirmAppointment(a.appointment_id, a.revision), 'Booking confirmed.')}>Confirm booking</Button>
      </li>)}</ul>
    </Card>}
  </div>
}
