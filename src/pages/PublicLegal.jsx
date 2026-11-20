import React, { useEffect } from 'react'
import { clinic } from '../clinic-config.js'
import { PublicFooter, PublicHeader } from './PublicChrome.jsx'

// Privacy Policy and Terms of Use. DRAFT text written from what the system really does; the clinic (and its Data Protection
// Officer) must confirm it before go-live — listed in docs/defense/OPEN_ITEMS.md. Decisions the clinic has not made yet are
// said to be open, never invented.
const PRIVACY = [
  ['What we collect', [
    'Your account details: name, date of birth, email, mobile number, and the password you choose (stored only as a secure hash).',
    'Your visits: appointments, check-ins, treatments recorded by the dentist, invoices, payments and receipts.',
    'What you send us: messages to the front desk and documents you upload.',
    'If you allow it in your browser, your location once when you book, to suggest the nearest branch. It is not saved.',
  ]],
  ['Why we use it', [
    'To book and manage your visits, keep your dental records, bill you, send your receipts, and answer your messages.',
    'To send you emails about your account and visits: sign-up codes, confirmations, changes, invoices and receipts.',
  ]],
  ['Who can see it', [
    'Access is limited by role: front-desk staff for their branches, your dentist for your care, and the clinic owner for running the clinic. Every change to records and payments is logged.',
    'Messages are seen only by you and the clinic staff in your conversation.',
    'Service providers that help us: PayMongo processes online payments (your card or e-wallet details are entered on PayMongo, never on our site), and our email provider delivers our emails.',
    'The Clinic Assistant answers from the clinic’s own information on our server; what you type is not sent to any outside service.',
  ]],
  ['How long we keep it', ['Retention periods are to be confirmed by the clinic.']],
  ['Your rights under the Data Privacy Act of 2012 (RA 10173)', [
    'You may ask to see, correct, or delete your personal information, object to its use, and file a complaint with the National Privacy Commission.',
    'To use these rights, contact the clinic (below). The clinic’s Data Protection Officer is to be named by the clinic.',
  ]],
]

const TERMS = [
  ['Your account', [
    'Use your own email and keep your password private. You sign in only after confirming your email with the 6-digit code we send.',
    'You can update your account name in Profile. The clinic records the change in its audit history. To correct clinical records, contact the front desk.',
  ]],
  ['Booking', [
    'Only available times are offered. Your booking review shows the available payment choices and any amount due. Depending on the service and available payment methods, an online payment may be required before confirmation.',
    'Cancellation and late-arrival rules are to be confirmed by the clinic.',
  ]],
  ['Payments', [
    'When online booking payment is available, PayMongo handles the checkout. After your visit, the clinic issues an invoice reflecting any verified booking payment. Available invoice payment methods are shown in Billing; payment status follows the clinic’s verified records.',
  ]],
  ['Messages and the Clinic Assistant', [
    'Messages are not for emergencies. In an emergency, call the clinic or go to the nearest emergency room.',
    'The Clinic Assistant gives general information about the clinic and your account. It does not give medical advice or diagnoses.',
  ]],
]

export function PublicLegal({ kind }) {
  const privacy = kind === 'privacy'
  const sections = privacy ? PRIVACY : TERMS
  useEffect(() => { if (typeof document !== 'undefined') document.title = `${privacy ? 'Privacy Policy' : 'Terms of Use'} · ${clinic.name}` }, [privacy])
  return <div className="lp-site public-site">
    <PublicHeader/>
    <main id="public-main" tabIndex={-1} className="lp-section">
      <article className="lp-container lp-narrow lp-legal">
        <p className="lp-eyebrow">{clinic.name}</p>
        <h1>{privacy ? 'Privacy Policy' : 'Terms of Use'}</h1>
        <p className="lp-draft" role="note"><b>Draft — to be confirmed by the clinic.</b> This text describes how the patient portal works today. The clinic will review it before it takes effect.</p>
        {sections.map(([title, lines]) => <section key={title}><h2>{title}</h2><ul>{lines.map(line => <li key={line}>{line}</li>)}</ul></section>)}
        <section><h2>Contact</h2><p>{clinic.name}: <a href={`tel:${clinic.phoneE164}`}>{clinic.phoneDisplay}</a> · <a href={`mailto:${clinic.email}`}>{clinic.email}</a></p></section>
        <p><a href={privacy ? '#terms' : '#privacy'}>{privacy ? 'Read the Terms of Use' : 'Read the Privacy Policy'}</a> · <a href="#home">Back to the clinic website</a></p>
      </article>
    </main>
    <PublicFooter/>
  </div>
}
