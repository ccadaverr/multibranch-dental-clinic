import { loadActiveAppointments } from '../visit-history.js'
import React from 'react'
import { Button, Icon } from '../../components.jsx'
import { listAppointments, myBillingInvoices } from '../../api-client.js'
import { dateLong, greeting, money, splitAppointments, time12, todayManila } from '../format.js'
import { EmptyState, ErrorState, Pill, Skeleton, useLoad } from '../ui.jsx'
import { JoinQueueCard } from '../../pages/JoinQueueCard.jsx'

const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** Home: the next visit and money owed, both from the clinic server. A new Patient sees a welcome, never sample data. */
export function HomePage({ me, onNavigate }) {
  const today = todayManila()
  const visits = useLoad(() => loadActiveAppointments(listAppointments, { firstOnly: true }), [today])
  const invoices = useLoad(() => myBillingInvoices({ per_page: 25 }), [])
  const first = (me?.first_name || me?.name || '').split(' ')[0]
  const { upcoming } = splitAppointments(visits.data)
  const next = upcoming[0]
  const due = (invoices.data || []).filter(i => i.status === 'Issued' && Number(i.balance) > 0)
  const balance = due.reduce((sum, i) => sum + Number(i.balance), 0)
  const noUpcoming = visits.status === 'ready' && !upcoming.length

  return <div className="pp-page pp-home">
    <header className="pp-hello pp-fade"><p className="pp-eyebrow">{greeting()}</p><h1>{first ? `Hi, ${first}` : 'Welcome'}</h1></header>

    <JoinQueueCard/>
    {visits.status === 'loading' && <Skeleton lines={4} label="Loading your next visit"/>}
    {visits.status === 'error' && <ErrorState text={visits.error} onRetry={visits.reload}/>}
    {noUpcoming && <EmptyState icon="calendar" title="No upcoming visits" text="Choose a service, branch and available time. Online booking payment is currently unavailable here; you can choose to pay at the clinic. Your full history is in My visits.">
      <Button icon="plusCalendar" onClick={() => onNavigate('book')}>Book a visit</Button>
    </EmptyState>}
    {visits.status === 'ready' && next && <section className="pp-card pp-next pp-fade" aria-labelledby="pp-next-title">
      <p className="pp-eyebrow" id="pp-next-title">Your next visit</p>
      <h2>{dateLong(next.date)} · {time12(next.start_time)}</h2>
      <p className="pp-next-what">{next.service?.name}{next.dentist?.name ? ` with ${next.dentist.name}` : ''}</p>
      <p className="pp-next-where"><Icon name="pin" size={16}/> {next.branch?.name} <Pill>{next.status}</Pill></p>
      <div className="pp-actions"><Button onClick={() => onNavigate('visits', { appointmentId: next.id })}>View details</Button></div>
    </section>}
    {invoices.status === 'ready' && due.length > 0 && <button type="button" className="pp-card pp-due pp-fade pp-press" onClick={() => onNavigate('billing')}>
      <span className="pp-option-icon" aria-hidden="true"><Icon name="wallet" size={20}/></span>
      <span className="pp-option-body"><b>{money(balance)} to pay</b><small>{due.length === 1 ? '1 invoice' : `${due.length} invoices`} · pay online in Billing</small></span>
      <Icon name="chevron" size={18}/>
    </button>}
    {invoices.status === 'error' && <ErrorState text={invoices.error} onRetry={invoices.reload}/>}

    <nav className="pp-quick" aria-label="Shortcuts">
      {[['book', 'plusCalendar', 'Book a visit', 'Real open times'], ['visits', 'calendar', 'My visits', 'Upcoming and past'], ['billing', 'receipt', 'Billing', 'Invoices and receipts'], ['messages', 'message', 'Messages', 'Ask the front desk']]
        .map(([page, icon, label, hint]) => <button key={page} type="button" className="pp-quick-item pp-press" onClick={() => onNavigate(page)}>
          <span className="pp-option-icon" aria-hidden="true"><Icon name={icon} size={20}/></span><span><b>{label}</b><small>{hint}</small></span>
        </button>)}
    </nav>
  </div>
}
