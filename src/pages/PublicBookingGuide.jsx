import React, { useId, useState } from 'react'
import { clinic } from '../clinic-config.js'
import { Icon } from '../components.jsx'

// Match the four steps in the signed-in patient booking flow.
const STEPS = [
  { title: 'Choose a service', detail: 'See which services start with a consultation.' },
  { title: 'Choose a branch', detail: 'Compare branches offering the service.' },
  { title: 'Pick a date and time', detail: 'Choose a day, then an available time.' },
  { title: 'Review and confirm', detail: 'Check your visit and payment options.' },
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SAMPLE_DAYS = Array.from({ length: 14 }, (_, i) => i + 1)

export function PublicBookingGuide() {
  const [step, setStep] = useState(0)
  const previewId = useId()

  return <section id="how-it-works" className="lp-section lp-walkthrough" aria-labelledby="lp-how-title" tabIndex={-1}>
    <div className="lp-container lp-walkthrough-grid">
      <div>
        <div className="lp-heading">
          <p className="lp-section-label">How it works</p>
          <h2 id="lp-how-title">From planning to booking.</h2>
          <p>Choose a step to see how booking works in the patient portal.</p>
        </div>
        <ol className="lp-steps" aria-label="Booking walkthrough">
          {STEPS.map(({ title, detail }, i) => <li key={title}>
            <button type="button" aria-pressed={step === i} aria-controls={previewId} onClick={() => setStep(i)}>
              <span className="lp-step-node" aria-hidden="true"/>
              <span className="lp-step-copy"><strong>{title}</strong><span>{detail}</span></span>
            </button>
          </li>)}
        </ol>
      </div>
      <figure className="lp-book-preview">
        <figcaption>
          <img src={clinic.logo} width="32" height="32" alt=""/>
          <span><strong>Patient portal</strong><small>Booking preview</small></span>
          <span className="lp-preview-count">Step {step + 1} of {STEPS.length}</span>
        </figcaption>
        <div className="lp-preview-progress" aria-hidden="true"><span style={{ width: `${(step + 1) / STEPS.length * 100}%` }}/></div>
        <div id={previewId} className="lp-preview-paper">
          <div key={step} className="lp-preview-stage">
            <h3>{STEPS[step].title}</h3>
            <BookingIllustration step={step}/>
          </div>
        </div>
        <div className="lp-preview-footer">
          <a href="#create-account" className="lp-link">Book a visit<Icon name="arrow" size={16}/></a>
        </div>
      </figure>
    </div>
  </section>
}

function PreviewRow({ icon, title, detail }) {
  return <li className="lp-preview-row">
    <span className="lp-preview-icon"><Icon name={icon} size={19}/></span>
    <span><strong>{title}</strong><small>{detail}</small></span>
    <Icon name="chevron" size={15}/>
  </li>
}

function BookingIllustration({ step }) {
  switch (step) {
    case 0:
      return <>
        <div className="lp-preview-search"><Icon name="search" size={17}/>Search by name or category</div>
        <ul className="lp-preview-list">
          <PreviewRow icon="tooth" title="Bookable services" detail="Browse the clinic’s service directory."/>
          <PreviewRow icon="message" title="Consultation first" detail="Some treatments begin with a consultation."/>
        </ul>
      </>
    case 1:
      return <>
        <div className="lp-preview-callout"><Icon name="pin" size={19}/><span><strong>Sort by distance</strong><small>Use your location if you choose.</small></span></div>
        <ul className="lp-preview-list">
          <PreviewRow icon="building" title="Compare branches" detail="Each listing shows the address and hours."/>
          <PreviewRow icon="clock" title="Earliest opening" detail="The portal checks openings for your selected service."/>
        </ul>
      </>
    case 2:
      return <div className="lp-preview-times">
        <div>
          <p className="lp-preview-calendar-label">Sample calendar</p>
          <div className="lp-preview-calendar" aria-hidden="true">
            {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
            {SAMPLE_DAYS.map(day => <b key={day} className={day === 8 ? 'is-example' : undefined}>{day}</b>)}
          </div>
        </div>
        <div className="lp-preview-time-note">
          <Icon name="clock" size={20}/>
          <strong>Choose a time</strong>
          <small>The portal shows time slots for the day you select.</small>
        </div>
      </div>
    default:
      return <>
        <ul className="lp-preview-list">
          <PreviewRow icon="calendar" title="Visit details" detail="Review the service, branch, date, and time."/>
          <PreviewRow icon="wallet" title="Payment option" detail="Check the payment choices before submitting."/>
        </ul>
        <p className="lp-preview-end"><Icon name="checkin" size={17}/>Confirm in the portal when ready.</p>
      </>
  }
}
