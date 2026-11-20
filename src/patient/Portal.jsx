import '../clinic-overlays.css'
import React, { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { Button, ConfirmDialog, Icon, Modal } from '../components.jsx'
import { Brand } from '../Brand.jsx'
import { AccountMenu, AccountProfileDialog } from '../components/AccountMenu.jsx'
import { archiveNotification, listNotifications, readAllNotifications, readNotification } from '../api-client.js'
import { groupNotificationsByDate } from '../notification-date-groups.js'
import { clinicDate } from '../clock.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { createSignOutAttempt } from '../signout-control.js'
import { ChunkBoundary, StartupLoading } from '../StartupLoading.jsx'
import { EmptyState, LoadingState } from './ui.jsx'
import { HomePage } from './pages/Home.jsx'
import './care-experience.css'

const BookPage = lazy(() => import('./pages/Book.jsx').then(m => ({ default: m.BookPage })))
const VisitsPage = lazy(() => import('./pages/Visits.jsx').then(m => ({ default: m.VisitsPage })))
const BillingPage = lazy(() => import('./pages/Billing.jsx').then(m => ({ default: m.BillingPage })))
const ProfilePage = lazy(() => import('./pages/Account.jsx').then(m => ({ default: m.ProfilePage })))
const SecurityPage = lazy(() => import('./pages/Account.jsx').then(m => ({ default: m.SecurityPage })))
const ServerMessagesPage = lazy(() => import('../pages/ServerMessages.jsx').then(m => ({ default: m.ServerMessagesPage })))
const ArchivesPage = lazy(() => import('./pages/Archives.jsx').then(m => ({ default: m.ArchivesPage })))
const PrescriptionsPage = lazy(() => import('./pages/Prescriptions.jsx').then(m => ({ default: m.PrescriptionsPage })))
const TeethPage = lazy(() => import('./pages/Teeth.jsx').then(m => ({ default: m.TeethPage })))
const PatientMePage = lazy(() => import('../pages/PatientMe.jsx').then(m => ({ default: m.PatientMePage })))

export const NAV_SECTIONS = [
  { title: null, items: [['home', 'home', 'Home']] },
  { title: 'Care', items: [['visits', 'calendar', 'Appointments'], ['messages', 'message', 'Messages'], ['prescriptions', 'pill', 'Prescriptions']] },
  { title: 'Records', items: [['teeth', 'tooth', 'My Teeth'], ['archives', 'clock', 'History']] },
]
const TITLES = {
  home: 'Home', book: 'Book appointment', visits: 'Appointments', notifications: 'Notifications',
  messages: 'Messages', billing: 'Billing', prescriptions: 'Prescriptions', teeth: 'My Teeth',
  archives: 'History', documents: 'Documents', profile: 'Account', security: 'Security',
}
export const PORTAL_PAGES = Object.keys(TITLES)
const PAGE_ALIASES = { family: 'profile', account: 'profile', appointments: 'visits', history: 'archives' }
const ACCOUNT_SUBPAGES = ['security', 'billing', 'documents', 'family', 'messages', 'prescriptions', 'teeth']

export function portalPageFromHash(hash = typeof window !== 'undefined' ? window.location.hash : '') {
  const match = /^#p\/([a-z]+)(?:\/([a-z]+))?\/?$/.exec(hash || '')
  if (!match) return null
  const [, parent, child] = match
  if (child && (!['account', 'profile'].includes(parent) || !ACCOUNT_SUBPAGES.includes(child))) return null
  const slug = child || parent
  return PAGE_ALIASES[slug] || (PORTAL_PAGES.includes(slug) ? slug : null)
}

function PortalNavigation({ page, unread, navigate, onSignOut, onProfile, me, photoVersion }) {
  const id = useId()
  const sectionPage = { book: 'visits', billing: 'profile', documents: 'profile', security: 'profile' }
  return <>
    <nav aria-label="Patient navigation" className="pp-nav-groups">
      {NAV_SECTIONS.map(({ title, items }, index) => {
        const headingId = `${id}-${index}`
        return <div className="pp-nav-group" key={title || 'home'}>
          {title && <h2 className="pp-nav-group-title" id={headingId}>{title}</h2>}
          <ul aria-labelledby={title ? headingId : undefined}>
            {items.map(([key, icon, label]) => {
              const active = (sectionPage[page] || page) === key
              const count = key === 'notifications' ? unread : 0
              return <li key={key}><a href={`#p/${key}`} className={`pp-nav${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined} aria-label={count ? `${label}, ${count} unread` : undefined}
                onClick={event => {
                  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  navigate(key)
                }}>
                <Icon name={icon} size={20}/><span>{label}</span>{count > 0 && <small className="patient-nav-count" aria-hidden="true">{count}</small>}
              </a></li>
            })}
          </ul>
        </div>
      })}
    </nav>
    <div className="pp-nav-utility"><AccountMenu accountId={me?.id} name={me?.name || 'Patient'} role="patient" version={photoVersion}
      onProfile={onProfile} onSignOut={onSignOut}/></div>
  </>
}

/** The portal owns hash history and keeps record context in memory for the current session. */
export function PatientPortal({ me, store, onAccountChanged, initialPage = 'home', initialContext = null, onLogout, onSignedOut }) {
  const [route, setRoute] = useState(() => ({
    page: initialContext && PORTAL_PAGES.includes(initialPage) ? initialPage : portalPageFromHash() || (PORTAL_PAGES.includes(initialPage) ? initialPage : 'home'),
    context: initialContext,
    entry: 0,
  }))
  const { page, context, entry } = route
  const [bellOpen, setBellOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const signOutAttempt = useRef(null)
  if (!signOutAttempt.current) signOutAttempt.current = createSignOutAttempt()
  const finishSignOut = () => signOutAttempt.current(onLogout, state => {
    setSigningOut(state.pending)
    setSignOutError(state.error)
    if (state.finished) setLogoutConfirmOpen(false)
  })
  const [profileOpen, setProfileOpen] = useState(false)
  const [photoVersion, setPhotoVersion] = useState(0)
  const [historyFilters, setHistoryFilters] = useState({ tab: 'visits', search: '', status: 'all', page: 1 })
  const notes = useNotifications(me, store.session, store.getAuthGeneration)
  const main = useRef(null)
  const routeRef = useRef(route)
  routeRef.current = route
  const historyKey = useId()
  const entries = useRef(new Map([[0, route]]))
  const nextEntry = useRef(0)
  const notificationAccount = useRef(me)
  notificationAccount.current = me
  const toast = store.toast

  function openRoute(next) {
    routeRef.current = next
    setBellOpen(false)
    setRoute(next)
    setDrawerOpen(false)
    window.scrollTo({ top: 0 })
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }))
  }
  function writeAddress(next, replace = false) {
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method]({ ...window.history.state, patientPortal: { key: historyKey, entry: next.entry } }, '', `#p/${next.page}`)
  }
  const navigate = (next, ctx = null) => {
    if (!PORTAL_PAGES.includes(next)) return
    if (routeRef.current.page === next && !ctx && !routeRef.current.context) {
      setDrawerOpen(false)
      return
    }
    const destination = { page: next, context: ctx, entry: ++nextEntry.current }
    entries.current.set(destination.entry, destination)
    writeAddress(destination)
    openRoute(destination)
  }
  useEffect(() => {
    writeAddress(routeRef.current, true)
    const sync = () => {
      const slug = portalPageFromHash()
      if (!slug) { setDrawerOpen(false); return }
      const marker = window.history.state?.patientPortal
      const known = marker?.key === historyKey ? entries.current.get(marker.entry) : null
      if (known?.page === slug && known.entry === routeRef.current.entry) return
      const next = known?.page === slug ? known : { page: slug, context: null, entry: ++nextEntry.current }
      entries.current.set(next.entry, next)
      if (known?.page !== slug || window.location.hash !== `#p/${slug}`) writeAddress(next, true)
      openRoute(next)
    }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    const desktop = window.matchMedia('(min-width: 960px)')
    const closeOnDesktop = event => { if (event.matches) setDrawerOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
      desktop.removeEventListener('change', closeOnDesktop)
    }
  }, [historyKey])
  useEffect(() => { document.title = `${TITLES[page]} · Patient portal` }, [page])
  const confirmSignOut = () => { setDrawerOpen(false); setSignOutError(''); setLogoutConfirmOpen(true) }
  const navProps = { page, unread: notes.unread, navigate, me, photoVersion, onSignOut: confirmSignOut, onProfile: () => { setDrawerOpen(false); setProfileOpen(true) } }
  const patientKey = JSON.stringify([store.session?.serverUserId, store.session?.patientPublicId, store.getAuthGeneration?.()])

  let content
  switch (page) {
    case 'book': content = <BookPage key={JSON.stringify([store.session?.serverUserId,store.session?.patientPublicId,store.getAuthGeneration?.()])} prefill={context} me={me} session={store.session} getAuthGeneration={store.getAuthGeneration} onNavigate={navigate} toast={toast} onDone={() => notes.reload()}/>; break
    case 'visits': content = <VisitsPage patientId={me.patient.id} selectionDetailsAvailable={store.session?.selectionDetailsAvailable===true} context={context} onNavigate={navigate} toast={toast}/>; break
    case 'billing': content = <BillingPage key={JSON.stringify([store.session?.serverUserId,store.getAuthGeneration?.(),context?.invoiceId,context?.appointmentId,context?.receiptId,context?.patientId])} context={context} toast={toast} session={store.session} getAuthGeneration={store.getAuthGeneration} onNavigate={navigate}/>; break
    case 'messages': content = <div className="pp-page pp-legacy role-patient"><ServerMessagesPage store={store} role="patient" initial={context}/></div>; break
    case 'archives': content = <ArchivesPage key={JSON.stringify([store.session?.serverUserId,store.session?.patientPublicId,store.getAuthGeneration?.()])} toast={toast} session={store.session} getAuthGeneration={store.getAuthGeneration} onNavigate={navigate} filters={historyFilters} setFilters={setHistoryFilters}/>; break
    case 'documents': content = <div className="pp-page pp-legacy role-patient"><PatientMePage store={store} setPage={() => {}} documentsOnly/></div>; break
    case 'profile': content = <ProfilePage me={me} onNavigate={navigate} onOpenProfile={()=>setProfileOpen(true)} toast={toast} onSignedOut={onSignedOut}/>; break
    case 'prescriptions': content = <PrescriptionsPage context={context} toast={toast} session={store.session} getAuthGeneration={store.getAuthGeneration}/>; break
    case 'teeth': content = <TeethPage key={JSON.stringify([store.session?.serverUserId,store.session?.patientPublicId,store.getAuthGeneration?.()])} session={store.session} getAuthGeneration={store.getAuthGeneration}/>; break
    case 'notifications': content = <NotificationPanel inline key={notes.identity} notes={notes}
      destination={n => patientNotificationDestination(me, n)} onOpen={async n => {
        if (!await notes.markRead(n.id) || !notes.isCurrent() || routeRef.current.entry !== entry) return
        const destination = patientNotificationDestination(notificationAccount.current, n)
        if (destination) navigate(destination.page, destination.context)
      }}/>; break
    case 'security': content = <SecurityPage me={me} onSignedOut={onSignedOut} onNavigate={navigate}/>; break
    default: content = <HomePage key={JSON.stringify([store.session?.serverUserId,store.session?.patientPublicId,store.getAuthGeneration?.()])} me={me} session={store.session} getAuthGeneration={store.getAuthGeneration} onNavigate={navigate}/>
  }

  return <div className="pp-shell">
    <a className="skip-link" href="#pp-main" onClick={event => { event.preventDefault(); main.current?.focus() }}>Skip to content</a>
    <aside className="pp-side" aria-label="Patient portal">
      <Brand className="pp-brand"/>
      <PortalNavigation {...navProps}/>
    </aside>
    <div className="pp-body">
      <header className="pp-top">
        <span className="pp-mobile-title">Patient portal</span>
        <button type="button" className="pp-icon-btn pp-bell" aria-label={`Notifications${notes.unread != null ? ', '+notes.unread+' unread' : ''}`} aria-expanded={bellOpen}
          aria-haspopup="dialog" onClick={() => setBellOpen(true)}><Icon name="bell"/>{notes.unread > 0 && <small>{notes.unread}</small>}</button>
        <button type="button" className="pp-icon-btn" aria-label="Open patient navigation" aria-haspopup="dialog" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Icon name="menu"/></button>
      </header>
      <main id="pp-main" ref={main} tabIndex={-1} className="pp-main">
        <ChunkBoundary key={`${patientKey}-${page}-${entry}`}><Suspense fallback={<StartupLoading compact label="Opening page…"/>}>{content}</Suspense></ChunkBoundary>
      </main>
    </div>
    {bellOpen && <NotificationPanel key={notes.identity} notes={notes} onClose={() => setBellOpen(false)}
      onViewAll={() => { setBellOpen(false); navigate('notifications') }} destination={n => patientNotificationDestination(me, n)}
      onOpen={async n => {
        if (!await notes.markRead(n.id) || !notes.isCurrent() || routeRef.current.entry !== entry) return
        const target = patientNotificationDestination(notificationAccount.current, n)
        if (target) navigate(target.page, target.context)
      }}/>}
    {drawerOpen && <div onKeyDown={event => {
      if (event.key !== 'Tab' || !drawerOpen) return
      const controls = [...event.currentTarget.querySelectorAll('dialog[open] a[href], dialog[open] button:not(:disabled)')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }}>
      <Modal open={drawerOpen} title="Patient navigation" className="pp-drawer" onClose={() => setDrawerOpen(false)}>
        <Brand className="pp-drawer-brand"/>
        <PortalNavigation {...navProps}/>
      </Modal>
    </div>}
    <AccountProfileDialog open={profileOpen} accountId={me?.id} role="patient" onClose={()=>setProfileOpen(false)}
      onUpdated={onAccountChanged} onPhotoChanged={()=>setPhotoVersion(version=>version+1)} onPasswordChanged={onSignedOut}/>
    <ConfirmDialog open={logoutConfirmOpen} title="Sign out?" tone="default" confirmLabel="Sign out" cancelLabel="Cancel" busy={signingOut} busyLabel="Signing out…" className="patient-logout-dialog clinic-signout-dialog" onConfirm={finishSignOut} onCancel={() => setLogoutConfirmOpen(false)}>
      End your session on this device?
      {signOutError && <p className="clinic-signout-error" role="alert">{signOutError}</p>}
    </ConfirmDialog>
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
  if (notification.kind === 'prescription_ready' && target.page === 'visits') return { page: 'prescriptions', context: id ? { prescriptionId: id } : null }
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
      new Set(items.map(n => n.id)).size !== items.length || (result.meta.collection !== 'archived' && unread < items.filter(n => !n.read).length)) throw new Error('Notifications could not be loaded. Try again.')
  const { collection, archive_available: archiveAvailable, has_more: hasMore, next_before: nextBefore } = result.meta
  if (collection === undefined && hasMore === undefined) return { items, unread }
  if (!['active', 'archived'].includes(collection) || typeof archiveAvailable !== 'boolean' ||
      (collection === 'archived' && !archiveAvailable) ||
      items.some(n => n.archived !== (collection === 'archived') || (n.archived && !Number.isFinite(Date.parse(n.archived_at)))) ||
      typeof hasMore !== 'boolean' || (hasMore ? !items.length || nextBefore !== items.at(-1).id : nextBefore !== null)) {
    throw new Error('Notification history could not be confirmed. Retry notifications.')
  }
  return { items, unread, collection, archiveAvailable, nextBefore }
}

// One instance per authenticated account epoch. Pure controller permits deferred race tests
// without timers, network access, or real account records.
export function createPatientNotificationFeed(api) {
  let active = false, generation = 0, pending = null, listener = null
  const writes = ['read', 'all', 'archive']
  let state = { collection: 'active', status: 'loading', items: [], unread: null, error: '', busy: false, refreshing: false, confirmed: false, failed: null }
  const emit = next => { state = next; listener?.(state) }
  const authorized=()=>!api.isCurrent || api.isCurrent()
  const run = async operation => {
    if (!authorized() || !active || writes.includes(pending?.type) || (['load', 'more', 'poll'].includes(operation.type) && pending)) return false
    const target = state.items.find(n => n.id === operation.id)
    if (operation.type === 'read' && !target) return false
    if (operation.type === 'read' && target.read) return true
    if (operation.type === 'all' && !state.unread) return false
    const collection = operation.collection || state.collection
    const previous = state
    if (operation.type === 'more' && !previous.nextBefore) return false
    pending?.controller.abort()
    const controller = new AbortController()
    const { signal } = controller
    const request = { ...operation, generation: ++generation, controller }
    pending = request
    const writing = writes.includes(operation.type)
    let items = previous.items, unread = previous.unread
    if (operation.type === 'all') {
      items = items.map(n => ({ ...n, read: true }))
      unread = 0
    } else if (writing) {
      items = operation.type === 'archive' ? items.filter(n => n.id !== target.id)
        : items.map(n => n.id === target.id ? { ...n, read: true } : n)
      if (collection === 'active' && !target.read && unread != null) unread = Math.max(0, unread - 1)
    }
    emit({ ...previous, collection, items, unread, error: '', failed: null, busy: writing, refreshing: !writing,
      ...(collection !== previous.collection ? {items: [], confirmed: false, status: 'loading', nextBefore: null} : {}) })
    const timer = setTimeout(() => controller.abort(), 30000)
    const stopped = new Promise(resolve => signal.addEventListener('abort', () => resolve({
      ok: false, message: 'The notification request could not be confirmed. Try again.',
    }), { once: true }))
    let result
    try {
      const owns = () => active && generation === request.generation && authorized() && !signal.aborted
      const work = operation.type === 'read' ? api.read(operation.id, owns, collection, signal)
        : operation.type === 'all' ? api.readAll(owns, signal)
        : operation.type === 'archive' ? api.archive(operation.id, owns, signal)
        : api.list(operation.type === 'more' ? previous.nextBefore : undefined, collection, signal)
      result = await Promise.race([work, stopped])
      if (!active || generation !== request.generation) return false
      if(!authorized())throw new Error('Notifications are unavailable for this account.')
      const snapshot = patientNotificationSnapshot(result)
      if ((snapshot.collection || 'active') !== collection) throw new Error('Notification collection changed. Retry notifications.')
      if (operation.type === 'read') {
        const item = snapshot.items.find(n => n.id === operation.id)
        if (item ? !item.read : result.meta?.read_id !== operation.id) throw new Error('Read status could not be confirmed. Retry or reload notifications.')
      }
      if (operation.type === 'all' && snapshot.items.some(n => !n.read)) throw new Error('Read status could not be confirmed. Retry or reload notifications.')
      if (operation.type === 'archive') {
        const receipt = result.meta?.archive_receipt
        if (receipt?.id !== operation.id || receipt.archived !== true || typeof receipt.replayed !== 'boolean' ||
            !Number.isFinite(Date.parse(receipt.archived_at)) || snapshot.items.some(n => n.id === operation.id)) {
          throw new Error('Archival could not be confirmed. Retry the same archive.')
        }
      }
      if (operation.type === 'poll') {
        // Keep the user’s place in history while refreshing the inbox badge.
        emit({ ...state, unread: snapshot.unread, refreshing: false })
        return true
      }
      if (operation.type === 'more') {
        const ids = new Set(previous.items.map(n => n.id))
        if (snapshot.nextBefore === undefined || snapshot.nextBefore === previous.nextBefore || snapshot.items.some(n => ids.has(n.id))) {
          throw new Error('Notification history changed. Reload before loading older notifications.')
        }
        snapshot.items = [...previous.items, ...snapshot.items]
      }
      let olderLoaded = operation.type === 'more'
      if (writing && previous.olderLoaded && snapshot.nextBefore) {
        const after = previous.items.findIndex(n => n.id === snapshot.nextBefore)
        if (after !== -1) {
          const seen = new Set(snapshot.items.map(n => n.id))
          const tail = items.slice(items.findIndex(n => n.id === snapshot.nextBefore) + 1).filter(n => !seen.has(n.id))
          snapshot.items = [...snapshot.items, ...tail]
          snapshot.nextBefore = previous.nextBefore
          olderLoaded = true
        }
      }
      emit({ ...snapshot, collection, olderLoaded, status: 'ready', busy: false, refreshing: false, error: '', confirmed: true, failed: null })
      return true
    } catch (error) {
      if (!active || generation !== request.generation) return false
      const denied = !authorized() || ['unauthenticated', 'forbidden'].includes(result?.kind)
      const retained = previous.confirmed && !denied && collection === previous.collection
      emit({ ...(retained ? previous : state), ...(retained ? {} : { items: [], unread: null, confirmed: false, nextBefore: null, olderLoaded: false, archiveAvailable: !denied && state.archiveAvailable }), status: retained ? 'ready' : 'error', busy: false, refreshing: false,
        error: error?.message || 'Notifications are unavailable. Try again.', failed: denied ? { type: 'load' } : operation })
      return false
    } finally {
      clearTimeout(timer)
      if (pending === request) pending = null
    }
  }
  return {
    snapshot: () => state,
    start(callback) { active = true; listener = callback; return run({ type: 'load' }) },
    stop() { active = false; generation++; pending?.controller.abort(); pending = null; listener = null },
    isActive: () => active && authorized(),
    reload: () => run({ type: 'load' }),
    poll: () => state.failed && !['load', 'poll'].includes(state.failed.type) ? Promise.resolve(false)
      : run({ type: state.olderLoaded ? 'poll' : 'load' }),
    more: () => run({ type: 'more' }),
    select: collection => !state.archiveAvailable || !['active', 'archived'].includes(collection) || state.collection === collection
      ? Promise.resolve(false) : run({ type: 'switch', collection }),
    archive: id => state.collection === 'active' && state.archiveAvailable && state.items.some(n => n.id === id)
      ? run({ type: 'archive', id }) : Promise.resolve(false),
    markRead: id => run({ type: 'read', id }),
    markAll: () => state.collection === 'active' ? run({ type: 'all' }) : Promise.resolve(false),
    retry: () => run(state.failed || { type: 'load' }),
  }
}

const useNotificationLayoutEffect = typeof window === 'undefined' ? useEffect : React.useLayoutEffect

/** Server-only notifications, refreshed every minute while visible and authorized. */
export function useNotifications(me, session, getAuthGeneration) {
  const auth=getAuthGeneration?.()
  const identity = patientNotificationIdentity(me)
  const eligible = !!identity && session?.serverUserId === me.id && session?.role === 'patient' && session?.active === true && (!getAuthGeneration || auth!=null)
  const [snapshot, setSnapshot] = useState(null)
  // A -> B -> A creates a fresh controller rather than reusing A's earlier epoch.
  const latest = useRef(null)
  const feed = React.useMemo(() => createPatientNotificationFeed({ list: listNotifications, read: readNotification, readAll: readAllNotifications, archive: archiveNotification, isCurrent:()=>latest.current===feed && (!getAuthGeneration || auth===getAuthGeneration()) }), [identity, eligible, auth, getAuthGeneration])
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
    more: () => feed.more(), select: collection => feed.select(collection), archive: id => feed.archive(id),
    isCurrent: () => latest.current === feed && feed.isActive() }
}

export function NotificationPanel({ notes, onClose, onOpen, onViewAll, destination, inline = false }) {
  const ref = useRef(null)
  const focusOrigin = useRef(null)
  useNotificationLayoutEffect(() => {
    if (focusOrigin.current && !focusOrigin.current.isConnected) {
      if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true })
      focusOrigin.current = null
    }
  })
  useEffect(() => {
    if (inline) return
    const previous = document.activeElement
    ref.current?.focus()
    const key = e => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const controls = [...ref.current.querySelectorAll('button:not(:disabled), summary, a[href], [tabindex="0"]')].filter(el => el.getClientRects().length)
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
  const groups = groupNotificationsByDate((inline ? notes.items : notes.items.slice(0, 5)).map(n => ({ ...n, createdAt: n.created_at })), clinicDate())
  const locked = notes.busy || !notes.confirmed
  const archived = notes.collection === 'archived'
  const perform = (event, action) => {
    focusOrigin.current = event.currentTarget
    action()
  }
  const performSecondary = (event, action) => {
    const details = event.currentTarget.closest('details')
    const trigger = details.querySelector('summary')
    details.open = false
    focusOrigin.current = trigger
    trigger.focus()
    action()
  }
  const Heading = inline ? 'h1' : 'h2'
  const panel = <section ref={ref} tabIndex={-1} className={inline ? 'pp-page patient-inbox' : 'pp-notes pp-pop'}
    role={inline ? undefined : 'dialog'} aria-modal={inline ? undefined : true} aria-labelledby="pp-notes-title" aria-busy={notes.busy || (!notes.confirmed && notes.refreshing)} onClick={e => e.stopPropagation()}>
      <header className="patient-page-heading">
        <div><Heading id="pp-notes-title">Notifications</Heading>
          <p className="pp-notes-status" role="status">{notes.unread == null ? (notes.error ? 'Unread count unavailable' : '') : notes.unread + ' unread'}</p>
        </div>
        <Button variant="soft" icon="check" disabled={archived || !notes.unread || locked || !!notes.error} onClick={notes.markAll}>Mark all read</Button>
        {!inline && <button type="button" className="pp-icon-btn" aria-label="Close notifications" onClick={onClose}><Icon name="x" size={20}/></button>}
      </header>
      <div className="patient-inbox-toolbar">
        {notes.archiveAvailable && <div className="pp-tabs" role="group" aria-label="Notification collection">
          <button type="button" className={!archived ? 'is-active' : ''} aria-pressed={!archived} disabled={notes.busy || notes.status === 'loading'} onClick={() => notes.select('active')}>Inbox</button>
          <button type="button" className={archived ? 'is-active' : ''} aria-pressed={archived} disabled={notes.busy || notes.status === 'loading'} onClick={() => notes.select('archived')}>Archived</button>
        </div>}
        {notes.confirmed && notes.refreshing && <LoadingState compact label="Refreshing…"/>}
        {notes.busy && <LoadingState compact label="Updating…"/>}
      </div>
      {notes.error && <div className="pp-notes-empty" role="alert" tabIndex={0}>{notes.confirmed && 'Showing the last confirmed updates. '}{notes.error} <button type="button" className="link-button" disabled={!notes.available || notes.refreshing} onClick={event => perform(event, notes.retry)}>Retry {notes.failed?.type === 'read' ? 'mark read' : notes.failed?.type === 'all' ? 'mark all read' : notes.failed?.type === 'archive' ? 'archive' : notes.failed?.type === 'more' ? 'older notifications' : 'notifications'}</button></div>}
      {notes.status === 'loading' && !notes.items.length && <LoadingState label={archived ? 'Loading archived notifications…' : 'Loading notifications…'}/>}
      {notes.status === 'ready' && !notes.error && !notes.items.length && <EmptyState icon="bell" title={archived ? 'No archived notifications' : 'No recent notifications'}/>}
      {notes.confirmed && notes.archiveAvailable === undefined && <p className="pp-hint">Recent history shows up to 50 notifications.</p>}
      <div className="pp-notes-history" role="region" aria-label="Notification history">
        {groups.map(group => <section key={group.key} aria-label={group.label}>
          <h3>{group.label}</h3>
          <ul>{group.items.map(n => {
            const linked = destination(n)
            const createdAt = Date.parse(n.created_at)
            const localTime = Number.isFinite(createdAt) ? new Date(createdAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) + ' (Manila)' : null
            const action = { messages: 'Open message', visits: 'View appointment', prescriptions: 'View prescription', billing: 'View billing', book: 'Book appointment' }[linked?.page]
            return <li key={n.id} className={`patient-notice-row${n.read ? '' : ' is-unread'}`}>
              <span className="pp-nitem-dot" aria-hidden="true"/>
              <div className="patient-notice-copy">
                <b>{!n.read && <span className="sr-only">Unread: </span>}{n.title}</b>
                {n.body && <p>{n.body}</p>}
                {localTime && <time dateTime={n.created_at} title={localTime}>{when(n.created_at)}</time>}
              </div>
              <div className="patient-notice-actions">
                {linked && <Button size="sm" variant="soft" disabled={locked || !!notes.error}
                  aria-label={`${action}: ${n.title}`} onClick={event => perform(event, () => onOpen(n))}>{action}</Button>}
                {(!n.read || (notes.archiveAvailable && !archived)) && <details name="patient-notification-actions" className="patient-notice-menu" onKeyDown={event => {
                  if (event.key !== 'Escape' || !event.currentTarget.open) return
                  event.stopPropagation()
                  event.currentTarget.open = false
                  event.currentTarget.querySelector('summary')?.focus()
                }} onBlur={event => {
                  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
                }}>
                  <summary aria-label={`More actions for ${n.title}`}><span aria-hidden="true">•••</span></summary>
                  <div>
                    {!n.read && <Button size="sm" variant="ghost" disabled={locked || !!notes.error}
                      onClick={event => performSecondary(event, () => notes.markRead(n.id))}>Mark as read</Button>}
                    {notes.archiveAvailable && !archived && <Button size="sm" variant="ghost" disabled={locked || !!notes.error}
                      onClick={event => performSecondary(event, () => notes.archive(n.id))}>Archive</Button>}
                  </div>
                </details>}
              </div>
            </li>
          })}</ul>
        </section>)}
      </div>
      {!inline && <Button variant="soft" onClick={onViewAll}>View all notifications</Button>}
      {inline && notes.nextBefore && !notes.error && <div className="pp-notes-controls"><Button variant="soft" disabled={locked || notes.refreshing}
        onClick={event => perform(event, notes.more)}>Load older notifications</Button></div>}
      {notes.failed?.type === 'more' && <div className="pp-notes-controls"><button type="button" className="link-button" disabled={locked} onClick={event => perform(event, notes.reload)}>Reload notifications</button></div>}
    </section>
  return inline ? panel : <div className="pp-sheet-backdrop pp-notes-backdrop" onClick={onClose}>{panel}</div>
}
