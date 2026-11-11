import React from 'react'
import { NAV, ROLE_INFO } from './data.js'
import { visibleNotifications, notificationDestination } from './phase3-contracts.js'
import { clinicDate } from './clock.js'
import './notification-panel.css'
import './a12-shell-polish.css'
import { groupNotificationsByDate, sortNotificationsNewestFirst } from './notification-date-groups.js'
import { sessionForRole } from './contracts.js'
import { canAccessPage } from './safeguards.js'
import { Button, ConfirmDialog, Field, Icon, Modal, Notice, ShellActionsContext } from './components.jsx'
import { patientConversations } from './patient-view.js'
import { AuthShell } from './pages/AuthShell.jsx'
import { PasswordField } from './pages/PasswordField.jsx'
import { ClinicAssistant } from './assistant-panel.jsx'
import { loadConversationSummary, sendPresence } from './messaging-api.js'
import { listNotifications, readNotification, readAllNotifications } from './api-client.js'
export { Brand } from './Brand.jsx'
import { Brand } from './Brand.jsx'

const useLayoutEffectSafe=typeof window==='undefined'?React.useEffect:React.useLayoutEffect

const NAV_ICONS={
  dashboard:'home',book:'plusCalendar',appointments:'calendar',calendar:'calendar',schedule:'calendar',checkin:'checkin',queue:'queue',capacity:'activity',
  patients:'users',treatment:'tooth',billing:'receipt',hmo:'shield',inquiries:'message',messages:'message',prescriptions:'pill',followups:'followup',
  branches:'building',team:'users',analytics:'chart',users:'shield',pricing:'receipt',automations:'clock',archives:'archive',branding:'sparkles',assistant:'robot',closures:'calendar',hmos:'shield',wording:'mail',engagement:'sparkles',loyalty:'gift',me:'user'
}

const GROUPS={
  // Primary Patient destinations only (Phase 4B.3C-1): Home/Book/Visits/Messages/Payments/Me. Queue is contextual
  // (reached from Home's active-visit card, not a permanent nav item). HMO/Prescriptions/Follow-ups/Referral &
  // Loyalty remain fully reachable pages (see `pages` in safeguards.js and Me's secondary links) — they are just
  // not primary navigation destinations.
  patient:[['Overview',['dashboard']],['Booking',['book','appointments']],['Communication',['messages']],['Account',['billing','archives','me']]],
  staff:[['Clinic Operations',['dashboard','appointments','calendar','patients','handovers','schedules','leave','closures']],['Patient Care',['checkin','queue','capacity','prescriptions','followups']],['Billing & Finance',['billing','hmo']],['Marketing & Analytics',['inquiries','messages','engagement']],['Archives',['archives']]],
  dentist:[['Patient Care',['dashboard','schedule','queue','chart','treatment','prescriptions','followups']],['Clinic Operations',['patients','handovers','schedules','leave']],['Marketing & Analytics',['messages','wording']],['Archives',['archives']]],
  owner:[['Executive Dashboard',['dashboard']],['Clinic Operations',['branches','team','calendar','schedules','leave','handovers']],['Patient Care',['capacity','prescriptions']],['Billing & Finance',['pricing','hmo','hmos']],['Marketing & Analytics',['analytics','engagement']],['Administration',['users','automations','closures','audit','branding','assistant']],['Archives',['archives']]],
}

// In a clinic-server session the capacity page is the factual live-queue view (src/pages/QueueCounts.jsx); the
// "Capacity"/"Workload" labels belong to the offline demo's estimators and are not shown for server sessions.
function navGroups(role,serverSession=false){
  const lookup=Object.fromEntries(NAV[role].map(([key,label])=>[key,serverSession&&key==='capacity'?'Live Queue by Branch':label]))
  return GROUPS[role].map(([title,keys])=>[title,keys.filter(k=>lookup[k]&&(!['calendar','closures','hmos','wording'].includes(k)||serverSession)).map(k=>[k,lookup[k]])]).filter(([,items])=>items.length)
}

// Authoritative clinic identity is the text "Dr. Dana E. Roxas" / "Dental Clinic", set beside the official compact
// logo (decorative, so empty alt). Never redraw or recolor the logo. logo-with-name.png is a supplied asset whose
// embedded wording differs from this identity, so it is intentionally not rendered.

// Real sign-in for every role (Backend Foundation 1B): the backend's GET /api/me determines role after a
// successful login, so one email+password form serves Patient/Staff/Dentist/Owner alike — there is no client
// role picker to trust or forge. `onLogin(email,password)` is expected to return a Promise resolving to
// `{ok:true}` or `{ok:false, message}` (see App.jsx / api-client.js); this component owns only its own
// submitting/error UI state, never the auth result itself.
export function Login({ onLogin, onShowRegister, onForgotPassword, initialEmail = '', notice = '' }) {
  const [email,setEmail]=React.useState(initialEmail||'')
  const passwordWrap=React.useRef(null)
  // After email verification the address is filled in and the empty password field takes focus.
  React.useEffect(()=>{if(initialEmail)passwordWrap.current?.querySelector('input')?.focus()},[initialEmail])
  const [password,setPassword]=React.useState('')
  const [submitting,setSubmitting]=React.useState(false)
  const [error,setError]=React.useState('')
  const submit=async event=>{
    event.preventDefault()
    if(submitting)return
    setError('')
    setSubmitting(true)
    const result=await onLogin(email,password)
    setSubmitting(false)
    if(!result?.ok)setError(result?.message||'Something went wrong. Try again.')
  }
  return <AuthShell><div className="auth-form" aria-labelledby="login-title">
      <div className="login-copy-wrap"><div className="eyebrow">Patient Portal</div><h1 id="login-title">Welcome back</h1><p className="login-copy">Sign in to continue to your clinic portal.</p></div>
      {notice&&<Notice tone="success" title={notice}/>}
      <form onSubmit={submit} noValidate aria-busy={submitting}>
        <Field label="Email" required><input type="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setError('')}}/></Field>
        <div ref={passwordWrap}><PasswordField label="Password" autoComplete="current-password" value={password} onChange={e=>{setPassword(e.target.value);setError('')}}/></div>
        {onForgotPassword&&<p className="login-forgot"><button type="button" className="text-link" onClick={onForgotPassword}>Forgot password?</button></p>}
        <p className="login-forgot"><a className="text-link" href="#claim-account">Registered at the clinic? Claim your online account</a></p>
        {error&&<Notice tone="warning" title="Couldn’t sign in">{error}</Notice>}
        <Button type="submit" className="login-button" icon="arrow" disabled={submitting}>{submitting?'Signing in…':'Sign in'}</Button>
      </form>
      {onShowRegister&&<p className="login-register-link">New patient? <button type="button" className="text-link" onClick={onShowRegister}>Create an account</button></p>}
    </div></AuthShell>
}

// A backend target is a page hint, not a legacy entity/action or a record-access grant.
// IDs have different meanings even within one target page (e.g. handovers).
export function serverNotificationDestination(state, session, notification) {
  if (!session?.serverUserId || !notification?.target || typeof notification.target !== 'object') return null
  const page = { visits: 'appointments', billing: 'billing', messages: 'messages', book: 'book', handovers: 'handovers', leave: 'leave' }[notification.target.page]
  return page && canAccessPage(state, session, page) ? { page, context: null } : null
}

export function notificationFeedKey(session) {
  return JSON.stringify([session?.serverUserId || null, session?.userId || null, session?.role || null, session?.active === true])
}

export function serverNotificationSnapshot(result) {
  if (!result?.ok) throw new Error(result?.message || 'Notifications could not be loaded. Try again.')
  if (!Array.isArray(result.data) || !Number.isInteger(result.meta?.unread) || result.meta.unread < 0 || result.data.length > 50 ||
      result.data.some(n => !n || typeof n.id !== 'string' || typeof n.read !== 'boolean' || typeof n.title !== 'string' || (n.body != null && typeof n.body !== 'string'))) {
    throw new Error('Notifications could not be loaded. Try again.')
  }
  if (new Set(result.data.map(n => n.id)).size !== result.data.length || result.meta.unread < result.data.filter(n => !n.read).length) throw new Error('Notifications could not be loaded. Try again.')
  return { items: result.data.map(n => ({ id: n.id, title: n.title, body: n.body, read: n.read, target: n.target, createdAt: n.created_at, channel: 'In-app' })), unread: result.meta.unread }
}

// Render-keyed snapshots hide old-account data before effects run. Epoch objects also
// reject A -> B -> A responses, and cleanup invalidates in-flight work on unmount.
function useServerNotificationFeed(session, enabled = true) {
  const key = notificationFeedKey(session)
  const epoch = React.useRef(null)
  if (epoch.current?.key !== key) epoch.current = { key }
  const token = epoch.current
  const mounted = React.useRef(false)
  const generation = React.useRef(0)
  const pending = React.useRef(null)
  const [snapshot, setSnapshot] = React.useState(null)
  const run = React.useCallback(async (operation = listNotifications, mutation = false) => {
    if (!enabled || !session?.serverUserId || !session.active || pending.current === token || epoch.current !== token || !mounted.current) return false
    const requestId = ++generation.current
    pending.current = token
    setSnapshot(previous => ({ ...(previous?.token === token ? previous : { items: [], unread: null }), token, loading: !mutation, busy: mutation, error: '' }))
    try {
      const result = await operation()
      if (!mounted.current || epoch.current !== token || generation.current !== requestId) return false
      const data = serverNotificationSnapshot(result)
      setSnapshot({ ...data, token, loading: false, busy: false, error: '' })
      return true
    } catch (error) {
      if (!mounted.current || epoch.current !== token || generation.current !== requestId) return false
      // Never show stale feed contents as a successful empty result after failure.
      setSnapshot({ token, items: [], unread: null, loading: false, busy: false, error: error.message || 'Notifications are unavailable. Try again.' })
      return false
    } finally {
      if (pending.current === token && generation.current === requestId) pending.current = null
    }
  }, [enabled, token, session?.serverUserId, session?.active])
  useLayoutEffectSafe(() => {
    mounted.current = true
    run()
    return () => {
      mounted.current = false
      generation.current += 1
      if (pending.current === token) pending.current = null
    }
  }, [run, token])
  const current = !enabled || !session?.active ? { items: [], unread: null, loading: false, busy: false, error: 'Notifications are unavailable for this session.' } : snapshot?.token === token ? snapshot : { items: [], unread: null, loading: true, busy: false, error: '' }
  return { ...current, key, refresh: () => run(), mark: id => run(() => readNotification(id), true), markAll: () => run(readAllNotifications, true) }
}

export function NotificationPanel(props) {
  const session = props.store.session || sessionForRole(props.role, props.store.state)
  return <NotificationPanelContent key={notificationFeedKey(session)} {...props}/>
}

function NotificationPanelContent({role,store,onClose,setPage,serverFeed}){
  const {state,actions,toast}=store
  const session=store.session||sessionForRole(role,state)
  const server=!!session?.serverUserId
  const ownFeed=useServerNotificationFeed(session,server&&!serverFeed&&canAccessPage(state,session,'dashboard'))
  const feed=serverFeed||ownFeed
  const key=notificationFeedKey(session)
  const feedCurrent=feed.key===key
  const loading=server&&(!feedCurrent||feed.loading)
  const feedError=server&&feedCurrent?feed.error:''
  const items=sortNotificationsNewestFirst(server?(feedCurrent?feed.items:[]):visibleNotifications(state,session))
  const [all,setAll]=React.useState(false)
  const visible=all?items:items.slice(0,8)
  const dateGroups=groupNotificationsByDate(visible,clinicDate())
  const [busy,setBusy]=React.useState(false)
  const [failure,setFailure]=React.useState('')
  const pending=React.useRef(false)
  const scrollRegion=React.useRef(null)
  const focusOrigin=React.useRef(null)
  useLayoutEffectSafe(()=>{
    if(focusOrigin.current&&!focusOrigin.current.isConnected){scrollRegion.current?.focus({preventScroll:true});focusOrigin.current=null}
  })
  const live=React.useRef(true)
  useLayoutEffectSafe(()=>{live.current=true;return()=>{live.current=false}},[])
  const unread=server?(feedCurrent?feed.unread:null):items.filter(n=>!n.read).length
  const latest=React.useRef({state,session,key})
  latest.current={state,session,key}
  const destination=n=>server?serverNotificationDestination(state,session,n):notificationDestination(state,session,n)
  const perform=async command=>{
    if(pending.current||loading||feedError)return false
    pending.current=true
    focusOrigin.current=typeof document==='undefined'?null:document.activeElement
    setBusy(true);setFailure('')
    try {
      const result=await command()
      if(!live.current||latest.current.key!==key)return false
      if(!(server?result:result?.ok)){
        const message=result?.message||'Notifications could not be updated. Try again.'
        setFailure(message);toast?.(message,'warning');return false
      }
      return true
    } catch {
      if(!live.current||latest.current.key!==key)return false
      const message='Notifications could not be updated. Try again.'
      setFailure(message);toast?.(message,'warning');return false
    } finally {pending.current=false;if(live.current)setBusy(false)}
  }
  const mark=id=>perform(()=>server?feed.mark(id):actions.markNotificationRead(id))
  const open=async n=>{
    if(!destination(n)||!await mark(n.id)||!live.current||latest.current.key!==key)return
    const current=server?serverNotificationDestination(latest.current.state,latest.current.session,n):notificationDestination(latest.current.state,latest.current.session,n)
    if(current){setPage(current.page,current.context);onClose()}
  }
  const updating=busy||(server&&feed.busy)
  return <Modal open title="Notifications" subtitle={server?'Your latest 50 notifications':'Your updates and reminders'} onClose={onClose} className="notification-dialog a12-notifications"><div className="notification-popover">
    <div className="notification-summary"><span>{unread===null?'Unread count unavailable':unread?`${unread} unread`:'No unread updates'}</span><span role="status">{loading?'Loading notifications…':updating?'Updating read status…':feedError?'Notifications unavailable':`Showing ${visible.length} of ${items.length}${server?' recent records':''}`}</span></div>
    <div className="notification-toolbar"><button type="button" onClick={()=>perform(()=>server?feed.markAll():actions.markAllNotificationsRead())} disabled={updating||loading||!!feedError||!unread}>Mark my notifications read</button><button type="button" disabled={loading||!!feedError} aria-pressed={all} onClick={()=>setAll(v=>!v)}>{all?'Recent only':server?`Show loaded history (${items.length})`:`View all (${items.length})`}</button></div>
    {server&&<p>This is recent history, limited to 50 records. The unread count includes older notifications.</p>}
    {feedError&&<p className="notification-failure" role="alert" tabIndex={0}>{feedError} <button type="button" onClick={()=>{setFailure('');feed.refresh()}}>Retry notifications</button></p>}
    {!feedError&&failure&&<p className="notification-failure" role="alert" tabIndex={0}><b>Read status wasn’t updated.</b> {failure}</p>}
    <div ref={scrollRegion} className="notification-scroll" role="region" aria-label={server?'Recent notification history':'Notification history'} tabIndex={0} aria-busy={loading||updating}>{loading?<p role="status">Loading notifications…</p>:feedError?null:visible.length?dateGroups.map(group=><section key={group.key}>
      <h3 className="notification-date-heading">{group.label}</h3>
      <ul className="notification-list">{group.items.map(n=><li className={`notification-row ${n.read?'':'unread'}`} key={n.id}><span className="notification-dot" aria-hidden="true"/><div><b>{!n.read&&<><span className="sr-only">Unread: </span><span className="notification-unread-label" aria-hidden="true">Unread</span></>}{n.title}</b><p>{n.body}</p><small>{n.createdAt||'Date unavailable'} • {n.legacy?'Historical demo record':n.channel}</small><div className="row-actions">{!n.read&&<button type="button" disabled={updating} onClick={()=>mark(n.id)}>Mark read</button>}{destination(n)&&<button type="button" className="notification-view" disabled={updating} onClick={()=>open(n)}>View update</button>}</div></div></li>)}</ul>
    </section>):<div className="notification-empty"><Icon name="bell" size={28}/><b>{server?'No recent notifications.':"You're all caught up."}</b><p>{server?'No records were returned for your account.':'No updates to show in this workspace.'}</p></div>}</div>
  </div></Modal>
}

// M7: the Patient-only Clinic Assistant lives in assistant-panel.jsx (server-backed in a clinic-server session; an offline demo
// preview otherwise). Shell renders it only for role==='patient'. See PHASE4B3_ONBOARDING_BOOKING.md for the FAB placement rules.
// Patient mobile Menu (the bottom nav's 4th item, replacing "Me" as a permanent destination). Reuses Modal
// for accessible dialog/focus-trap behavior; the CSS class alone makes it read as a bottom sheet on mobile,
// not the Staff/Dentist/Owner-styled workspace drawer. Pass 1 remediation: a curated, grouped directory
// (Bookings / Communications / Account) rather than a flat secondary-page list. Logout is visually separated at
// the bottom and only *requests* logout (see Shell's logout-confirmation dialog) — it never logs out directly.
const MENU_GROUPS=[
  ['Bookings',[['book','plusCalendar','Book Appointment'],['appointments','calendar','Visits']]],
  ['Communications',[['messages','message','Messages']]],
  ['Account',[
    ['billing','receipt','Receipts & Payments'],['hmo','shield','HMO coverage'],
    ['prescriptions','pill','Prescriptions'],['followups','followup','Follow-up care'],
    ['loyalty','gift','Referral & Loyalty'],['feedback','message','Share feedback'],['me','user','My Profile'],
  ]],
]
export function PatientMenuSheet({ open, onClose, setPage, name, unreadMessages=0, onRequestLogout }) {
  const go=page=>{onClose();setPage(page)}
  return <Modal open={open} title="Menu" onClose={onClose} className="patient-menu-dialog">
    <div className="patient-menu">
      {name&&<div className="patient-menu-identity"><b>{name}</b></div>}
      {MENU_GROUPS.map(([heading,items])=><div className="patient-menu-group" key={heading}>
        <h3 className="patient-menu-heading">{heading}</h3>
        <ul className="patient-menu-list">{items.map(([page,icon,label])=><li key={page}><button type="button" onClick={()=>go(page)}>
          <span aria-hidden="true"><Icon name={icon} size={18}/></span><span>{label}</span>
          {page==='messages'&&unreadMessages>0&&<span className="pt-nav-badge"><span aria-hidden="true">{unreadMessages}</span><span className="sr-only">, {unreadMessages} unread</span></span>}
        </button></li>)}</ul>
      </div>)}
      <button type="button" className="patient-menu-logout" onClick={()=>{onClose();onRequestLogout()}}>
        <span aria-hidden="true"><Icon name="logout" size={18}/></span><span>Sign out</span>
      </button>
    </div>
  </Modal>
}

export function Shell({ role, page, setPage, onLogout, activeBranch, setActiveBranch, store, children }) {
  const info=ROLE_INFO[role]
  const [mobileOpen,setMobileOpen]=React.useState(false)
  const [notificationsOpen,setNotificationsOpen]=React.useState(false)
  const [assistantOpen,setAssistantOpen]=React.useState(false)
  const [patientMenuOpen,setPatientMenuOpen]=React.useState(false)
  const [logoutConfirmOpen,setLogoutConfirmOpen]=React.useState(false)
  const session=store.session||sessionForRole(role,store.state)
  const account=store.state.users.find(u=>u.id===session?.userId)
  const name=account?.name||session?.name||info.label
  const initials=name.split(' ').map(x=>x[0]).filter(Boolean).slice(0,2).join('')
  const notificationFeed=useServerNotificationFeed(session,!!session?.serverUserId&&canAccessPage(store.state,session,'dashboard'))
  const unread=session?.serverUserId?notificationFeed.unread:visibleNotifications(store.state,session).filter(n=>!n.read).length
  React.useEffect(()=>{if(notificationsOpen&&session?.serverUserId)notificationFeed.refresh()},[notificationsOpen,session?.serverUserId])
  const groups=navGroups(role,!!session?.serverUserId).map(([title,items])=>[title,items.filter(([key])=>canAccessPage(store.state,session,key))]).filter(([,items])=>items.length)
  const currentPage=canAccessPage(store.state,session,page)?(groups.flatMap(([,items])=>items).find(([key])=>key===page)?.[1]||NAV[role].find(([key])=>key===page)?.[1]):null
  // M17: in a clinic-server session the unread badge comes ONLY from the server (null = not known yet / unavailable: no badge, never a number).
  const [serverUnread,setServerUnread]=React.useState(null)
  React.useEffect(()=>{
    if(role!=='patient'||!session?.serverUserId)return
    let live=true
    loadConversationSummary().then(r=>{if(live)setServerUnread(r.ok?r.unread:null)})
    return()=>{live=false}
  },[role,session?.serverUserId,page])
  // M17 presence heartbeat: while a signed-in Patient's tab is visible, tell the server every 45 s so it does not email a "new message"
  // alert for a message they can already see. Nothing about presence is shown to anyone.
  React.useEffect(()=>{
    if(role!=='patient'||!session?.serverUserId||typeof document==='undefined')return
    const beat=()=>{if(document.visibilityState==='visible')sendPresence()}
    beat()
    const timer=setInterval(beat,45000)
    document.addEventListener('visibilitychange',beat)
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',beat)}
  },[role,session?.serverUserId])
  const unreadMessages=role==='patient'?(session?.serverUserId?(Number.isInteger(serverUnread)?serverUnread:0):patientConversations(store.state,session).filter(c=>c.unread).length):0
  // Lets a booking page observe an in-app Patient navigation (Pass 2: an honest "booking saved"/"couldn't
  // be saved" toast) without Shell owning that page's state, and without ever blocking navigation itself —
  // the listener is purely notified, its return value is never consulted. Logout goes through the
  // separate `onLogout` prop below, never through this path, so it can never trigger the listener.
  const patientNavListenerRef=React.useRef(null)
  const shellActions=React.useMemo(()=>({
    openNotifications:()=>setNotificationsOpen(true),
    registerPatientNavListener:fn=>{patientNavListenerRef.current=fn},
  }),[])
  const notifyingSetPage=(key,record)=>{patientNavListenerRef.current?.(key,record);setPage(key,record)}
  const firstPage=React.useRef(true)
  // Patient page changes start at the top with focus on the main landmark. Deep-linked records focus themselves afterwards.
  useLayoutEffectSafe(()=>{
    if(role!=='patient')return
    if(firstPage.current){firstPage.current=false;return}
    window.scrollTo?.(0,0)
    document.getElementById('main-content')?.focus({preventScroll:true})
  },[page,role])
  // Exactly four primary mobile destinations: Home, Book, Visits, Menu. "Me" is no longer a permanent bottom-
  // nav destination — Profile and everything else (Messages, Payments, HMO, Prescriptions, Follow-ups,
  // Referral & Loyalty) live in the Menu sheet (PatientMenuSheet), reached through the 4th slot below.
  const mobilePatientNav=[['dashboard','Home'],['book','Book'],['appointments','Visits']].filter(([key])=>canAccessPage(store.state,session,key))
  const selectPage=key=>{if(canAccessPage(store.state,session,key))notifyingSetPage(key);setMobileOpen(false)}
  React.useEffect(()=>{
    const media=window.matchMedia('(min-width: 1025px)')
    const close=()=>{if(media.matches)setMobileOpen(false)}
    media.addEventListener('change',close)
    return ()=>media.removeEventListener('change',close)
  },[])
  const navigation=<><div className="role-card"><span aria-hidden="true">{initials}</span><div><small>{info.label}</small><b>{name}</b><em>{role==='owner'?'Branch oversight':activeBranch}</em></div></div>
    <nav className="main-nav" aria-label={`${info.label} navigation`}>{groups.map(([title,items])=><div className="nav-group" key={title}><span className="nav-group-label">{title}</span>{items.map(([key,label])=><button type="button" key={key} aria-current={page===key?'page':undefined} className={page===key?'active':''} onClick={()=>selectPage(key)}><Icon name={NAV_ICONS[key]||'home'} size={18}/><span>{label}</span></button>)}</div>)}</nav>
    <div className="sidebar-footer"><button type="button" onClick={()=>setLogoutConfirmOpen(true)}><Icon name="logout" size={16}/>Sign out</button></div></>
  return <ShellActionsContext.Provider value={shellActions}><div className={`app-shell a12-shell role-${role}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar"><div className="sidebar-brand"><Brand/></div>{navigation}</aside>
    <Modal open={mobileOpen} title="Your workspace" onClose={()=>setMobileOpen(false)} className="navigation-dialog"><div className="sidebar-brand"><Brand/></div>{navigation}</Modal>
    <div className="main-shell">
      <header className="topbar">
        <div className="topbar-left">{role!=='patient'&&<button className="mobile-menu icon-btn" type="button" aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(true)}><Icon name="menu" size={21}/></button>}<div className="topbar-context"><div className="workspace-heading"><span className="workspace-label">{info.label} workspace</span>{currentPage&&<b className="workspace-page">{currentPage}</b>}</div>{role==='owner'&&<label className="branch-scope"><span>Branch</span><select value={activeBranch} onChange={e=>setActiveBranch(e.target.value)}><option>All Branches</option>{store.state.branches.map(b=><option key={b.id}>{b.name}</option>)}</select></label>}{(role==='staff'||role==='dentist')&&<div className="branch-lock"><small>Assigned branch</small><b>{activeBranch}</b></div>}</div></div>
        <div className="top-actions"><button className="top-icon-btn" aria-haspopup="dialog" aria-expanded={notificationsOpen} onClick={()=>setNotificationsOpen(true)} aria-label={`Notifications${unread?`, ${unread} unread`:''}`}><Icon name="bell" size={20}/>{unread>0&&<span aria-hidden="true" className="notification-count">{unread>99?'99+':unread}</span>}</button><div className="top-user"><span aria-hidden="true">{initials}</span><div><b>{name}</b><small>{info.label}</small></div></div></div>
      </header>
      <main id="main-content" tabIndex={-1} className="content">{children}</main>
    </div>
    {notificationsOpen&&<NotificationPanel role={role} store={store} serverFeed={notificationFeed} setPage={setPage} onClose={()=>setNotificationsOpen(false)}/>}
    {role==='patient'&&<nav className="patient-mobile-nav" aria-label="Patient shortcuts">
      {mobilePatientNav.map(([key,label])=><button key={key} aria-current={page===key?'page':undefined} className={page===key?'active':''} onClick={()=>selectPage(key)}><Icon name={NAV_ICONS[key]||'home'} size={20}/><span>{label}</span>{key==='messages'&&unreadMessages>0&&<span className="pt-nav-badge"><span aria-hidden="true">{unreadMessages}</span><span className="sr-only">, {unreadMessages} unread</span></span>}</button>)}
      <button type="button" aria-haspopup="dialog" aria-expanded={patientMenuOpen} onClick={()=>setPatientMenuOpen(true)}><Icon name="menu" size={20}/><span>Menu</span>{unreadMessages>0&&<span className="pt-nav-badge"><span aria-hidden="true">{unreadMessages}</span><span className="sr-only">, {unreadMessages} unread</span></span>}</button>
    </nav>}
    {role==='patient'&&<PatientMenuSheet open={patientMenuOpen} onClose={()=>setPatientMenuOpen(false)} setPage={notifyingSetPage} name={name} unreadMessages={unreadMessages} onRequestLogout={()=>setLogoutConfirmOpen(true)}/>}
    <ConfirmDialog open={logoutConfirmOpen} title="Sign out?" tone="default" confirmLabel="Sign out" cancelLabel="Cancel" className="patient-logout-dialog" onConfirm={()=>{setLogoutConfirmOpen(false);onLogout()}} onCancel={()=>setLogoutConfirmOpen(false)}>
      Are you sure you want to sign out of your account?
    </ConfirmDialog>
    {role==='patient'&&<ClinicAssistant open={assistantOpen} onOpenChange={setAssistantOpen} server={!!store?.session?.serverUserId} onContact={()=>notifyingSetPage('messages')}/>}
  </div></ShellActionsContext.Provider>
}

export function ToastStack({ toasts }) {
  return <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">{toasts.map(t=><div className={`toast ${t.tone||''}`} key={t.id}><span className="toast-icon">{t.tone==='success'?'✓':t.tone==='warning'?'!':'i'}</span><span>{t.message}</span></div>)}</div>
}
