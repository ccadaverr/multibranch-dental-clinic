import { validSession, canAccessPage } from './safeguards.js'
import { ClinicalNavigation, useClinicalNavigation } from './clinical-navigation.jsx'
import { clinicalSessionKey } from './encounter.js'
import { Notice } from './components.jsx'
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ClinicProvider, useClinic } from './store.jsx'
import { Brand, Login, Shell, ToastStack } from './layout.jsx'
import { EmailVerification } from './pages/EmailVerification.jsx'
import { PublicSite } from './pages/PublicSite.jsx'
import { PublicLegal } from './pages/PublicLegal.jsx'
import { publicViewFromHash, publicSections } from './public-route.js'
import { ChunkBoundary, StartupLoading } from './StartupLoading.jsx'
import { AuthShell } from './pages/AuthShell.jsx'
import { AcceptInvitation } from './pages/AcceptInvitation.jsx'
import { PasswordReset } from './pages/PasswordReset.jsx'
import { RespondLink } from './pages/RespondLink.jsx'
import { ClaimAccount } from './pages/ClaimAccount.jsx'
const JoinPage=lazy(()=>import('./pages/Join.jsx').then(m=>({default:m.JoinPage})))
import { stopRealtime } from './realtime.js'
import { bootstrapSession } from './session-bootstrap.js'
import { createAuthenticationOwner } from './login-lifecycle.js'
import { clearInvoiceLinkFromUrl, readInvoiceLink, rememberInvoiceLink, takeInvoiceLink } from './invoice-link.js'
import { clearPageLinkFromUrl, pageForLink, readPageLink, rememberPageLink, takePageLink } from './page-link.js'

const PatientPortal=lazy(()=>import('./patient/Portal.jsx').then(m=>({default:m.PatientPortal})))
const PatientRegister=lazy(()=>import('./pages/PatientRegister.jsx').then(m=>({default:m.PatientRegister})))
import * as api from './api-client.js'

const DashboardPage=lazy(()=>import('./pages/Dashboards.jsx').then(m=>({default:m.DashboardPage})))
const AppointmentsPage=lazy(()=>import('./pages/Scheduling.jsx').then(m=>({default:m.AppointmentsPage})))
const BookingPage=lazy(()=>import('./pages/Scheduling.jsx').then(m=>({default:m.BookingPage})))
const StaffDayCalendar=lazy(()=>import('./pages/StaffDayCalendar.jsx').then(m=>({default:m.StaffDayCalendar})))
const SchedulePage=lazy(()=>import('./pages/Scheduling.jsx').then(m=>({default:m.SchedulePage})))
const CheckInPage=lazy(()=>import('./pages/PatientFlow.jsx').then(m=>({default:m.CheckInPage})))
const QueuePage=lazy(()=>import('./pages/PatientFlow.jsx').then(m=>({default:m.QueuePage})))
const CapacityPage=lazy(()=>import('./pages/PatientFlow.jsx').then(m=>({default:m.CapacityPage})))
const PatientsPage=lazy(()=>import('./pages/Clinical.jsx').then(m=>({default:m.PatientsPage})))
const TreatmentPage=lazy(()=>import('./pages/Clinical.jsx').then(m=>({default:m.TreatmentPage})))
const PrescriptionsPage=lazy(()=>import('./pages/ServerPrescriptions.jsx').then(m=>({default:m.PrescriptionsServerPage})))
const PatientPrescriptionsPage=lazy(()=>import('./patient/pages/Prescriptions.jsx').then(m=>({default:m.PrescriptionsPage})))
const DentalChartPage=lazy(()=>import('./pages/DentalChart.jsx').then(m=>({default:m.DentalChartPage})))
const FollowupsPage=lazy(()=>import('./pages/ServerFollowups.jsx').then(m=>({default:m.FollowupsServerPage})))
const BillingPage=lazy(()=>import('./pages/FinanceCommunication.jsx').then(m=>({default:m.BillingPage})))
const HmoPage=lazy(()=>import('./pages/FinanceCommunication.jsx').then(m=>({default:m.HmoPage})))
const InquiriesPage=lazy(()=>import('./pages/FinanceCommunication.jsx').then(m=>({default:m.InquiriesPage})))
const MessagesPage=lazy(()=>import('./pages/FinanceCommunication.jsx').then(m=>({default:m.MessagesPage})))
const ArchivesPage=lazy(()=>import('./pages/ArchivesPage.jsx').then(m=>({default:m.ArchivesPage})))
const PatientLoyaltyPage=lazy(()=>import('./pages/PatientLoyalty.jsx').then(m=>({default:m.PatientLoyaltyPage})))
const PatientMePage=lazy(()=>import('./pages/PatientMe.jsx').then(m=>({default:m.PatientMePage})))
const AnalyticsPage=lazy(()=>import('./pages/Admin.jsx').then(m=>({default:m.AnalyticsPage})))
// Automation monitor retired
const ClosedDatesPage=lazy(()=>import('./pages/ClosedDates.jsx').then(m=>({default:m.ClosedDatesPage})))
const WorkSchedulesPage=lazy(()=>import('./pages/Staffing.jsx').then(m=>({default:m.WorkSchedulesPage})))
const LeavePage=lazy(()=>import('./pages/Staffing.jsx').then(m=>({default:m.LeavePage})))
const HandoversPage=lazy(()=>import('./pages/Handovers.jsx').then(m=>({default:m.HandoversPage})))
const AcceptedHmosPage=lazy(()=>import('./pages/AcceptedHmos.jsx').then(m=>({default:m.AcceptedHmosPage})))
const WordingApprovalsPage=lazy(()=>import('./pages/WordingApprovals.jsx').then(m=>({default:m.WordingApprovalsPage})))
const AutomationsPage=lazy(()=>import('./pages/Automations.jsx').then(m=>({default:m.AutomationsPage})))
const AssistantAnswersPage=lazy(()=>import('./pages/AssistantAnswers.jsx').then(m=>({default:m.AssistantAnswersPage})))
const ClinicBrandingPage=lazy(()=>import('./pages/ClinicBranding.jsx').then(m=>({default:m.ClinicBrandingPage})))
const BranchesPage=lazy(()=>import('./pages/Admin.jsx').then(m=>({default:m.BranchesPage})))
const EngagementPage=lazy(()=>import('./pages/Admin.jsx').then(m=>({default:m.EngagementPage})))
const TeamPage=lazy(()=>import('./pages/Admin.jsx').then(m=>({default:m.TeamPage})))
const UsersPage=lazy(()=>import('./pages/Admin.jsx').then(m=>({default:m.UsersPage})))
const ServicesPricingPage=lazy(()=>import('./pages/Pricing.jsx').then(m=>({default:m.ServicesPricingPage})))
const AuditTrailPage=lazy(()=>import('./pages/AuditTrail.jsx').then(m=>({default:m.AuditTrailPage})))

const START_PAGE={patient:'dashboard',staff:'dashboard',dentist:'dashboard',owner:'dashboard'}
const NO_WORKSPACE_MESSAGE='This account doesn’t have a workspace configured yet. Contact the clinic administrator.'

function AuthChecking() {
  return <StartupLoading/>
}

// Backend Foundation 1B: an honest, distinct screen for "the clinic system could not be reached" — never a
// silent fallback to demo/local authentication, and never a crash.
function AuthUnavailable({ onRetry }) {
  return <AuthShell><div className="auth-form">
    <div className="login-copy-wrap"><h1>Can’t reach the clinic system</h1><p className="login-copy">The clinic system is temporarily unavailable. Check your connection and try again.</p></div>
    <button type="button" className="btn primary md" onClick={onRetry}><span>Try again</span></button>
  </div></AuthShell>
}

function RefDataLoading() {
  return <StartupLoading label="Loading your clinic workspace…"/>
}

// Phase 2A: an honest, distinct screen for "reference data couldn't load" — never a silent fallback to
// stale/empty branch/service/staff/dentist data (same non-negotiable rule the project already applies to
// persistence failures elsewhere: never return empty collections and pretend they're real).
function RefDataUnavailable({ onRetry }) {
  return <main className="login-shell"><section className="login-panel">
    <Brand className="brand-login"/>
    <div className="login-copy-wrap"><h1>Couldn’t load clinic data</h1><p className="login-copy">Branch, service and staffing information couldn’t be loaded. Check your connection and try again.</p></div>
    <button type="button" className="btn primary md" onClick={onRetry}><span>Try again</span></button>
  </section></main>
}

function AppBody() {
  const store=useClinic()
  const authenticationOwner=useRef(null)
  if(!authenticationOwner.current)authenticationOwner.current=createAuthenticationOwner(store.getAuthGeneration)
  useEffect(()=>{
    authenticationOwner.current.activate()
    return()=>authenticationOwner.current.dispose()
  },[])
  const clinicalNav=useClinicalNavigation(clinicalSessionKey(store.session))
  const clinicalNavRef=useRef(clinicalNav);clinicalNavRef.current=clinicalNav
  const [authPhase,setAuthPhase]=useState('checking')
  const [authError,setAuthError]=useState('')
  const [page,setPageState]=useState('dashboard')
  const [context,setContext]=useState(null)
  // An emailed or PayMongo-return link to one invoice is kept until the person is signed in (see invoice-link.js).
  useState(()=>{if(typeof window!=='undefined'){rememberInvoiceLink(readInvoiceLink(window.location.search));rememberPageLink(readPageLink(window.location.search))}return null})
  // Taken once, then kept for this signed-in session: a repeated session start (React StrictMode runs effects twice in
  // development) re-applies the same link instead of falling back to the start page. Cleared on sign-out.
  const invoiceLink=useRef(undefined)
  const [activeBranch,setActiveBranch]=useState('All Branches')
  const [publicView,setPublicView]=useState(()=>publicViewFromHash(typeof window==='undefined'?'':window.location.hash))
  const showRegister=publicView==='register'
  const setShowRegister=value=>{window.location.hash=value?'create-account':'sign-in';setPublicView(value?'register':'login')}
  useEffect(()=>{
    const navigate=()=>clinicalNavRef.current.request(()=>{
      const hash=window.location.hash
      setPublicView(publicViewFromHash(hash))
      setVerification(null)
      const section=hash.slice(1)
      requestAnimationFrame(()=>{
        if(publicSections.has(section))document.getElementById(section)?.scrollIntoView()
        else {window.scrollTo(0,0);document.getElementById('public-main')?.focus({preventScroll:true})}
      })
    })
    window.addEventListener('hashchange',navigate)
    return()=>window.removeEventListener('hashchange',navigate)
  },[])
  const [verification,setVerification]=useState(null)
  // Decision 1: a verified email does not sign in. The sign-in page opens with the email filled in and this message.
  const [signInNotice,setSignInNotice]=useState(null)
  const [serverMe,setServerMe]=useState(null)
  useEffect(()=>{
    if(authPhase==='checking'||publicView!=='home')return
    const section=window.location.hash.slice(1)
    if(publicSections.has(section))requestAnimationFrame(()=>document.getElementById(section)?.scrollIntoView())
  },[authPhase,publicView])

  // Backend role is authoritative, always. This is a *derived* value, never independent state a stale login
  // could leave behind — see identity-bridge.js for how it gets here.
  const role=store.session?.role??null

  // Server identity fields from /api/me travel with the local compatibility session: the Patient public_id (M6/M4
  // ownership, resolved server-side) and the Staff authorization branch scopes. Neither is ever taken from browser input.
  const enterSession=(session,me)=>{
    setServerMe(me||null);setSignInNotice(null)
    store.adoptSession({...session,serverUserId:me?.id??null,patientPublicId:me?.patient?.id??null,branchScopes:Array.isArray(me?.branch_scopes)?me.branch_scopes.map(b=>b.id):[]})
    setContext(null)
    setPageState(START_PAGE[session.role]||'dashboard')
    setActiveBranch(store.state.branches.find(b=>b.id===session.branchId)?.name||'All Branches')
    setPublicView('login')
    if(invoiceLink.current===undefined)invoiceLink.current=takeInvoiceLink()
    const link=invoiceLink.current
    if(link){
      clearInvoiceLinkFromUrl()
      // Only a Patient's own billing page takes the link; the server still decides whether the invoice is theirs.
      if(session.role==='patient'){setContext(link);setPageState('billing')}
    }
    // Links from the automation emails (reminder, rebook, recall, waitlist, Owner summary).
    const target=link?null:pageForLink(takePageLink(),session.role)
    if(!link)clearPageLinkFromUrl()
    if(target){setContext(target[1]);setPageState(target[0])}
  }

  const checkSession=async()=>{
    const ticket=authenticationOwner.current.begin()
    if(!ticket)return
    setAuthPhase('checking')
    setAuthError('')
    const result=await bootstrapSession(api.me)
    if(!authenticationOwner.current.current(ticket))return
    if(result.ok){
      const bridge=store.actions.bridgeBackendIdentity(result.data)
      if(bridge.ok){
        enterSession(bridge.session,result.data)
        setAuthPhase('authenticated')
        return
      }
      // Authenticated at the backend, but this checkpoint's frontend has no local operational identity for
      // this account (see identity-bridge.js) — fail closed rather than show a broken workspace, and don't
      // leave a dangling backend session behind either.
      await api.logout()
      if(!authenticationOwner.current.current(ticket))return
      setAuthError(NO_WORKSPACE_MESSAGE)
      setAuthPhase('unauthenticated')
      return
    }
    setAuthPhase(result.kind==='unauthenticated'?'unauthenticated':'error')
  }
  // Session restoration on load/refresh comes only from the backend session, never from localStorage.
  useEffect(()=>{checkSession()},[])

  const login=async(email,password,{isCurrent=()=>true}={})=>{
    const ticket=authenticationOwner.current.begin(isCurrent)
    const obsolete={ok:false,obsolete:true}
    if(!ticket)return obsolete
    setAuthError('')
    const result=await api.login(email,password)
    if(!authenticationOwner.current.current(ticket))return obsolete
    if(!result.ok){
      if(result.kind==='email_verification_required'){
        setVerification({email})
        window.history.replaceState(null,'','#verify-email')
      }
      const message=result.kind==='validation'?(Object.values(result.errors||{})[0]?.[0]||result.message):result.message
      return {ok:false,message:message||'Something went wrong. Try again.'}
    }
    const bridge=store.actions.bridgeBackendIdentity(result.data)
    if(!bridge.ok){
      await api.logout()
      if(!authenticationOwner.current.current(ticket))return obsolete
      return {ok:false,message:NO_WORKSPACE_MESSAGE}
    }
    enterSession(bridge.session,result.data)
    setAuthPhase('authenticated')
    return {ok:true}
  }

  const register=async form=>{
    setAuthError('')
    const result=await api.register(form)
    if(!result.ok)return result
    setVerification({email:result.data.email,resendAvailableAt:result.data.resend_available_at})
    setPublicView('login')
    window.history.replaceState(null,'','#verify-email')
    window.scrollTo(0,0)
    return {ok:true}
  }

  const verifyRegistration=async ({email,otp})=>{
    const result=await api.verifyRegistrationEmail(email,otp)
    if(!result.ok)return result
    setVerification(null)
    setSignInNotice({email:result.data?.email||email,message:'Your account is verified. Please sign in.'})
    window.history.replaceState(null,'','#sign-in');setPublicView('login')
    return {ok:true}
  }

  const resendRegistration=async email=>api.resendRegistrationEmail(email)


  const signedOut=()=>{
    authenticationOwner.current.invalidate()
    stopRealtime() // M17: no socket keeps listening for the previous account
    store.adoptSession(null)
    setServerMe(null)
    invoiceLink.current=null
    setContext(null);setPageState('dashboard');setActiveBranch('All Branches');setShowRegister(false);setVerification(null)
    setAuthPhase('unauthenticated')
  }

  const logout=async()=>{
    const ticket=authenticationOwner.current.begin(()=>true,()=>latest.current.session?.serverUserId)
    if(!ticket)return
    const result=await api.logout()
    if(!authenticationOwner.current.current(ticket))return
    // Clear this account's compatibility session while this sign-out still owns
    // it, with honest feedback about whether the backend confirmed the close.
    signedOut()
    store.toast(
      result.backendConfirmed?'You’re signed out.':'Signed out on this device, but the server session close could not be confirmed.',
      result.backendConfirmed?'default':'warning'
    )
  }

  // A 401 from an authenticated call (M6 appointment reads, availability and commands report it through
  // api.onSessionInvalidated) means the server session may be gone. Revalidate with /api/me: unless the server confirms
  // the same account is still signed in, return to the normal signed-out Login state. Nothing is retried — the failed
  // command already reported its failure — and browser-local Booking Drafts are left intact for the next sign-in.
  // Account security changes (email or password) end every session on the server: return to sign-in with a clear message.
  const signedOutForSecurity=async({email,message})=>{
    const ticket=authenticationOwner.current.begin(()=>true,()=>latest.current.session?.serverUserId)
    if(!ticket)return
    await api.logout()
    if(!authenticationOwner.current.current(ticket))return
    signedOut()
    setSignInNotice({email,message})
    window.history.replaceState(null,'','#sign-in');setPublicView('login')
  }

  const latest=useRef(null)
  latest.current={session:store.session,signedOut}
  const revalidating=useRef(false)
  useEffect(()=>api.onSessionInvalidated(async()=>{
    if(revalidating.current||!latest.current.session)return
    // This event itself invalidates the clinical auth generation. Revalidation
    // and sign-out follow the current server identity plus App request lifetime.
    const ticket=authenticationOwner.current.begin(()=>true,()=>latest.current.session?.serverUserId)
    if(!ticket)return
    revalidating.current=true
    try{
      const valid=await api.sessionStillValid(latest.current.session.serverUserId)
      if(!authenticationOwner.current.current(ticket))return
      const current=latest.current
      if(!current.session||valid)return
      current.signedOut()
      setAuthError('Your session has ended. Sign in again.')
    }finally{revalidating.current=false}
  }),[])

  const setPage=(next,record=null)=>{if(role&&canAccessPage(store.state,store.session,next)){clinicalNav.request(()=>{setContext(record);setPageState(next)})}}

  // F1–F3 one-time email links work without signing in (and whether or not someone is signed in on this browser).
  if(publicView==='respond')return <RespondLink hash={typeof window==='undefined'?'':window.location.hash}/>
  if(authPhase==='checking')return <AuthChecking/>
  if(authPhase==='error'&&publicView!=='home')return <AuthUnavailable onRetry={checkSession}/>
  // Counter registration (poster QR): public, also for a signed-in patient (who joins with their account).
  if(publicView==='join')return <ChunkBoundary><Suspense fallback={<AuthShell><StartupLoading compact label="Opening registration…"/></AuthShell>}><JoinPage hash={window.location.hash} signedInPatient={role==='patient'}/></Suspense></ChunkBoundary>

  const storageWarnings=Object.values(store.persistenceErrors||{})
  if(storageWarnings.some(message=>message.includes('could not be read')))return <Notice title="Saved workspace needs recovery">{storageWarnings.join(' ')}</Notice>

  if (!role) return <>
    {authError&&<Notice tone="warning">{authError}</Notice>}
    {publicView==='accept'
      ?<AcceptInvitation hash={typeof window==='undefined'?'':window.location.hash} onSignIn={()=>{window.location.hash='sign-in';setPublicView('login')}}/>
      :publicView==='forgot'
      ?<PasswordReset onSignIn={()=>{window.location.hash='sign-in';setPublicView('login')}}/>
      :verification||publicView==='verify'
      ?<EmailVerification email={verification?.email} initialResendAvailableAt={verification?.resendAvailableAt} onVerify={verifyRegistration} onResend={resendRegistration} onBack={()=>{setVerification(null);setShowRegister(false)}}/>
      :showRegister
      ?<ChunkBoundary><Suspense fallback={<AuthShell><StartupLoading compact label="Opening registration…"/></AuthShell>}><PatientRegister onRegister={register} onCancel={()=>{setAuthError('');setShowRegister(false)}}/></Suspense></ChunkBoundary>
      :publicView==='claim'?<ClaimAccount onVerified={email=>{setSignInNotice({email,message:'Your account is verified. Please sign in.'});window.history.replaceState(null,'','#sign-in');setPublicView('login')}}/>
      :publicView==='privacy'||publicView==='terms'?<PublicLegal kind={publicView}/>
      :publicView==='home'?<PublicSite/>
      :<Login key={signInNotice?.email||'login'} initialEmail={signInNotice?.email} notice={signInNotice?.message} onLogin={login} onShowRegister={()=>{setAuthError('');setShowRegister(true)}} onForgotPassword={()=>{setAuthError('');window.location.hash='forgot-password';setPublicView('forgot')}}/>}
    <ToastStack toasts={store.toasts}/>
  </>

  // Phase 2A: gate on reference data before validSession/branch lookups run — otherwise a still-loading
  // (empty) branches collection could be misread as "your branch access changed" rather than "still
  // loading." No fake loading timer: this reflects the real fetch in flight, nothing more.
  if(store.refDataStatus==='loading'||store.refDataStatus==='idle')return <RefDataLoading/>
  if(store.refDataStatus==='error')return <RefDataUnavailable onRetry={store.retryReferenceData}/>

  if(!validSession(store.state,store.session))return <><Notice>Your account or branch access changed. Reopen your workspace or ask an administrator.</Notice><Login onLogin={login}/></>

  // The Patient portal (src/patient) reads the clinic server only; the legacy local-state patient screens are not used.
  if(role==='patient'&&serverMe?.patient?.id)return <>
    <ChunkBoundary><Suspense fallback={<StartupLoading label="Opening your portal…"/>}>
      <PatientPortal me={serverMe} store={store} initialPage={['billing','visits','book'].includes(page)?page:'home'} initialContext={['billing','visits'].includes(page)?context:null} onLogout={logout} onSignedOut={signedOutForSecurity}/>
    </Suspense></ChunkBoundary>
    <ToastStack toasts={store.toasts}/>
  </>

  const branch=role==='staff'||role==='dentist'?store.state.branches.find(b=>b.id===store.session?.branchId)?.name||'Unknown branch':activeBranch
  const props={role,activeBranch:branch,store,setPage,context}
  let content
  switch(canAccessPage(store.state,store.session,page)?page:'unavailable'){
    case 'dashboard': content=<DashboardPage {...props}/>; break
    case 'book': content=<BookingPage role={role} store={store} setPage={setPage} context={context}/>; break
    case 'appointments': content=<AppointmentsPage role={role} store={store} setPage={setPage} context={context}/>; break
    case 'schedule': content=<SchedulePage store={store}/>; break
    case 'calendar': content=<StaffDayCalendar store={store}/>; break
    case 'checkin': content=<CheckInPage {...props}/>; break
    case 'queue': content=<QueuePage {...props}/>; break
    case 'capacity': content=<CapacityPage {...props}/>; break
    case 'patients': content=<PatientsPage {...props}/>; break
    case 'treatment': content=<TreatmentPage {...props}/>; break
    case 'billing': content=<BillingPage role={role} store={store} context={context}/>; break
    case 'hmo': content=<HmoPage {...props}/>; break
    case 'inquiries': content=<InquiriesPage store={store}/>; break
    case 'messages': content=<MessagesPage {...props}/>; break
    case 'prescriptions': content=role==='patient'?<PatientPrescriptionsPage toast={store.toast}/>:<PrescriptionsPage {...props}/>; break
    case 'followups': content=role==='patient'?<Notice title="Follow-up visits">When your dentist asks to see you again, the clinic contacts you, or book it yourself in Book a visit.</Notice>:<FollowupsPage {...props}/>; break
    case 'branches': content=<BranchesPage store={store}/>; break
    case 'team': content=<TeamPage store={store}/>; break
    case 'analytics': content=<AnalyticsPage activeBranch={activeBranch} store={store}/>; break
    case 'users': content=<UsersPage store={store}/>; break
    case 'pricing': content=<ServicesPricingPage store={store}/>; break
    case 'automations': content=<AutomationsPage store={store} setPage={setPage}/>; break
    case 'closures': content=<ClosedDatesPage store={store} role={role}/>; break
    case 'chart': content=<DentalChartPage {...props}/>; break
    case 'schedules': content=<WorkSchedulesPage store={store} role={role}/>; break
    case 'leave': content=<LeavePage store={store} role={role}/>; break
    case 'handovers': content=<HandoversPage store={store} role={role}/>; break
    case 'hmos': content=<AcceptedHmosPage store={store}/>; break
    case 'wording': content=<WordingApprovalsPage store={store}/>; break
    case 'archives': content=<ArchivesPage store={store} role={role} activeBranch={branch}/>; break
    case 'branding': content=<ClinicBrandingPage/>; break
    case 'assistant': content=<AssistantAnswersPage store={store}/>; break
    case 'audit': content=<AuditTrailPage store={store}/>; break
    case 'engagement': content=<EngagementPage role={role} store={store}/>; break
    case 'loyalty': content=<PatientLoyaltyPage store={store}/>; break
    // feedback retired
    case 'me': content=<PatientMePage store={store} setPage={setPage}/>; break
    default: content=<Notice>This screen is no longer available with your current permissions. <button onClick={()=>setPage('dashboard')}>Return home</button></Notice>;
  }

  return <>
    <ClinicalNavigation.Provider value={clinicalNav.register}><Shell role={role} page={page} setPage={setPage} onLogout={()=>clinicalNav.request(logout)} activeBranch={branch} setActiveBranch={setActiveBranch} store={store}>{storageWarnings.length>0&&<Notice tone="warning">{[...new Set(storageWarnings)].join(" ")}</Notice>}<ChunkBoundary key={page}><Suspense fallback={<StartupLoading compact label="Loading this page…"/>}>{content}</Suspense></ChunkBoundary></Shell>{clinicalNav.dialog}</ClinicalNavigation.Provider>
    <ToastStack toasts={store.toasts}/>
  </>
}

export default function App(){return <ClinicProvider><AppBody/></ClinicProvider>}
