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
  const notes = useNotifications(me, store.session)
  const main = useRef(null)
  const bellButton = useRef(null)
  const notificationAccount = useRef(me)
  notificationAccount.current = me
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
        <button ref={bellButton} type="button" className="pp-icon-btn pp-bell" aria-haspopup="dialog" aria-label={notes.unread ? `Notifications, ${notes.unread} unread` : 'Notifications'} aria-expanded={bell} onClick={() => setBell(b => !b)}>
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

    {bell && <NotificationPanel key={notes.identity} notes={notes} onClose={() => { setBell(false); bellButton.current?.focus() }} destination={n => patientNotificationDestination(me, n)} onOpen={async n => {
      if (!await notes.markRead(n.id) || !notes.isCurrent()) return
      const destination = patientNotificationDestination(notificationAccount.current, n)
      if (destination) navigate(destination.page, destination.context)
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

export function patientNotificationIdentity(me) {
  return me?.role === 'patient' && me?.account_status === 'Active' && me?.id && me?.patient?.id
    ? JSON.stringify([me.id, me.patient.id]) : null
}

export function patientNotificationDestination(me, notification) {
  if (!patientNotificationIdentity(me)) return null
  const target = notification?.target
  if (!target || typeof target !== 'object' || !['visits', 'billing', 'messages', 'book'].includes(target.page)) return null
  const id = typeof target.id === 'string' && target.id.trim() ? target.id : null
  // NotificationCenter's prescription-ready target uses a prescription ID, not an appointment ID.
  if (notification.kind === 'prescription_ready' && target.page === 'visits') return { page: 'prescriptions', context: null }
  const appointmentKinds = ['appointment_booked', 'appointment_rescheduled', 'appointment_cancelled', 'appointment_reminder', 'late_check', 'move_up_offer', 'closure_notice', 'dentist_unavailable']
  const context = id && target.page === 'visits' && appointmentKinds.includes(notification.kind) ? { appointmentId: id }
    : id && target.page === 'billing' && ['invoice_issued', 'payment_received', 'invoice_overdue'].includes(notification.kind) ? { invoiceId: id }
    : id && target.page === 'messages' && notification.kind === 'message_received' ? { conversationId: id } : null
  return { page: target.page, context }
}

export function patientNotificationSnapshot(result) {
  if (!result?.ok) throw new Error(result?.message || 'Notifications could not be updated. Try again.')
  const items = result.data, unread = result.meta?.unread
  if (!Array.isArray(items) || items.length > 50 || !Number.isInteger(unread) || unread < 0 ||
      items.some(n => !n || typeof n.id !== 'string' || typeof n.read !== 'boolean' || typeof n.title !== 'string' || (n.body != null && typeof n.body !== 'string')) ||
      new Set(items.map(n => n.id)).size !== items.length || unread < items.filter(n => !n.read).length) throw new Error('Notifications could not be loaded. Try again.')
  return { items, unread }
}

// One instance per authenticated account epoch. Pure controller permits deferred race tests
// without timers, network access, or real account records.
export function createPatientNotificationFeed(api) {
  let active = false, generation = 0, pending = null, listener = null
  let state = { status: 'loading', items: [], unread: null, error: '', busy: false, refreshing: false, confirmed: false, failed: null }
  const emit = next => { state = next; listener?.(state) }
  const run = async operation => {
    if (!active || pending?.type === 'read' || pending?.type === 'all' || (operation.type === 'load' && pending)) return false
    if (operation.type === 'read' && !state.items.some(n => n.id === operation.id)) return false
    if (operation.type === 'read' && state.items.find(n => n.id === operation.id)?.read) return true
    const request = { ...operation, generation: ++generation }
    pending = request
    emit({ ...state, error: '', failed: null, busy: operation.type !== 'load', refreshing: true })
    let result
    try {
      result = await (operation.type === 'read' ? api.read(operation.id) : operation.type === 'all' ? api.readAll() : api.list())
      if (!active || generation !== request.generation) return false
      const snapshot = patientNotificationSnapshot(result)
      emit({ ...snapshot, status: 'ready', busy: false, refreshing: false, error: '', confirmed: true, failed: null })
      return true
    } catch (error) {
      if (!active || generation !== request.generation) return false
      const denied = ['unauthenticated', 'forbidden'].includes(result?.kind)
      const retained = state.confirmed && !denied
      emit({ ...state, ...(retained ? {} : { items: [], unread: null, confirmed: false }), status: retained ? 'ready' : 'error', busy: false, refreshing: false,
        error: error?.message || 'Notifications are unavailable. Try again.', failed: denied ? { type: 'load' } : operation })
      return false
    } finally { if (pending === request) pending = null }
  }
  return {
    snapshot: () => state,
    start(callback) { active = true; listener = callback; return run({ type: 'load' }) },
    stop() { active = false; generation++; pending = null; listener = null },
    isActive: () => active,
    reload: () => run({ type: 'load' }),
    poll: () => state.failed && state.failed.type !== 'load' ? Promise.resolve(false) : run({ type: 'load' }),
    markRead: id => run({ type: 'read', id }),
    markAll: () => run({ type: 'all' }),
    retry: () => run(state.failed || { type: 'load' }),
  }
}

const useNotificationLayoutEffect = typeof window === 'undefined' ? useEffect : React.useLayoutEffect

/** Server-only notifications, refreshed every minute while visible and authorized. */
export function useNotifications(me, session) {
  const identity = patientNotificationIdentity(me)
  const eligible = !!identity && session?.serverUserId === me.id && session?.role === 'patient' && session?.active === true
  const [snapshot, setSnapshot] = useState(null)
  // A -> B -> A creates a fresh controller rather than reusing A's earlier epoch.
  const feed = React.useMemo(() => createPatientNotificationFeed({ list: listNotifications, read: readNotification, readAll: readAllNotifications }), [identity, eligible])
  const latest = useRef(null)
  latest.current = eligible ? feed : null
  useNotificationLayoutEffect(() => {
    if (!eligible) return undefined
    feed.start(value => setSnapshot({ feed, value }))
    return () => feed.stop()
  }, [feed, eligible])
  useVisibleRefresh(() => feed.poll(), { active: eligible, intervalMs: 60000 })
  const current = !eligible ? { status: 'error', items: [], unread: null, error: 'Notifications are unavailable for this account.', busy: false, refreshing: false }
    : snapshot?.feed === feed ? snapshot.value : feed.snapshot()
  return { ...current, identity, available: eligible, reload: () => feed.reload(), markRead: id => feed.markRead(id), markAll: () => feed.markAll(), retry: () => feed.retry(),
    isCurrent: () => latest.current === feed && feed.isActive() }
}

export function NotificationPanel({ notes, onClose, onOpen, destination }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.focus()
    const key = e => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const controls = [...ref.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')]
        const first = controls[0], last = controls.at(-1)
        if (!first) { e.preventDefault(); ref.current.focus(); return }
        if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus() }
  }, [])
  const when = iso => {
    if (!iso || !Number.isFinite(Date.parse(iso))) return 'Date unavailable'
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes} min ago`
    if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
  }
  return <div className="pp-sheet-backdrop pp-notes-backdrop" onClick={onClose}>
    <section ref={ref} tabIndex={-1} className="pp-notes pp-pop" role="dialog" aria-modal="true" aria-labelledby="pp-notes-title" aria-busy={notes.busy || notes.refreshing} onClick={e => e.stopPropagation()}>
      <header><h2 id="pp-notes-title">Notifications</h2>
        <button type="button" className="link-button" disabled={!notes.unread || notes.busy || notes.refreshing || !!notes.error} onClick={notes.markAll}>Mark all read</button>
        <button type="button" className="pp-icon-btn" aria-label="Close notifications" onClick={onClose}><Icon name="x" size={20}/></button>
      </header>
      <p role="status">{notes.busy ? 'Updating read status…' : notes.refreshing ? 'Loading notifications…' : notes.unread == null ? 'Unread count unavailable' : `${notes.unread} unread`}. Recent history: up to 50 notifications.</p>
      {notes.error && <div className="pp-notes-empty" role="alert" tabIndex={0}>{notes.confirmed && 'Showing the last confirmed updates. '}{notes.error} <button type="button" className="link-button" disabled={!notes.available || notes.refreshing} onClick={notes.retry}>Retry {notes.failed?.type === 'read' ? 'mark read' : notes.failed?.type === 'all' ? 'mark all read' : 'notifications'}</button></div>}
      {notes.status === 'loading' && <div className="pp-notes-empty" role="status">Loading…</div>}
      {notes.status === 'ready' && !notes.error && !notes.items.length && <div className="pp-notes-empty"><Icon name="check" size={22}/><p>No recent notifications</p></div>}
      <ul>{notes.items.map(n => <li key={n.id}>
        <button type="button" className={`pp-nitem ${n.read ? '' : 'is-unread'}`} disabled={notes.busy || !!notes.error || (!destination(n) && n.read)} aria-label={`${destination(n) ? 'View update' : n.read ? 'No linked page' : 'Mark read'}: ${n.title}`} onClick={() => onOpen(n)}>
          <span className="pp-nitem-dot" aria-hidden="true"/>
          <span><b>{!n.read && <span className="sr-only">Unread: </span>}{n.title}</b>{n.body && <small>{n.body}</small>}<em>{when(n.created_at)}</em></span>
        </button></li>)}</ul>
    </section>
  </div>
}
