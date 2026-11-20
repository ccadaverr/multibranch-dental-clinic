import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../components.jsx'
import { clinic } from '../clinic-config.js'
import { hoursSummary } from '../patient/format.js'
import { telHref, usePublicData } from './public-data.js'

// Anchor links of the landing page. The ids are the landing sections (PublicSite.jsx).
export const publicLinks = [['services', 'Services'], ['branches', 'Branches'], ['how-it-works', 'How it works'], ['faq', 'FAQ']]

/** The clinic logo and name, both from the Owner's branding settings (fallback: clinic-config). */
export function SiteBrand() {
  return <span className="lp-brand"><img src={clinic.logo} alt="" width="40" height="40"/><span className="lp-brand-text"><strong>{clinic.nameLine}</strong><span>{clinic.subtitle}</span></span></span>
}

export function PublicHeader() {
  const [open, setOpen] = useState(false)
  const [surface, setSurface] = useState('photo')
  const [section, setSection] = useState('')
  const toggle = useRef(null), header = useRef(null)
  const close = (focus = false) => { setOpen(false); if (focus) toggle.current?.focus() }
  useEffect(() => {
    const onScroll = () => {
      const headerHeight = header.current?.offsetHeight || 0
      const line = headerHeight + 32
      const heroEnd = document.getElementById('home')?.getBoundingClientRect().bottom
      const dark = Array.from(document.querySelectorAll('.lp-branches, .lp-emergency, .lp-home > .lp-footer')).some(element => {
        const { top, bottom } = element.getBoundingClientRect()
        return top <= headerHeight && bottom > headerHeight
      })
      setSurface(heroEnd == null || heroEnd > headerHeight ? 'photo' : dark ? 'dark' : 'light')
      const current = publicLinks.find(([id]) => {
        const bounds = document.getElementById(id)?.getBoundingClientRect()
        return bounds && bounds.top <= line && bounds.bottom > line
      })
      setSection(current?.[0] || '')
    }
    const onHash = () => { setOpen(false); onScroll() }
    const outside = event => { if (!header.current?.contains(event.target)) setOpen(false) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    window.addEventListener('hashchange', onHash)
    document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); window.removeEventListener('hashchange', onHash); document.removeEventListener('pointerdown', outside) }
  }, [])
  return <header ref={header} data-surface={surface} className={`lp-header${open ? ' is-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape' && open) close(true) }}>
    <a href="#public-main" className="lp-skip">Skip to content</a>
    <div className="lp-container lp-header-inner">
      <a className="lp-brand-link" href="#home" aria-label={`${clinic.name}, home`} onClick={() => close()}>
        <img className="lp-navbar-logo" src={clinic.logo} alt="" width="44" height="44"/>
      </a>
      <button ref={toggle} type="button" className="lp-menu-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="public-navigation" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'x' : 'menu'} size={20}/>
      </button>
      <nav id="public-navigation" className="lp-nav" aria-label="Main">
        <ul>{publicLinks.map(([id, label]) => <li key={id}><a href={`#${id}`} aria-current={section === id ? 'location' : undefined} onClick={() => {
          close()
          document.getElementById(id)?.focus({ preventScroll: true })
        }}>{label}</a></li>)}</ul>
        <div className="lp-mobile-account">
          <a className="lp-nav-sign-in" href="#sign-in" onClick={() => close()}>Sign in</a>
          <a className="lp-btn lp-btn-primary" href="#create-account" onClick={() => close()}>Create an account</a>
        </div>
      </nav>
      <div className="lp-nav-actions">
        <a className="lp-nav-sign-in" href="#sign-in">Sign in</a>
        <a className="lp-btn lp-btn-primary" href="#create-account">Create an account</a>
      </div>
    </div>
  </header>
}

export function PublicFooter() {
  const branches = usePublicData('branches')
  const year = new Date().getFullYear()
  return <footer className="lp-footer">
    <div className="lp-container lp-footer-grid">
      <div className="lp-footer-brand">
        <a href="#home" aria-label={`${clinic.name}, home`}><SiteBrand/></a>
      </div>
      <div className="lp-footer-contact">
        <h2>Clinic contact</h2>
        {branches.status === 'loading' && <p className="lp-muted">Loading…</p>}
        {branches.status !== 'loading' && !branches.rows.length && <p className="lp-muted">Call <a href={telHref(clinic.phoneDisplay)}>{clinic.phoneDisplay}</a> or email <a href={`mailto:${clinic.email}`}>{clinic.email}</a>.</p>}
        {branches.rows.length > 0 && <ul className="lp-footer-branches">{branches.rows.map(b => <li key={b.id}>
          <b>{b.name}</b>
          <span>{b.address}</span>
          {b.phone && <a href={telHref(b.phone)}>{b.phone}</a>}
          {b.email && <a href={`mailto:${b.email}`}>{b.email}</a>}
          {b.weeklyHours && Object.values(b.weeklyHours).some(Boolean) && <span className="lp-muted">{hoursSummary(b.weeklyHours)}</span>}
        </li>)}</ul>}
      </div>
      <nav aria-label="Explore the clinic">
        <h2>Explore</h2>
        <ul className="lp-footer-links">
          {publicLinks.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}
          <li><a href="#sign-in">Sign in</a></li>
          <li><a href="#create-account">Create an account</a></li>
        </ul>
      </nav>
      <nav aria-label="Privacy and terms">
        <h2>Privacy and terms</h2>
        <ul className="lp-footer-links"><li><a href="#privacy">Privacy Policy</a></li><li><a href="#terms">Terms of Use</a></li></ul>
      </nav>
    </div>
    <div className="lp-container lp-footer-bottom">
      <span>© {year} {clinic.name}</span>
      <span> · </span>
      <a href="#privacy">Your privacy rights under the Data Privacy Act of 2012 (RA 10173)</a>
    </div>
  </footer>
}
