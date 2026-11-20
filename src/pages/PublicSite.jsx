import React, { useEffect, useId, useMemo, useState } from 'react'
import { Icon } from '../components.jsx'
import { clinic } from '../clinic-config.js'
import { hoursSummary, openStatus } from '../patient/format.js'
import { PublicFooter, PublicHeader } from './PublicChrome.jsx'
import { PublicBookingGuide } from './PublicBookingGuide.jsx'
import { LocationMap } from './PublicLocations.jsx'
import { hasClinicCoordinates } from '../clinic-map-options.js'
import { catalogEstimate, directionsUrl, telHref, usePublicData } from './public-data.js'
import { publicBookingLink } from '../page-link.js'
import { publicClosures, publicFaq } from '../api-client.js'

// The public landing page. Every clinic fact comes from the clinic server: the name and logo from the branding settings,
// branches (contacts and hours) from GET /api/public/branches, services from GET /api/public/services, and the FAQ from the
// assistant answers the clinic has confirmed (GET /api/public/faq). Product copy describes what the portal really does.
const CAPABILITIES = [
  ['calendar', 'Appointments', 'Book a visit or manage an existing appointment.'],
  ['message', 'Clinic messages', 'Contact the clinic front desk through the portal.'],
  ['receipt', 'Billing', 'View your invoices, receipts, and available payment options.'],
]

// Shown only until the clinic confirms its own answers (Administration → Assistant answers). Each line describes how the
// portal really works; no clinic fact (hours, prices, policies) is stated here.
const PORTAL_FAQ = [
  ['How do I create an account?', 'Choose “Create account”, fill in your details and the email you use. We send a 6-digit code to that email; enter it, then sign in with your email and password.'],
  ['How do I book a visit?', 'After signing in, choose “Book a visit”. Select a service, branch, date and time, then review your booking before submitting. Contact the front desk with questions about cancellations or refunds.'],
  ['How do I pay?', 'Check the payment options shown when you review your booking. After your visit, open Billing to see your invoice and available payment options.'],
  ['How do I message the clinic?', 'Open Messages in the portal and write to the front desk of your branch. They reply in the same conversation.'],
]

export function PublicSite({ children, onClick }) {
  return <div className="lp-site public-site lp-home" onClick={onClick}>
    <PublicHeader/>
    <main id="public-main" tabIndex={-1}>
      <Hero/>
      <div className="lp-lower">
        <Services/>
        <Branches/>
        <PublicBookingGuide/>
        <PortalCapabilities/>
        <Faq/>
        <VisitCallToAction/>
        <Emergency/>
      </div>
    </main>
    <PublicFooter/>
    {children}
  </div>
}

function Hero() {
  return <section id="home" className="lp-hero" aria-labelledby="lp-hero-title">
    <div className="lp-hero-media" aria-hidden="true">
      <img src="/images/drdana.bg.png" alt="" width="739" height="415" fetchPriority="high"/>
    </div>
    <div className="lp-container">
      <h1 id="lp-hero-title" tabIndex={-1}>Good care starts<br/>with people.</h1>
      <p className="lp-lead">Meet the team at Dr. Dana E. Roxas Dental Clinic, explore our services, and plan your next visit.</p>
      <div className="lp-cta">
        <a className="lp-btn lp-btn-primary" href="#create-account">Book a visit<Icon name="arrow" size={16}/></a>
        <a className="lp-link lp-hero-link" href="#branches">View locations</a>
      </div>
    </div>
  </section>
}

function Services() {
  const { status, rows, reload } = usePublicData('services')
  const [category, setCategory] = useState('')
  const [retried, setRetried] = useState(false)
  const categories = useMemo(() => [...new Set(rows.map(s => s.category || 'Other'))], [rows])
  const selected = categories.includes(category) ? category : ''
  const shown = rows.filter(s => !selected || (s.category || 'Other') === selected)
  const hasServices = status === 'ready' && rows.length > 0
  return <section id="services" className="lp-section lp-services" aria-labelledby="lp-services-title" tabIndex={-1}>
    <div className={`lp-container lp-services-inner${hasServices ? ' has-directory' : ''}`}>
      <div className="lp-heading">
        <h2 id="lp-services-title">Dental services</h2>
        <p>Explore services offered for online booking. Some visits begin with a consultation.</p>
      </div>
      <div className="lp-directory">
        {status === 'loading' && !retried && <div className="lp-service-loading" role="status">
          <span className="sr-only">Loading services…</span>
          {[0, 1, 2].map(row => <span key={row} aria-hidden="true"/>)}
        </div>}
        {(status === 'error' || (status === 'loading' && retried)) && <div className="lp-service-state">
          <div>
            <p role="status">{status === 'error' ? 'Services are temporarily unavailable.' : 'Loading services…'}</p>
            {status === 'error' && <a className="lp-link lp-service-help" href={telHref(clinic.phoneDisplay)}>Call the clinic for help choosing a service</a>}
          </div>
          <button type="button" className="lp-retry" aria-disabled={status === 'loading'} onClick={() => {
            if (status === 'loading') return
            setRetried(true)
            reload()
          }}>{status === 'loading' ? 'Retrying…' : 'Retry'}</button>
        </div>}
        {status === 'ready' && !rows.length && <p className="lp-service-state" role="status">No services are listed yet.</p>}
        {categories.length > 1 && <label className="lp-catalog-filter">Service category
          <select value={selected} onChange={event => setCategory(event.target.value)}>
            <option value="">All services</option>
            {categories.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>}
        {status === 'ready' && shown.length > 0 && <ul className="lp-service-list">{shown.map(s => <li key={s.id} className="lp-service">
          <div><h3>{s.name}</h3>{s.category && <p className="lp-muted">{s.category}</p>}
            {catalogEstimate(s.price) && <p><strong>{catalogEstimate(s.price)}</strong> <span className="lp-muted">· Development estimate</span></p>}</div>
          <div>{s.description && <p>{s.description}</p>}{s.duration_minutes > 0 && <p className="lp-muted">About {s.duration_minutes} minutes</p>}</div>
          <a className="lp-link" href={publicBookingLink({service: s.id})} aria-label={`${s.starts_with_consultation ? 'Book a consultation for' : 'Book'} ${s.name}`}>{s.starts_with_consultation ? 'Book a consultation' : 'Book appointment'} <Icon name="arrow" size={16}/></a>
        </li>)}</ul>}
      </div>
    </div>
  </section>
}

export function BranchCard({ branch, now, onSelect }) {
  const weekly = branch.weeklyHours && Object.values(branch.weeklyHours).some(Boolean) ? branch.weeklyHours : null
  const status = openStatus(weekly, now)
  return <li className="lp-branch">
    <div className="lp-branch-head">{branch.number && hasClinicCoordinates(branch) &&
      <span className="lp-branch-number"><span className="sr-only">Map marker </span>{branch.number}</span>}
      <div><h3>{branch.name}</h3>{status.label && <span className={`lp-status ${status.open ? 'is-open' : 'is-closed'}`}>{status.label}</span>}</div></div>
    <address>
      <span><Icon name="pin" size={16}/>{branch.address}</span>
      {branch.phone && <a href={telHref(branch.phone)}><Icon name="phone" size={16}/>{branch.phone}</a>}
      {branch.email && <a href={`mailto:${branch.email}`}><Icon name="mail" size={16}/>{branch.email}</a>}
    </address>
    <p className="lp-hours"><Icon name="clock" size={16}/><span>{weekly ? hoursSummary(weekly) : 'Hours to be confirmed by the clinic'}</span></p>
    {branch.services?.length > 0 && <details><summary>{branch.developmentCatalog ? 'Development service catalog' : 'Services at this branch'} ({branch.services.length})</summary>
      {branch.developmentCatalog && <p>Clinic service availability is awaiting confirmation.</p>}
      <ul>{branch.services.map(service => <li key={service.id}><a href={publicBookingLink({service: service.id, branch: branch.id})}>{service.name}</a></li>)}</ul>
    </details>}
    <a className="lp-link" href={publicBookingLink({branch: branch.id})}>{weekly ? 'Book at this clinic' : 'Request a visit'}<Icon name="arrow" size={16}/></a>
    {onSelect && hasClinicCoordinates(branch) && <button type="button" className="lp-retry" onClick={() => onSelect(branch.id)}>Show {branch.name} on the map</button>}
    <a className="lp-link" href={directionsUrl(branch)} target="_blank" rel="noreferrer">Get directions<span className="sr-only"> to {branch.name} (opens Google Maps)</span><Icon name="arrow" size={16}/></a>
  </li>
}

function Branches() {
  const { status, rows, reload } = usePublicData('branches')
  const [selected, setSelected] = useState(null)
  const currentBranch = rows.find(branch => branch.id === selected) ?? rows[0]
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])
  return <section id="branches" className="lp-section lp-branches" aria-labelledby="lp-branches-title" tabIndex={-1}>
    <div className="lp-container">
      <div className="lp-heading lp-location-heading">
        <div>
          <p className="lp-section-label">Our locations</p>
          <h2 id="lp-branches-title">Find your nearest clinic.</h2>
        </div>
        <p>Select a clinic to see opening hours, contact details and directions.</p>
      </div>
      <div className={`lp-location-layout${rows.length ? ' has-branches' : ''}`}>
        {status === 'loading' && !rows.length && <p role="status" className="lp-branch-loading">Loading clinic locations…</p>}
        {currentBranch && <div className="lp-branch-directory">
          <div className="lp-branch-picker" role="group" aria-label="Choose a clinic">
            {rows.map(branch => <button type="button" key={branch.id} aria-pressed={currentBranch.id === branch.id} onClick={() => setSelected(branch.id)}><span>{branch.name}</span>{currentBranch.id === branch.id && <Icon name="check" size={18}/>}</button>)}
          </div>
          <ul className="lp-branch-list"><BranchCard branch={currentBranch} now={now}/></ul>
        </div>}
        <LocationMap branches={rows} branchStatus={status} reload={reload} selectedBranch={selected} onSelectBranch={setSelected}/>
      </div>
      <UpcomingClosures/>
    </div>
  </section>
}

/** F5 (R2-13): the closures the Owner confirmed in the next 60 days. Hidden when there are none. */
function UpcomingClosures() {
  const [rows, setRows] = useState([])
  useEffect(() => { publicClosures().then(r => { if (r.ok) setRows(r.data || []) }) }, [])
  if (!rows.length) return null
  const day = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return <div className="lp-closures" role="region" aria-label="Upcoming closures">
    <h3><Icon name="calendar" size={18}/> Upcoming closures</h3>
    <ul>{rows.map(c => <li key={c.id}><b>{day(c.date)}</b> · {c.branch?.name || 'All branches'}{c.partial_hours ? ` · open ${c.partial_hours.open}–${c.partial_hours.close} only` : ' · closed'}{c.reason ? ` · ${c.reason}` : ''}</li>)}</ul>
  </div>
}

function PortalCapabilities() {
  return <section id="features" className="lp-section lp-features" aria-labelledby="lp-features-title">
    <div className="lp-container lp-capabilities-layout">
      <div className="lp-heading">
        <p className="lp-section-label">Patient portal</p>
        <h2 id="lp-features-title">Your visits, in one place.</h2>
        <a href="#sign-in" className="lp-link">Sign in to the patient portal<Icon name="arrow" size={16}/></a>
      </div>
      <dl className="lp-capabilities">{CAPABILITIES.map(([icon, title, text]) => <div key={title}>
        <dt><Icon name={icon} size={18}/>{title}</dt><dd>{text}</dd>
      </div>)}</dl>
    </div>
  </section>
}

function Faq() {
  const { status, rows } = usePublicData('faq')
  const [extra, setExtra] = useState({ policy: null, hmos: [] })
  const [selection, setSelection] = useState(undefined)
  useEffect(() => { publicFaq().then(r => { if (r.ok) setExtra({ policy: r.meta?.cancellation_policy || null, hmos: r.meta?.accepted_hmos || [] }) }) }, [])
  // F4 and F8: the cancellation policy as the Owner set it, and only the HMOs the clinic verified.
  const items = [...(status === 'ready' && rows.length ? rows.map(r => [`clinic-${r.id ?? r.question}`, r.question, r.answer]) : PORTAL_FAQ.map(([q, a], i) => [`portal-${i}`, q, a])),
    ...(extra.policy ? [['policy', 'Can I cancel or reschedule?', extra.policy]] : []),
    ...(extra.hmos.length ? [['hmos', 'Which HMOs does the clinic accept?', `${extra.hmos.map(h => h.name + (h.branch ? ` (${h.branch})` : '') + (h.note ? `, ${h.note}` : '')).join('; ')}. Coverage is checked at the clinic.`]] : [])]
  const first = items[0]?.[0]
  const active = selection === undefined ? first : selection
  return <section id="faq" className="lp-section lp-faq-section" aria-labelledby="lp-faq-title" tabIndex={-1}>
    <div className="lp-container lp-faq-content">
      <div className="lp-heading"><p className="lp-section-label">Questions &amp; answers</p><h2 id="lp-faq-title">Good to know.</h2></div>
      <div className="lp-faq">{items.map(([key, question, answer]) =>
        <FaqItem key={key} question={question} answer={answer} open={active === key}
          onToggle={() => setSelection(previous => (previous === undefined ? first : previous) === key ? null : key)}/>
      )}</div>
    </div>
  </section>
}

function FaqItem({ question, answer, open, onToggle }) {
  const id = useId()
  const labelId = `${id}-question`
  const answerId = `${id}-answer`
  return <div className="lp-faq-item">
    <h3><button type="button" id={labelId} aria-expanded={open} aria-controls={answerId} onClick={onToggle}>
      {question}<Icon name="chevron" size={18}/>
    </button></h3>
    <div id={answerId} className="lp-faq-answer" aria-labelledby={labelId} aria-hidden={!open} role="region">
      <div><p>{answer}</p></div>
    </div>
  </div>
}

function VisitCallToAction() {
  return <section className="lp-visit-cta" aria-labelledby="lp-visit-cta-title">
    <div className="lp-container lp-visit-cta-inner">
      <div>
        <h2 id="lp-visit-cta-title">Planning your next visit?</h2>
        <p>Explore our services and clinic locations before you book.</p>
      </div>
      <div className="lp-visit-actions">
        <a className="lp-btn lp-btn-primary" href="#create-account">Book a visit<Icon name="arrow" size={16}/></a>
        <a className="lp-link" href="#branches">View locations</a>
      </div>
    </div>
  </section>
}

function Emergency() {
  const { rows } = usePublicData('branches')
  const phones = rows.filter(b => b.phone)
  return <section className="lp-emergency" aria-labelledby="lp-emergency-title">
    <div className="lp-container lp-emergency-inner">
      <Icon name="alert" size={24}/>
      <div>
        <h2 id="lp-emergency-title">In an emergency</h2>
        <p>If you have severe pain, swelling, bleeding or an injury, call the clinic or go to the nearest emergency room.</p>
        <p className="lp-emergency-phones">{phones.length
          ? phones.map(b => <a key={b.id} href={telHref(b.phone)}><b>{b.name}</b> {b.phone}</a>)
          : <a href={telHref(clinic.phoneDisplay)}><b>{clinic.name}</b> {clinic.phoneDisplay}</a>}</p>
      </div>
    </div>
  </section>
}
