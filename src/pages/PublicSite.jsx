import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components.jsx'
import { clinic } from '../clinic-config.js'
import { hoursSummary, openStatus } from '../patient/format.js'
import { PublicFooter, PublicHeader } from './PublicChrome.jsx'
import { LocationMap } from './PublicLocations.jsx'
import { directionsUrl, telHref, usePublicData } from './public-data.js'
import { publicClosures, publicFaq } from '../api-client.js'

// The public landing page. Every clinic fact comes from the clinic server: the name and logo from the branding settings,
// branches (contacts and hours) from GET /api/public/branches, services from GET /api/public/services, and the FAQ from the
// assistant answers the clinic has confirmed (GET /api/public/faq). Product copy describes what the portal really does.
// No statistics, testimonials, prices, partner logos or photos of people.

/** Reveal-on-scroll: only adds motion when the browser supports it and the visitor has not asked for reduced motion. */
function useReveal() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    const root = document.querySelector('.lp-site')
    root?.classList.add('lp-motion')
    const observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); observer.unobserve(e.target) } }), { rootMargin: '0px 0px -8% 0px' })
    root?.querySelectorAll('.lp-reveal').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  })
}

/** A calm illustration drawn for this project (own work, docs/CREDITS.md): a phone with a booking calendar and a message. */
function HeroIllustration() {
  return <svg className="lp-hero-art" viewBox="0 0 440 400" width="440" height="400" role="img" aria-label="Illustration of booking a dental visit on a phone">
    <defs>
      <linearGradient id="lpSky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eaf3fd"/><stop offset="1" stopColor="#eaf5f2"/></linearGradient>
      <linearGradient id="lpBrand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#1865ac"/><stop offset="1" stopColor="#0c9b8e"/></linearGradient>
    </defs>
    <circle cx="230" cy="200" r="178" fill="url(#lpSky)"/>
    <circle cx="370" cy="70" r="26" fill="#d9eef9"/><circle cx="70" cy="320" r="18" fill="#d6efe9"/>
    <rect x="140" y="40" width="170" height="320" rx="28" fill="#ffffff" stroke="#cfe0ec" strokeWidth="3"/>
    <rect x="156" y="66" width="138" height="34" rx="10" fill="url(#lpBrand)"/>
    <circle cx="176" cy="83" r="9" fill="#ffffff" opacity=".9"/><rect x="192" y="77" width="72" height="12" rx="6" fill="#ffffff" opacity=".85"/>
    {Array.from({ length: 4 }, (_, row) => Array.from({ length: 5 }, (_, col) => {
      const on = (row === 1 && col === 2) || (row === 2 && col === 3)
      return <rect key={`${row}-${col}`} x={160 + col * 26} y={116 + row * 26} width="20" height="20" rx="6" fill={on ? '#1865ac' : row === 3 && col > 2 ? '#f1f5f8' : '#eaf2fb'}/>
    }))}
    <rect x="160" y="226" width="130" height="30" rx="10" fill="#eaf5f2"/><rect x="172" y="237" width="64" height="8" rx="4" fill="#0c9b8e"/>
    <rect x="160" y="266" width="62" height="26" rx="9" fill="#ffffff" stroke="#cfe0ec" strokeWidth="2"/><rect x="228" y="266" width="62" height="26" rx="9" fill="#1865ac"/>
    <rect x="160" y="306" width="130" height="34" rx="12" fill="url(#lpBrand)"/><rect x="194" y="319" width="62" height="8" rx="4" fill="#ffffff"/>
    <g transform="translate(286 232)"><rect width="128" height="62" rx="18" fill="#ffffff" stroke="#cfe0ec" strokeWidth="3"/><rect x="16" y="18" width="80" height="8" rx="4" fill="#9fb8cc"/><rect x="16" y="34" width="56" height="8" rx="4" fill="#cfdde8"/><path d="M28 60 l-10 18 l26 -18z" fill="#ffffff"/></g>
    <g transform="translate(48 120)"><rect width="104" height="104" rx="26" fill="#ffffff" stroke="#cfe0ec" strokeWidth="3"/>
      <path d="M52 30c-9-7-27-6-29 9-1 9 3 16 6 24 3 9 3 19 9 19 5 0 5-12 9-12h10c4 0 4 12 9 12 6 0 6-10 9-19 3-8 7-15 6-24-2-15-20-16-29-9z" fill="#eaf3fd" stroke="#1865ac" strokeWidth="3.5" strokeLinejoin="round"/></g>
  </svg>
}

const STEPS = [
  ['user', 'Create your account', 'Sign up with your email. We send a 6-digit code to confirm it is yours.'],
  ['calendar', 'Book a visit', 'Choose a service, a branch near you and a time on the calendar. Only real open times are shown.'],
  ['wallet', 'Pay appointment fee', 'Choose to pay at the clinic when booking. Online booking payment is currently unavailable here.'],
  ['receipt', 'Visit & receipt', 'Complete your treatment at the clinic; any remaining balance is billed after your visit with an itemized payment receipt.'],
]

const FEATURES = [
  ['calendar', 'Online booking', 'Book, reschedule or cancel from your phone, with only the times that are really open.'],
  ['mail', 'Email updates', 'Your booking confirmation and any changes arrive in your inbox.'],
  ['lock', 'Secure messaging', 'Chat with the clinic front desk; only you and the clinic staff in your conversation can read it.'],
  ['wallet', 'Online payment with receipt', 'Pay securely through PayMongo and receive your receipt as a PDF by email.'],
]

// Shown only until the clinic confirms its own answers (Administration → Assistant answers). Each line describes how the
// portal really works; no clinic fact (hours, prices, policies) is stated here.
const PORTAL_FAQ = [
  ['How do I create an account?', 'Choose “Create account”, fill in your details and the email you use. We send a 6-digit code to that email; enter it, then sign in with your email and password.'],
  ['How do I book a visit?', 'After signing in, choose “Book a visit”, pick the service, a branch and a day on the calendar, then a time. Choose pay at the clinic before submitting. Online booking payment is currently unavailable here. Contact the front desk about cancellation and refund eligibility.'],
  ['How do I pay?', 'You can choose to pay at the clinic when booking. Online booking payment is currently unavailable here. After your visit, any remaining balance on your invoice can be paid online in Billing through PayMongo or in person at the clinic.'],
  ['How do I message the clinic?', 'Open Messages in the portal and write to the front desk of your branch. They reply in the same conversation.'],
]

export function PublicSite() {
  useReveal()
  return <div className="lp-site public-site">
    <PublicHeader/>
    <main id="public-main" tabIndex={-1}>
      <Hero/>
      <HowItWorks/>
      <Services/>
      <Branches/>
      <Features/>
      <Faq/>
      <Emergency/>
    </main>
    <PublicFooter/>
  </div>
}

function Hero() {
  return <section id="home" className="lp-hero" aria-labelledby="lp-hero-title">
    <div className="lp-container lp-hero-grid">
      <div className="lp-hero-copy">
        <p className="lp-eyebrow">Your next visit starts here</p>
        <h1 id="lp-hero-title">Dr. Dana E. Roxas <span>Dental Clinic</span></h1>
        <p className="lp-lead">Choose your care. Find your branch. Book a time that works for you.</p>
        <div className="lp-cta">
          <a className="lp-btn lp-btn-primary lp-btn-lg" href="#create-account"><Icon name="plusCalendar" size={20}/>Book a visit</a>
          <a className="lp-link" href="#branches"><Icon name="pin" size={20}/>See branches</a>
        </div>
        <p className="lp-hero-note"><Icon name="lock" size={16}/> Book online. Keep your visits, messages and payments together.</p>
      </div>
      <div className="lp-hero-visual"><HeroIllustration/></div>
    </div>
  </section>
}

function HowItWorks() {
  return <section id="how-it-works" className="lp-section" aria-labelledby="lp-how-title">
    <div className="lp-container">
      <div className="lp-heading lp-reveal"><p className="lp-eyebrow">How it works</p><h2 id="lp-how-title">From booking to receipt in four steps</h2></div>
      <ol className="lp-steps">{STEPS.map(([icon, title, text], i) => <li key={title} className="lp-card lp-step lp-reveal">
        <span className="lp-step-icon" aria-hidden="true"><Icon name={icon} size={22}/></span>
        <span className="lp-step-number">Step {i + 1}</span><h3>{title}</h3><p>{text}</p>
      </li>)}</ol>
    </div>
  </section>
}

function Services() {
  const { status, rows } = usePublicData('services')
  const [category, setCategory] = useState('')
  const categories = useMemo(() => [...new Set(rows.map(s => s.category || 'Other'))], [rows])
  const shown = rows.filter(s => !category || (s.category || 'Other') === category)
  return <section id="services" className="lp-section lp-tint" aria-labelledby="lp-services-title">
    <div className="lp-container">
      <div className="lp-heading lp-reveal"><p className="lp-eyebrow">Services</p><h2 id="lp-services-title">Find the care you need</h2><p>Some services start with a consultation. Your dentist confirms the next steps.</p></div>
      {status === 'loading' && <div className="lp-grid-3" role="status" aria-label="Loading services">{[0, 1, 2].map(i => <div key={i} className="lp-card lp-skeleton"><span/><span/><span/></div>)}</div>}
      {status === 'error' && <p className="lp-fallback">The list of services can’t be shown right now. Create an account to see what you can book, or call <a href={telHref(clinic.phoneDisplay)}>{clinic.phoneDisplay}</a>.</p>}
      {status === 'ready' && !rows.length && <p className="lp-fallback">No services are open for online booking yet. Please contact the clinic.</p>}
      {categories.length > 1 && <div className="lp-chips" role="group" aria-label="Filter services by category">
        {['', ...categories].map(c => <button key={c || 'all'} type="button" className={`lp-chip ${category === c ? 'is-active' : ''}`} aria-pressed={category === c} onClick={() => setCategory(c)}>{c || 'All'}</button>)}
      </div>}
      {status === 'ready' && <ul className="lp-grid-3">{shown.map(s => <li key={s.id} className="lp-card lp-service">
        <div className="lp-service-top"><span className="lp-tag">{s.category || 'Other'}</span></div>
        <h3>{s.name}</h3>
        {s.description && <p>{s.description}</p>}
        <p className="lp-muted"><Icon name="clock" size={14}/> About {s.duration_minutes} minutes</p>
        <a className="lp-link" href="#create-account" aria-label={`${s.starts_with_consultation ? 'Book a consultation for' : 'Book'} ${s.name}`}>{s.starts_with_consultation ? 'Start with a consultation' : 'Book this service'} <Icon name="arrow" size={16}/></a>
      </li>)}</ul>}
    </div>
  </section>
}

export function BranchCard({ branch, now }) {
  const status = openStatus(branch.weeklyHours, now)
  return <li className="lp-card lp-branch lp-reveal">
    <div className="lp-branch-head"><span className="lp-branch-number" aria-hidden="true">{branch.number}</span>
      <div><h3>{branch.name}</h3>{status.label && <span className={`lp-status ${status.open ? 'is-open' : 'is-closed'}`}>{status.label}</span>}</div></div>
    <address>
      <span><Icon name="pin" size={16}/>{branch.address}</span>
      {branch.phone && <a href={telHref(branch.phone)}><Icon name="phone" size={16}/>{branch.phone}</a>}
      {branch.email && <a href={`mailto:${branch.email}`}><Icon name="mail" size={16}/>{branch.email}</a>}
    </address>
    {branch.weeklyHours && <p className="lp-hours"><Icon name="clock" size={16}/><span>{hoursSummary(branch.weeklyHours)}</span></p>}
    <a className="lp-btn lp-btn-soft lp-btn-block" href={directionsUrl(branch)} target="_blank" rel="noreferrer">Get directions<span className="sr-only"> to {branch.name} (opens Google Maps)</span></a>
  </li>
}

function Branches() {
  const { status, rows } = usePublicData('branches')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])
  return <section id="branches" className="lp-section" aria-labelledby="lp-branches-title">
    <div className="lp-container">
      <div className="lp-heading lp-reveal"><p className="lp-eyebrow">Branches</p><h2 id="lp-branches-title">Find the branch near you</h2><p>Opening status is shown in Philippine time.</p></div>
      {status === 'loading' && <div className="lp-grid-3" role="status" aria-label="Loading branches">{[0, 1, 2].map(i => <div key={i} className="lp-card lp-skeleton"><span/><span/><span/></div>)}</div>}
      {status === 'error' && <p className="lp-fallback">Our branches can’t be shown right now. Call <a href={telHref(clinic.phoneDisplay)}>{clinic.phoneDisplay}</a> or email <a href={`mailto:${clinic.email}`}>{clinic.email}</a> and we’ll help you find the nearest clinic.</p>}
      {status === 'ready' && <ul className="lp-grid-3">{rows.map(b => <BranchCard key={b.id} branch={b} now={now}/>)}</ul>}
      <UpcomingClosures/>
      {status === 'ready' && rows.some(b => b.latitude != null) && <div className="lp-map lp-reveal"><LocationMap branches={rows}/></div>}
    </div>
  </section>
}

/** F5 (R2-13): the closures the Owner confirmed in the next 60 days. Hidden when there are none. */
function UpcomingClosures() {
  const [rows, setRows] = useState([])
  useEffect(() => { publicClosures().then(r => { if (r.ok) setRows(r.data || []) }) }, [])
  if (!rows.length) return null
  const day = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return <div className="lp-card lp-closures lp-reveal" role="region" aria-label="Upcoming closures">
    <h3><Icon name="calendar" size={18}/> Upcoming closures</h3>
    <ul>{rows.map(c => <li key={c.id}><b>{day(c.date)}</b> · {c.branch?.name || 'All branches'}{c.partial_hours ? ` · open ${c.partial_hours.open}–${c.partial_hours.close} only` : ' · closed'}{c.reason ? ` · ${c.reason}` : ''}</li>)}</ul>
  </div>
}

function Features() {
  return <section id="features" className="lp-section lp-tint" aria-labelledby="lp-features-title">
    <div className="lp-container">
      <div className="lp-heading lp-reveal"><p className="lp-eyebrow">Why patients like it</p><h2 id="lp-features-title">Everything for your visit, in your pocket</h2></div>
      <ul className="lp-grid-4">{FEATURES.map(([icon, title, text]) => <li key={title} className="lp-card lp-feature lp-reveal">
        <span className="lp-step-icon" aria-hidden="true"><Icon name={icon} size={22}/></span><h3>{title}</h3><p>{text}</p>
      </li>)}</ul>
    </div>
  </section>
}

function Faq() {
  const { status, rows } = usePublicData('faq')
  const [extra, setExtra] = useState({ policy: null, hmos: [] })
  useEffect(() => { publicFaq().then(r => { if (r.ok) setExtra({ policy: r.meta?.cancellation_policy || null, hmos: r.meta?.accepted_hmos || [] }) }) }, [])
  // F4 and F8: the cancellation policy as the Owner set it, and only the HMOs the clinic verified.
  const items = [...(status === 'ready' && rows.length ? rows.map(r => [r.question, r.answer]) : PORTAL_FAQ),
    ...(extra.policy ? [['Can I cancel or reschedule?', extra.policy]] : []),
    ...(extra.hmos.length ? [['Which HMOs does the clinic accept?', `${extra.hmos.map(h => h.name + (h.branch ? ` (${h.branch})` : '') + (h.note ? `, ${h.note}` : '')).join('; ')}. Coverage is checked at the clinic.`]] : [])]
  return <section id="faq" className="lp-section" aria-labelledby="lp-faq-title">
    <div className="lp-container lp-narrow">
      <div className="lp-heading lp-reveal"><p className="lp-eyebrow">FAQ</p><h2 id="lp-faq-title">Questions patients ask</h2></div>
      <div className="lp-faq">{items.map(([q, a], i) => <details key={q} className="lp-card lp-reveal" open={i === 0}>
        <summary><span>{q}</span><Icon name="chevron" size={18}/></summary><p>{a}</p>
      </details>)}</div>
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
