import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ConfirmDialog, Icon } from '../components.jsx'
import { Brand } from '../Brand.jsx'
import { listNotifications, readAllNotifications, readNotification } from '../api-client.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { ChunkBoundary, StartupLoading } from '../StartupLoading.jsx'
import { AssistantLauncher } from './Assistant.jsx'
import { initials } from './format.js'
import { HomePage } from './pages/Home.jsx'

const BookPage = lazy(() => import('./pages/Book.jsx').then(m => ({ default: m.BookPage })))
const VisitsPage = lazy(() => import('./pages/Visits.jsx').then(m => ({ default: m.VisitsPage })))
const BillingPage = lazy(() => import('./pages/Billing.jsx').then(m => ({ default: m.BillingPage })))
const ProfilePage = lazy(() => import('./pages/Account.jsx').then(m => ({ default: m.ProfilePage })))
const SecurityPage = lazy(() => import('./pages/Account.jsx').then(m => ({ default: m.SecurityPage })))
const ServerMessagesPage = lazy(() => import('../pages/ServerMessages.jsx').then(m => ({ default: m.ServerMessagesPage })))
const ArchivesPage = lazy(() => import('./pages/Archives.jsx').then(m => ({ default: m.ArchivesPage })))
const PrescriptionsPage = lazy(() => import('./pages/Prescriptions.jsx').then(m => ({ default: m.PrescriptionsPage })))
const TeethPage = lazy(() => import('./pages/Teeth.jsx').then(m => ({ default: m.TeethPage })))
const FamilyPage = lazy(() => import('./pages/Family.jsx').then(m => ({ default: m.FamilyPage })))
const PatientMePage = lazy(() => import('../pages/PatientMe.jsx').then(m => ({ default: m.PatientMePage })))

// Only screens backed by real clinic-server data (decision 5): no HMO, prescriptions, loyalty or follow-up placeholders.
const NAV = [['home', 'home', 'Home'], ['book', 'plusCalendar', 'Book a visit'], ['visits', 'calendar', 'My visits'], ['messages', 'message', 'Messages'], ['billing', 'receipt', 'Billing'], ['prescriptions', 'file', 'Prescriptions'], ['teeth', 'star', 'My teeth'], ['archives', 'archive', 'Historical records'], ['documents', 'file', 'Documents']]
export const NAV_SECTIONS = [
  {
    title: null,
    items: [
      ['home', 'home', 'Home'],
    ],
  },
  {
    title: 'Appointments & Care',
    items: [
      ['book', 'plusCalendar', 'Book a visit'],
      ['visits', 'calendar', 'My visits'],
      ['messages', 'message', 'Messages'],
    ],
  },
  {
    title: 'Records & Billing',
    items: [
      ['billing', 'receipt', 'Billing'],
      ['prescriptions', 'file', 'Prescriptions'],
      ['teeth', 'star', 'My teeth'],
      ['archives', 'archive', 'Historical records'],
      ['documents', 'file', 'Documents'],
    ],
  },
]
const PHONE_NAV = [['home', 'home', 'Home'], ['book', 'plusCalendar', 'Book'], ['visits', 'calendar', 'Visits'], ['messages', 'message', 'Messages'], ['more', 'menu', 'More']]
const TITLES = { home: 'Home', book: 'Book a visit', visits: 'My visits', messages: 'Messages', billing: 'Billing', prescriptions: 'Prescriptions', teeth: 'My teeth', archives: 'Historical records', documents: 'Documents', profile: 'Profile', family: 'Family', security: 'Account security' }
export const PORTAL_PAGES = Object.keys(TITLES)

/** The portal page named in the address (#p/visits), so a reload stays on the same page. */
export function portalPageFromHash(hash = typeof window !== 'undefined' ? window.location.hash : '') {
  const m = /^#p\/([a-z]+)$/.exec(hash || '')
  return m && PORTAL_PAGES.includes(m[1]) ? m[1] : null
}

/** The Patient portal: server data only. `store` is used only for toasts and the reused Messages/Feedback/Documents screens. */
export function PatientPortal({ me, store, initialPage = 'home', initialContext = null, onLogout, onSignedOut }) {
  const [page, setPage] = useState(() => portalPageFromHash() || (initialContext?.appointmentId ? 'visits' : (PORTAL_PAGES.includes(initialPage) ? initialPage : 'home')))
  const [context, setContext] = useState(initialContext)
  const [visit, setVisit] = useState(0) // remounts a page when it is opened again with new context
  const [menu, setMenu] = useState(false), [more, setMore] = useState(false), [bell, setBell] = useState(false), [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [avatar, setAvatar] = useState(() => {
    try { return localStorage.getItem(`patient_avatar_${me?.patient?.id || me?.id}`) || null } catch { return null }
  })
  useEffect(() => {
    const handler = e => setAvatar(e.detail)
    window.addEventListener('patient-avatar-updated', handler)
    return () => window.removeEventListener('patient-avatar-updated', handler)
  }, [me?.patient?.id, me?.id])
  const notes = useNotifications()
  const main = useRef(null)
  const toast = store.toast

  const navigate = (next, ctx = null) => {
    if (!PORTAL_PAGES.includes(next)) return
    setMenu(false); setMore(false); setBell(false)
    setContext(ctx); setPage(next); setVisit(v => v + 1)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }))
  }
  useEffect(() => { document.title = `${TITLES[page]} · Patient portal` }, [page])
  // Keep the page in the address so a reload (or a shared tab) opens it again; replaceState adds no history entries.
  useEffect(() => { try { if (window.location.hash !== `#p/${page}`) window.history.replaceState(null, '', `#p/${page}`) } catch { /* sandboxed */ } }, [page])

  let content
  switch (page) {
    case 'book': content = <BookPage prefill={context} onNavigate={navigate} toast={toast} onDone={() => notes.reload()}/>; break
    case 'visits': content = <VisitsPage context={context} onNavigate={navigate} toast={toast}/>; break
    case 'billing': content = <BillingPage context={context} toast={toast}/>; break
    case 'messages': content = <div className="pp-page pp-legacy role-patient"><ServerMessagesPage store={store} role="patient" initial={context}/></div>; break
    case 'archives': content = <ArchivesPage toast={toast}/>; break
    case 'documents': content = <div className="pp-page pp-legacy role-patient"><PatientMePage store={store} setPage={() => {}} documentsOnly/></div>; break
    case 'profile': content = <ProfilePage me={me} onNavigate={navigate}/>; break
    case 'family': content = <FamilyPage/>; break
    case 'prescriptions': content = <PrescriptionsPage toast={toast}/>; break
    case 'teeth': content = <TeethPage/>; break
    case 'security': content = <SecurityPage me={me} onSignedOut={onSignedOut}/>; break
    default: content = <HomePage me={me} onNavigate={navigate}/>
  }

  return <div className="pp-shell">
    <a className="skip-link" href="#pp-main">Skip to content</a>
    <aside className="pp-side" aria-label="Patient portal">
      <Brand className="pp-brand"/>
      <nav aria-label="Main" className="pp-nav-groups">
        {NAV_SECTIONS.map((section, idx) => {
          const groupId = section.title ? `pp-nav-group-${section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined
          return <div key={section.title || `group-${idx}`} className="pp-nav-group">
            {section.title && <span id={groupId} className="pp-nav-group-title">{section.title}</span>}
            <ul aria-labelledby={groupId}>
              {section.items.map(([key, icon, label]) => <li key={key}>
                <button type="button" className={`pp-nav ${page === key ? 'is-active' : ''}`} aria-current={page === key ? 'page' : undefined} onClick={() => navigate(key)}>
                  <Icon name={icon} size={20}/><span>{label}</span>
                </button>
              </li>)}
            </ul>
          </div>
        })}
      </nav>
      <div className="pp-me">
        <button type="button" className="pp-me-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
          <span className="pp-avatar" aria-hidden="true">{avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}/> : initials(me.name)}</span><span className="pp-me-text"><b>{me.name}</b><small>{me.email}</small></span><Icon name="chevron" size={16}/>
        </button>
        {menu && <ProfileMenu onPick={navigate} onLogout={() => { setMenu(false); setLogoutConfirmOpen(true) }} onClose={() => setMenu(false)}/>}
      </div>
    </aside>

    <div className="pp-body">
      <header className="pp-top">
        <h1 className="pp-top-title">{TITLES[page]}</h1>
        <button type="button" className="pp-icon-btn pp-bell" aria-label={notes.unread ? `Notifications, ${notes.unread} unread` : 'Notifications'} aria-expanded={bell} onClick={() => setBell(b => !b)}>
          <Icon name="bell" size={22}/>{notes.unread > 0 && <span className="pp-badge-count" aria-hidden="true">{notes.unread > 9 ? '9+' : notes.unread}</span>}
        </button>
      </header>
      <main id="pp-main" ref={main} tabIndex={-1} className="pp-main">
        <ChunkBoundary key={`${page}-${visit}`}><Suspense fallback={<StartupLoading compact label="Loading…"/>}><div className="pp-enter">{content}</div></Suspense></ChunkBoundary>
      </main>
    </div>

    <nav className="pp-bottom" aria-label="Main">
      {PHONE_NAV.map(([key, icon, label]) => {
        const active = key === 'more' ? more || !PHONE_NAV.some(([k]) => k === page) : page === key && !more
        return <button key={key} type="button" className={`pp-tab ${active ? 'is-active' : ''}`} aria-current={active && key !== 'more' ? 'page' : undefined} aria-expanded={key === 'more' ? more : undefined}
          onClick={() => key === 'more' ? setMore(m => !m) : navigate(key)}><Icon name={icon} size={22}/><span>{label}</span></button>
      })}
    </nav>
    {more && <div className="pp-sheet-backdrop" onClick={() => setMore(false)}>
      <div className="pp-sheet pp-pop" role="dialog" aria-label="More" onClick={e => e.stopPropagation()}>
        <div className="pp-sheet-me"><span className="pp-avatar" aria-hidden="true">{initials(me.name)}</span><span><b>{me.name}</b><small>{me.email}</small></span></div>
        {[['billing', 'receipt', 'Billing'], ['prescriptions', 'file', 'Prescriptions'], ['teeth', 'star', 'My teeth'], ['archives', 'archive', 'Historical records'], ['documents', 'file', 'Documents'], ['profile', 'user', 'Profile']].map(([key, icon, label]) =>
          <button key={key} type="button" className="pp-sheet-item" onClick={() => navigate(key)}><Icon name={icon} size={20}/>{label}</button>)}
        <button type="button" className="pp-sheet-item pp-danger" onClick={() => { setMore(false); setLogoutConfirmOpen(true) }}><Icon name="logout" size={20}/>Sign out</button>
      </div>
    </div>}

    {bell && <NotificationPanel notes={notes} onClose={() => setBell(false)} onOpen={n => {
      if (!n.read) notes.markRead(n.id)
      const t = n.target
      if (!t) return
      navigate(t.page, t.page === 'billing' ? { invoiceId: t.id } : t.page === 'messages' ? { conversationId: t.id } : { appointmentId: t.id })
    }}/>}
    <AssistantLauncher onNavigate={navigate}/>
    <ConfirmDialog open={logoutConfirmOpen} title="Sign out?" tone="default" confirmLabel="Sign out" cancelLabel="Cancel" className="patient-logout-dialog" onConfirm={() => { setLogoutConfirmOpen(false); onLogout() }} onCancel={() => setLogoutConfirmOpen(false)}>
      Are you sure you want to sign out of your account?
    </ConfirmDialog>
  </div>
}

function ProfileMenu({ onPick, onLogout, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const key = e => { if (e.key === 'Escape') onClose() }
    const click = e => { if (!ref.current?.parentElement?.contains(e.target)) onClose() }
    document.addEventListener('keydown', key); document.addEventListener('mousedown', click)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click) }
  }, [])
  return <div ref={ref} className="pp-menu pp-pop" role="menu">
    <button type="button" role="menuitem" onClick={() => onPick('profile')}><Icon name="user" size={18}/>Profile</button>
    <button type="button" role="menuitem" className="pp-danger" onClick={onLogout}><Icon name="logout" size={18}/>Sign out</button>
  </div>
}

/** Notifications from real server events only; polled every minute while the tab is visible. */
function useNotifications() {
  const [state, setState] = useState({ status: 'loading', items: [], unread: 0, error: '' })
  const load = async () => {
    const r = await listNotifications()
    setState(s => r.ok ? { status: 'ready', items: r.data || [], unread: r.meta?.unread ?? 0, error: '' } : { ...s, status: s.items.length ? 'ready' : 'error', error: r.message || 'Notifications could not be loaded.' })
  }
  useEffect(() => { load() }, [])
  useVisibleRefresh(load, { active: true, intervalMs: 60000 })
  const markRead = async id => {
    setState(s => ({ ...s, items: s.items.map(n => n.id === id ? { ...n, read: true } : n), unread: Math.max(0, s.unread - 1) }))
    const r = await readNotification(id)
    if (r.ok && r.meta) setState(s => ({ ...s, unread: r.meta.unread }))
  }
  const markAll = async () => {
    const r = await readAllNotifications()
    if (r.ok) setState(s => ({ ...s, items: s.items.map(n => ({ ...n, read: true })), unread: 0 }))
  }
  return { ...state, reload: load, markRead, markAll }
}

function NotificationPanel({ notes, onClose, onOpen }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  const when = iso => {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes} min ago`
    if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
  }
  return <div className="pp-sheet-backdrop pp-notes-backdrop" onClick={onClose}>
    <section ref={ref} tabIndex={-1} className="pp-notes pp-pop" role="dialog" aria-labelledby="pp-notes-title" onClick={e => e.stopPropagation()}>
      <header><h2 id="pp-notes-title">Notifications</h2>
        <button type="button" className="link-button" disabled={!notes.unread} onClick={notes.markAll}>Mark all read</button>
        <button type="button" className="pp-icon-btn" aria-label="Close notifications" onClick={onClose}><Icon name="x" size={20}/></button>
      </header>
      {notes.status === 'loading' && <div className="pp-notes-empty" role="status">Loading…</div>}
      {notes.status === 'error' && <div className="pp-notes-empty" role="alert">{notes.error} <button type="button" className="link-button" onClick={notes.reload}>Try again</button></div>}
      {notes.status === 'ready' && !notes.items.length && <div className="pp-notes-empty"><Icon name="check" size={22}/><p>You’re all caught up</p></div>}
      <ul>{notes.items.map(n => <li key={n.id}>
        <button type="button" className={`pp-nitem ${n.read ? '' : 'is-unread'}`} onClick={() => onOpen(n)}>
          <span className="pp-nitem-dot" aria-hidden="true"/>
          <span><b>{!n.read && <span className="sr-only">Unread: </span>}{n.title}</b>{n.body && <small>{n.body}</small>}<em>{when(n.created_at)}</em></span>
        </button></li>)}</ul>
    </section>
  </div>
}
