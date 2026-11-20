import React from 'react'
import { Button, Icon } from '../../components.jsx'
import { patientHome } from '../../api-client.js'
import { dateLong, greeting, money, time12 } from '../format.js'
import { EmptyState, ErrorState, LoadingState, PageHead, Pill, useLoad } from '../ui.jsx'
import { JoinQueueCard } from '../../pages/JoinQueueCard.jsx'

export function HomePage({ me, onNavigate, session, getAuthGeneration }) {
  const patientId = session?.patientPublicId
  const generation = getAuthGeneration?.()
  const owns = () => session?.active && session?.role === 'patient' && patientId && me?.patient?.id === patientId &&
    (!getAuthGeneration || generation === getAuthGeneration())
  const summary = useLoad(async signal => {
    if (!owns()) return { ok: false, kind: 'stale_context', message: 'Sign in again to view your appointment and balance.' }
    const result = await patientHome(signal)
    const candidate = result.data?.appointment
    const invalid = result.ok && (result.data?.patient_id !== patientId ||
      (candidate !== null && (!candidate?.id || !Number.isFinite(Date.parse(candidate.starts_at)))))
    if (!owns() || invalid) {
      return { ok: false, kind: 'stale_context', message: 'Your appointment and balance could not be verified.' }
    }
    return result
  }, [patientId, generation, getAuthGeneration])
  const { appointment: next, balance } = summary.data || {}
  const checkedIn = ['Checked In', 'In Treatment'].includes(next?.status)
  const date = next?.starts_at.slice(0, 10)
  const firstName = me?.first_name || me?.name?.split(' ')[0]
  return <div className="pp-page patient-home">
    <PageHead title={firstName ? `${greeting()}, ${firstName}` : 'Welcome'}
      actions={<Button icon="plusCalendar" onClick={() => onNavigate('book')}>Book appointment</Button>}/>
    <section aria-labelledby="patient-next-heading" className="patient-home-section">
      <h2 id="patient-next-heading">{checkedIn ? 'Current visit' : 'Next appointment'}</h2>
      {summary.loading && !summary.data && <LoadingState label="Loading your next appointment…"/>}
      {summary.error && <ErrorState text={summary.error} onRetry={summary.reload}/>}
      {summary.data && !next && <EmptyState icon="calendar" title="No upcoming appointments" text="Your next booking will appear here."/>}
      {next && <article className="patient-next-visit">
        <div className="patient-date-tile" aria-hidden="true">
          <strong>{Number(date.slice(8))}</strong>
          <span>{new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'Asia/Manila' }).format(new Date(next.starts_at))}</span>
        </div>
        <div className="patient-next-copy">
          <div className="patient-next-title"><h3>{next.service}</h3><Pill>{next.status}</Pill></div>
          <p><Icon name="pin" size={16}/>{next.branch}</p>
          <p><Icon name="clock" size={16}/><time dateTime={next.starts_at}>{dateLong(date)} · {time12(next.starts_at.slice(11, 16))}</time></p>
          {next.dentist && <p>Dentist · {next.dentist}</p>}
          {next.booking_payment_status === 'paid' && <p>Booking payment verified</p>}
          {next.booking_payment_status === 'unpaid' && <p>Booking fee unpaid</p>}
          {next.patient && next.patient !== me?.name && <p>For {next.patient}</p>}
          {next.status === 'Pending' && <p>{next.booking_payment_status === 'held' ? 'Payment verification pending.' : 'Awaiting confirmation from the front desk.'}</p>}
        </div>
        <Button variant="soft" icon="arrow" onClick={() => onNavigate('visits', { appointmentId: next.id })}>View appointment</Button>
      </article>}
      {summary.data?.more_upcoming && <Button variant="ghost" onClick={() => onNavigate('visits')}>More upcoming appointments</Button>}
    </section>
    {balance?.count > 0 && <section className="patient-attention" aria-labelledby="patient-attention-title">
      <h2 id="patient-attention-title">Needs attention</h2>
      <div className="patient-home-balance">
        <Icon name="receipt" size={20}/>
        <div><h3>Payment due</h3><p><strong className="patient-number">{money(balance.minor / 100)}</strong> across {balance.count} {balance.count === 1 ? 'invoice' : 'invoices'}</p></div>
        <Button variant="soft" onClick={() => onNavigate('billing')}>Review billing</Button>
      </div>
    </section>}
    <JoinQueueCard/>
  </div>
}
