import { readCollection, writeCollection } from './persistence.js'
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  INITIAL_PERSONS,
  INITIAL_PATIENTS,
  INITIAL_TREATMENTS, INITIAL_INVOICES, INITIAL_HMO, INITIAL_INQUIRIES, INITIAL_CONVERSATIONS,
  INITIAL_NOTIFICATIONS, INITIAL_PRESCRIPTIONS, INITIAL_FOLLOWUPS, INITIAL_USERS, INITIAL_AUTOMATIONS,
  INITIAL_WORKFLOW_LOG, INITIAL_CAMPAIGNS, INITIAL_LOYALTY, INITIAL_AUDIT, INITIAL_BOOKING_DRAFTS
} from './data.js'
import { uid, nowLabel } from './logic.js'
import { clinicNow, rebaseDemoRecords } from './clock.js'
import { normalizeClinicState, sessionForEmployee, sessionForRole, persistableCollection } from './contracts.js'
import { createWorkflowActions } from './workflow.js'
import { createRegistrationAction } from './registration.js'
import { createIdentityBridge } from './identity-bridge.js'
import { fetchReferenceData, deriveDentistServiceAssignments } from './reference-data-bridge.js'
import * as appointmentsApi from './appointments-api.js'
import * as visitsApi from './visits-api.js'
import * as queueApi from './queue-api.js'
import { createLatestGate } from './queue-counts.js'
import * as treatmentsApi from './treatments-api.js'
import * as hmoApi from './hmo-api.js'
import { buildServerProjection, classifyLegacy, reanchorLocalEvidence } from './appointment-projection.js'
import { createAppointmentFlow } from './appointment-flow.js'
import { onSessionInvalidated } from './api-client.js'

const ClinicContext=createContext(null)
const STORAGE_PREFIX='dentalops-v4-'

// CLIN-11: runtime-only continuity, never a credential or a server session ID.
// Keep the controller private to ClinicProvider; consumers receive only its reader.
const clin11SetKey = values => Array.isArray(values) ? [...new Set(values)].sort() : null
function clin11AuthContext(session, state, referenceReady) {
  const user = state?.users?.find(u => u.id === session?.userId)
  const identity = session?.serverUserId ? JSON.stringify([
    session.serverUserId, session.role, session.userId, session.dentistId, session.staffId,
    session.patientId, session.patientPublicId, session.branchId, session.scopeBranchId, clin11SetKey(session.branchScopes),
  ]) : null
  const authority = JSON.stringify([user?.personId, user?.roleName || user?.role, user?.accountStatus || user?.status,
    user?.branchId, clin11SetKey(user?.permissions)])
  // Initial reference hydration and refresh loading are not authentication changes.
  // Once known, changed profile scopes invalidate old continuations, including ABA.
  const scope = !referenceReady ? null : JSON.stringify(session?.role === 'dentist'
    ? clin11SetKey(state?.dentists?.find(d => d.id === session.dentistId)?.branchIds)
    : session?.role === 'staff' ? state?.staff?.find(s => s.userId === session.userId)?.branchId ?? null : null)
  return {identity, authority, scope, usable: !!identity && (user?.accountStatus || user?.status) === 'Active'}
}
function createClin11AuthLifetime(readContext) {
  let generation = 0, context = null, invalidated = true
  const observe = () => {
    const next = readContext()
    if (next.scope === null && context?.identity === next.identity) next.scope = context.scope
    const changed = context ? next.identity !== context.identity || next.authority !== context.authority
      || context.scope !== null && next.scope !== null && next.scope !== context.scope : !!next.identity
    if (changed) generation++
    context = next
    if (!next.identity) invalidated = true
    return changed
  }
  return {
    adopt() {
      const wasInvalidated = invalidated, changed = observe()
      if (wasInvalidated && !changed && context.identity) generation++
      invalidated = !context.identity
    },
    rederive() {
      const previousIdentity = context?.identity
      observe()
      // Re-derivation cannot authenticate a different actor or restore an
      // invalidated lifetime. Only the existing explicit adoption path can.
      if (context.identity !== previousIdentity) invalidated = true
    },
    invalidate() { generation++; invalidated = true },
    getGeneration() {
      observe()
      return invalidated || !context.usable ? null : generation
    },
  }
}

function usePersist(key, initial, report, recoveryBlocked) {
  const blocked=useRef(false)
  const loadError=useRef(null)
  const [value,setValue]=useState(()=>{
    const seed=['queue','treatments','invoices','followups','prescriptions','hmo','notifications','conversations','inquiries'].includes(key)?rebaseDemoRecords(initial):initial
    // SSR smoke has no browser storage; it must not simulate a storage failure.
    if(typeof localStorage==='undefined')return seed
    const result=readCollection(localStorage,`${STORAGE_PREFIX}${key}`,seed)
    blocked.current=result.blocked;loadError.current=result.error
    if(result.blocked)recoveryBlocked.current=true
    return result.value
  })
  useEffect(()=>{
    if(blocked.current){report(key,loadError.current);return}
    if(recoveryBlocked.current)return
    if(typeof localStorage==='undefined')return
    const result=writeCollection(localStorage,`${STORAGE_PREFIX}${key}`,value)
    report(key,result.ok?null:result.message)
  },[key,value,report])
  return [value,setValue]
}

const cleanNamePart=value=>String(value||'').trim().replace(/\s+/g,' ')
const fullName=person=>[person?.firstName,person?.lastName].map(cleanNamePart).filter(Boolean).join(' ')

// Phase 2A: branches/services/branchServices/dentists/staff are backend-authoritative — see the Phase 2A
// plan, section J. They are deliberately NOT usePersist-backed (no localStorage for this slice, refetched
// fresh every session, mirroring how session/role are already never localStorage-cached) and are populated
// only by fetchReferenceData(), gated on the current session's role, below. dentistServiceAssignments is
// not its own fetched collection at all — it was always a *generated* array even in data.js, and stays
// that way here, derived from the fetched dentists' serviceIds (see deriveDentistServiceAssignments).
//
// `initialReferenceData` is a test-only injection point (Phase 2A plan, section P/S2B): when supplied, the
// five collections seed synchronously from it and the live fetch effect never fires. This exists because
// render-smoke.mjs renders ClinicProvider via renderToString, which runs render-phase code only — a real
// fetch-on-mount effect never executes under SSR, so the script needs a synchronous alternative rather than
// silently seeing empty reference data.
export function ClinicProvider({ children, initialReferenceData, initialServerAppointments, initialServerVisits, initialServerQueue, initialMyQueue, initialServerTreatments, initialMyTreatments, initialServerHmo, initialMyHmo, initialClaimDecisions }) {
  const recoveryBlocked=useRef(false)
  const [persistenceErrors,setPersistenceErrors]=useState({})
  const reportPersistence=useCallback((key,message)=>setPersistenceErrors(previous=>{
    if(previous[key]===message||!previous[key]&&!message)return previous
    const next={...previous};if(message)next[key]=message;else delete next[key];return next
  }),[])

  const [persons,setPersons]=usePersist('persons',INITIAL_PERSONS,reportPersistence,recoveryBlocked)
  const [services,setServices]=useState(initialReferenceData?.services??[])
  const [branchServices,setBranchServices]=useState(initialReferenceData?.branchServices??[])
  const [branches,setBranches]=useState(initialReferenceData?.branches??[])
  const [dentists,setDentists]=useState(initialReferenceData?.dentists??[])
  const [staff,setStaff]=useState(initialReferenceData?.staff??[])
  const dentistServiceAssignments=useMemo(()=>deriveDentistServiceAssignments(dentists),[dentists])
  const [refDataStatus,setRefDataStatus]=useState(initialReferenceData?'ready':'idle')
  const [patients,setPatients]=usePersist('patients',INITIAL_PATIENTS,reportPersistence,recoveryBlocked)
  // M6 cutover: appointments are server-authoritative. `serverAppointmentRows` holds the latest GET /api/appointments
  // result in memory only — it is never persisted to localStorage and never written by a local command. Any old
  // `dentalops-v4-appointments` browser data is simply no longer read (decision D5); it is not uploaded or cleared.
  const [serverAppointmentRows,setServerAppointmentRows]=useState(initialServerAppointments??[])
  const [appointmentsStatus,setAppointmentsStatus]=useState(initialServerAppointments?'ready':'idle')
  const [appointmentsError,setAppointmentsError]=useState('')
  const [appointmentsTruncated,setAppointmentsTruncated]=useState(false)
  // M9: which clinic day the last successful, complete-or-flagged queue response covered (memory only). Counts are shown only from it.
  const [queueSnapshot,setQueueSnapshot]=useState(null)
  const [directoryPatients,setDirectoryPatients]=useState([])
  // M8 cutover: Visits (Patient arrival / Clinical Encounter) are server-authoritative. `serverVisitRows` holds the
  // latest GET /api/visits result in memory only — never persisted, never written by a local command. The old
  // `dentalops-v4-check-ins` browser collection is no longer read (it is not uploaded or cleared).
  const [serverVisitRows,setServerVisitRows]=useState(initialServerVisits??[])
  // M9 cutover: the queue is server-authoritative. `serverQueueRows` (Staff/Dentist/Owner: GET /api/queue) and `myQueue`
  // (a Patient's own current queue state: GET /api/queue/mine) are held in memory only — never persisted, never written
  // by a local command. The old `dentalops-v4-queue` browser collection is no longer live state; it is read once, only
  // for the exact-link evidence re-anchor below, and is never uploaded or cleared.
  const [serverQueueRows,setServerQueueRows]=useState(initialServerQueue??[])
  const [myQueue,setMyQueue]=useState(initialMyQueue??null)
  const legacyLocalQueue=useMemo(()=>{
    if(typeof localStorage==='undefined')return []
    const result=readCollection(localStorage,`${STORAGE_PREFIX}queue`,[])
    return !result.blocked&&Array.isArray(result.value)?result.value:[]
  },[])
  // M5 cutover: Treatments are server-authoritative. `serverTreatmentRows` (Staff/Dentist/Owner: GET /api/treatments) and
  // `myTreatmentRows` (a Patient's own completed safe subset: GET /api/treatments/mine) are held in memory only — never
  // persisted, never written by a local command. The `dentalops-v4-treatments` browser collection below is PRE-SERVER
  // HISTORY only: read-only, never uploaded, never cleared, never written by a workflow command (commit() drops it).
  const [serverTreatmentRows,setServerTreatmentRows]=useState(initialServerTreatments??[])
  const [myTreatmentRows,setMyTreatmentRows]=useState(initialMyTreatments??[])
  // Server cursor to the Patient's OLDER completed Treatments when the automatic fetch stopped at its safety bound (null = all loaded).
  const [myTreatmentsCursor,setMyTreatmentsCursor]=useState(null)
  const [treatments,setTreatments]=usePersist('treatments',INITIAL_TREATMENTS,reportPersistence,recoveryBlocked)
  const [invoices,setInvoices]=usePersist('invoices',INITIAL_INVOICES,reportPersistence,recoveryBlocked)
  // M12 cutover: HMO memberships and cases are server-authoritative. `serverHmoRows` (Staff/Dentist/Owner: GET
  // /api/hmo-cases), `myHmoRows` (a Patient's own safe subset: /api/hmo-cases/mine) and `claimDecisionRows` (Visits whose
  // Patient has an active membership but no case) are held in memory only. The `dentalops-v4-hmo` browser collection is
  // read once as read-only HISTORY: never uploaded, never cleared, never written, and never part of the financial gate.
  const [serverHmoRows,setServerHmoRows]=useState(initialServerHmo??[])
  const [myHmoRows,setMyHmoRows]=useState(initialMyHmo??[])
  const [claimDecisionRows,setClaimDecisionRows]=useState(initialClaimDecisions??[])
  const hmo=useMemo(()=>{
    const seed=rebaseDemoRecords(INITIAL_HMO)
    if(typeof localStorage==='undefined')return seed
    const result=readCollection(localStorage,`${STORAGE_PREFIX}hmo`,seed)
    return !result.blocked&&Array.isArray(result.value)?result.value:seed
  },[])
  const [inquiries,setInquiries]=usePersist('inquiries',INITIAL_INQUIRIES,reportPersistence,recoveryBlocked)
  const [conversations,setConversations]=usePersist('conversations',INITIAL_CONVERSATIONS,reportPersistence,recoveryBlocked)
  const [notifications,setNotifications]=usePersist('notifications',INITIAL_NOTIFICATIONS,reportPersistence,recoveryBlocked)
  const [prescriptions,setPrescriptions]=usePersist('prescriptions',INITIAL_PRESCRIPTIONS,reportPersistence,recoveryBlocked)
  const [followups,setFollowups]=usePersist('followups',INITIAL_FOLLOWUPS,reportPersistence,recoveryBlocked)
  const [users,setUsers]=usePersist('users',INITIAL_USERS,reportPersistence,recoveryBlocked)
  const [automations,setAutomations]=usePersist('automations',INITIAL_AUTOMATIONS,reportPersistence,recoveryBlocked)
  const [workflowLog,setWorkflowLog]=usePersist('workflow-log',INITIAL_WORKFLOW_LOG,reportPersistence,recoveryBlocked)
  const [campaigns,setCampaigns]=usePersist('campaigns',INITIAL_CAMPAIGNS,reportPersistence,recoveryBlocked)
  const [loyalty,setLoyalty]=usePersist('loyalty',INITIAL_LOYALTY,reportPersistence,recoveryBlocked)
  const [audit,setAudit]=usePersist('audit',INITIAL_AUDIT,reportPersistence,recoveryBlocked)
  const [bookingDrafts,setBookingDrafts]=usePersist('booking-drafts',INITIAL_BOOKING_DRAFTS,reportPersistence,recoveryBlocked)
  const [toasts,setToasts]=useState([])
  const [session,setSessionState]=useState(null)
  const sessionRef=useRef(null)
  const stateRef=useRef(null)
  const referenceReadyRef=useRef(false), authOwnerLive=useRef(true), authLifetime=useRef(null)
  referenceReadyRef.current=refDataStatus==='ready'
  if(!authLifetime.current)authLifetime.current=createClin11AuthLifetime(()=>clin11AuthContext(sessionRef.current,stateRef.current,referenceReadyRef.current))
  // Stable closure over provider refs, so an old page/store snapshot reads the
  // CURRENT lifetime even after that page unmounts. No caller can advance it.
  const getAuthGeneration=useCallback(()=>authOwnerLive.current?authLifetime.current.getGeneration():null,[])
  useEffect(()=>{
    authOwnerLive.current=true
    const stop=onSessionInvalidated(()=>authLifetime.current.invalidate())
    // Effect replay is not a login/logout. A disposed provider's old reader
    // stays unavailable; StrictMode's synchronous setup restores the same owner.
    return()=>{authOwnerLive.current=false;stop()}
  },[])
  const actionsRef=useRef(null)
  const [clock,setClock]=useState(clinicNow)
  useEffect(()=>{const timer=setInterval(()=>{setClock(clinicNow());if(sessionRef.current?.role==='staff'){actionsRef.current?.evaluateOperationalReminders()}},15000);return ()=>clearInterval(timer)},[])
  // Server-provided identity fields (Patient public_id, Staff branch scopes from /api/me) survive local re-derivation.
  const setSession=role=>{
    const previous=sessionRef.current
    const derived=role?(previous?.employeeBridge&&previous.role===role?sessionForEmployee(stateRef.current,previous):sessionForRole(role,stateRef.current)):null
    const next=derived&&previous?.role===role?{...derived,serverUserId:previous.serverUserId??null,patientPublicId:previous.patientPublicId??null,branchScopes:previous.branchScopes}:derived
    sessionRef.current=next
    authLifetime.current.rederive()
    setSessionState(next)
    if(next?.role==='staff')actionsRef.current?.evaluateOperationalReminders()
    return next
  }

  // Phase 2A reference-data bootstrap (plan section H/J). Fires once a session exists, role-aware (Patient
  // never triggers a /api/staff call — see fetchReferenceData). A logged-out session clears back to idle so
  // the next login always refetches fresh, never stale cross-account data. Skipped entirely when
  // initialReferenceData was supplied (render-smoke's synchronous test-only path, see ClinicProvider's
  // own comment above).
  const [refDataRetryToken,setRefDataRetryToken]=useState(0)
  const retryReferenceData=()=>setRefDataRetryToken(t=>t+1)
  useEffect(()=>{
    if(initialReferenceData)return
    if(!session?.role){
      setRefDataStatus(current=>current==='idle'?current:'idle')
      setBranches([]);setServices([]);setBranchServices([]);setDentists([]);setStaff([])
      return
    }
    let cancelled=false
    setRefDataStatus('loading')
    fetchReferenceData(session.role).then(result=>{
      if(cancelled)return
      if(!result.ok){setRefDataStatus('error');return}
      setBranches(result.data.branches)
      setServices(result.data.services)
      setBranchServices(result.data.branchServices)
      setDentists(result.data.dentists)
      setStaff(result.data.staff)
      setRefDataStatus('ready')
    }).catch(()=>{if(!cancelled)setRefDataStatus('error')})
    return ()=>{cancelled=true}
  },[session?.role,initialReferenceData,refDataRetryToken])

  // Bugfix found during real-browser Phase 2A QA: sessionForRole(role,state) (contracts.js) computes
  // session.active by calling validSession(state,session) internally, at the moment the session is first
  // established (identity-bridge.js, synchronously inside login/checkSession). For Staff/Dentist,
  // validSession checks state.staff/state.dentists — which are now backend-fetched and still empty at
  // that exact moment, since the fetch above only starts once a session exists. The result: active got
  // permanently frozen false, and every subsequent render kept failing validSession even after the fetch
  // completed and state.staff/state.dentists were correctly populated — session itself was never
  // recomputed. (Patient/Owner are unaffected: their validSession checks don't depend on these two
  // collections.) Re-deriving the session once reference data is actually ready fixes this at its root,
  // without touching validSession/sessionForRole's logic or any other role's behavior.
  useEffect(()=>{
    if(refDataStatus==='ready'&&sessionRef.current&&['staff','dentist'].includes(sessionRef.current.role)){
      setSession(sessionRef.current.role)
    }
  },[refDataStatus])

  const personById=id=>persons.find(p=>p.id===id)
  const staffById=id=>staff.find(s=>s.id===id)
  const personProjection=(entity,{doctor=false}={})=>{
    const person=personById(entity.personId)
    const base=fullName(person)
    return {
      ...entity,
      firstName:person?.firstName||'', lastName:person?.lastName||'',
      email:person?.email||'', phone:person?.phone||'', dob:person?.dob||'', sex:person?.sexOther||person?.sex||'', sexOther:person?.sexOther||'', address:person?.address||'',
      name:doctor && base ? `Dr. ${base}` : base || entity.id,
    }
  }
  const projectedStaff=staff.map(s=>personProjection(s))
  const projectedDentists=dentists.map(d=>{
    const projected=personProjection(d,{doctor:true})
    const assistant=staffById(d.assistantStaffId)
    return {...projected,assistant:assistant?fullName(personById(assistant.personId)):'Unassigned'}
  })
  const projectedPatients=patients.map(p=>personProjection(p))
  const projectedUsers=users.map(u=>{
    const p=personById(u.personId)
    const base=fullName(p)
    const role=u.roleName||u.role
    const name=role==='Dentist'&&base?`Dr. ${base}`:base||u.username
    return {...u,name,email:p?.email||'',phone:p?.phone||'',firstName:p?.firstName||'',lastName:p?.lastName||''}
  })
  const serverProjection=buildServerProjection({rows:serverAppointmentRows,visitRows:serverVisitRows,queueRows:serverQueueRows,treatmentRows:serverTreatmentRows,myTreatmentRows,hmoRows:serverHmoRows,myHmoRows,claimDecisionRows,directory:directoryPatients,session,users,patients})
  // D5/M8/M9: records without a server Visit (pre-cutover appointments, browser-only encounters) carry
  // `legacyAppointment` so live decisions and KPIs can exclude them. The live queue is the server queue only.
  const legacy=classifyLegacy({treatments,invoices,prescriptions,followups,hmo,conversations,inquiries})

  const state={...normalizeClinicState({
    persons,services,branchServices,dentistServiceAssignments,branches,
    dentists:projectedDentists,staff:projectedStaff,patients:[...projectedPatients,...serverProjection.readModelPatients],appointments:serverProjection.appointments,
    visits:serverProjection.visits,queue:serverProjection.queue,myQueue,treatments:[...serverProjection.treatments,...legacy.treatments],invoices:legacy.invoices,hmo:[...serverProjection.hmo,...legacy.hmo],claimDecisions:serverProjection.claimDecisions,inquiries:legacy.inquiries,
    conversations:legacy.conversations,notifications,prescriptions:legacy.prescriptions,followups:legacy.followups,users:projectedUsers,
    automations,workflowLog,campaigns,loyalty,audit,bookingDrafts,clock,today:clock.date,
    // Whether server Visits are part of this session's projection (Staff/Dentist/Owner). Derived, never persisted.
    visitsProjected:!!initialServerVisits||['staff','dentist','owner'].includes(session?.role)
  })}
  stateRef.current=state
  // Observe committed permission/scope changes even while no clinical page is
  // mounted. Equivalent data refreshes leave the generation unchanged.
  useLayoutEffect(()=>{authLifetime.current.getGeneration()},[session,users,dentists,staff,refDataStatus])
  const migrationDone=useRef(false)
  useEffect(()=>{
    // Phase 2A: this effect re-derives branchId/serviceId cross-references on still-local records using
    // the current branches/services/dentists/staff — which are empty until the reference-data fetch
    // resolves (refDataStatus==='ready'). Running it earlier would null out every existing local
    // appointment/queue/treatment's branchId/serviceId against an empty branches/dentists/services set —
    // gating on refDataStatus prevents that (plan section S3 — legacy-ID cutover safety).
    if(migrationDone.current||recoveryBlocked.current||refDataStatus!=='ready')return
    migrationDone.current=true
    // Persist recovered IDs once, before a later branch rename can lose a legacy
    // name-based relationship. Preserve unknown dates; do not fabricate encounters.
    // A record with no projected counterpart (e.g. D5 legacy history kept out of the live collections) is left as-is.
    const migrate=(raw,projected,keys)=>raw.map(record=>{
      const next=projected.find(x=>x.id===record.id)
      return next?{...record,...Object.fromEntries(keys.map(key=>[key,next[key]??null]))}:record
    })
    setTreatments(persistableCollection('treatments',migrate(treatments,state.treatments.filter(t=>!t.server),['branchId','queueEntryId'])))
    setInvoices(persistableCollection('invoices',migrate(invoices,state.invoices,['branchId'])))
    setFollowups(migrate(followups,state.followups,['branchId']))
    setPatients(persistableCollection('patients',migrate(patients,state.patients,['preferredBranchId'])))
    setDentists(persistableCollection('dentists',migrate(dentists,state.dentists,['branchIds'])))
    setStaff(persistableCollection('staff',migrate(staff,state.staff,['branchId'])))
    setConversations(persistableCollection('conversations',state.conversations))
    setNotifications(state.notifications)
    setInquiries(persistableCollection('inquiries',state.inquiries))
  },[refDataStatus])
  const setters={
    setPersons,setServices,setBranchServices,setBranches,setDentists,setStaff,setPatients,
    setTreatments,setInvoices,setInquiries,setConversations,setNotifications,
    setPrescriptions,setFollowups,setUsers,setAutomations,setWorkflowLog,setCampaigns,setLoyalty,setAudit,
    setBookingDrafts
  }

  const toast=(message,tone='default')=>{
    const id=uid('toast'); setToasts(xs=>[...xs,{id,message,tone}]); setTimeout(()=>setToasts(xs=>xs.filter(x=>x.id!==id)),3200)
  }
  // `domain` is a stable module-map.js key, not a module number (see module-map.js).
  const log=(actor,action,domain='automation')=>{
    setAudit(xs=>[{id:uid('aud'),at:nowLabel(),actor,action,domain},...xs].slice(0,150))
  }
  const workflow=(domain,event,result,status='Success',eventType=null)=>{
    setWorkflowLog(xs=>[{id:uid('log'),at:nowLabel(),domain,event,eventType:eventType||event,result,status},...xs])
  }
  const actions={}
  const commit=rawPatch=>{
    // Appointments, Visits, the queue and Treatments are server-authoritative: no local command may write them (the
    // projection is refreshed from the server instead), so those keys are never applied or persisted. Pre-server treatment
    // history is read-only, so `treatments` is dropped as well.
    // M12: HMO cases are server-authoritative too (and browser HMO history is read-only), so `hmo` is dropped as well.
    const {appointments:_ignored,visits:_ignoredVisits,queue:_ignoredQueue,myQueue:_ignoredMyQueue,treatments:_ignoredTreatments,hmo:_ignoredHmo,claimDecisions:_ignoredClaimDecisions,...patch}=rawPatch
    // Advance immediately so repeated clicks before React renders see the commit.
    stateRef.current=normalizeClinicState({...stateRef.current,...patch})
    authLifetime.current.getGeneration()
    for(const [key,value] of Object.entries(patch))setters[`set${key[0].toUpperCase()}${key.slice(1)}`]?.(persistableCollection(key,value))
  }

  Object.assign(actions,createWorkflowActions({
    getState:()=>stateRef.current,
    getSession:()=>sessionRef.current,
    commit,
  }))
  // Public registration boundary: no session exists yet, so it does not go through createWorkflowActions' run()
  // (which requires validSession); it shares the same synchronous read/validate/commit discipline directly.
  actions.registerPatient=createRegistrationAction({getState:()=>stateRef.current,commit})
  // Backend Foundation 1B — TEMPORARY compatibility bridge (see identity-bridge.js). Translates a real,
  // backend-authenticated identity (GET /api/me) into the shape the still-frontend-local pages/selectors
  // already expect. Remove this wiring once the business modules it stands in for move to the backend.
  actions.bridgeBackendIdentity=createIdentityBridge({getState:()=>stateRef.current,commit})

  actionsRef.current=actions

  // Adopts an already-resolved session object as-is (Backend Foundation 1B: the identity-bridge's Patient path
  // produces an arbitrary sessionForUser()-shaped session, not one of the four fixed ROLE_INFO keys setSession
  // understands). Staff/Dentist/Owner keep using setSession(role) unchanged.
  const adoptSession=session=>{sessionRef.current=session;authLifetime.current.adopt();setSessionState(session)}

  // ---- M6 server appointments ------------------------------------------------------------------------------------
  // Applies fresh server rows to the in-memory projection immediately (so a local adapter command that follows a server
  // command sees the new status before React re-renders) and to React state.
  const applyServerRows=(rows,directory=directoryRef.current,visitRows=visitRowsRef.current,queueRows=queueRowsRef.current,mine=myQueueRef.current,treatmentRows=treatmentRowsRef.current,myTreatments=myTreatmentRowsRef.current,hmoRows=hmoRowsRef.current,myHmo=myHmoRowsRef.current,decisions=claimDecisionRowsRef.current)=>{
    const current=stateRef.current
    const projection=buildServerProjection({rows,visitRows,queueRows,treatmentRows,myTreatmentRows:myTreatments,hmoRows,myHmoRows:myHmo,claimDecisionRows:decisions,directory,session:sessionRef.current,users:current.users,patients:current.patients.filter(p=>!p.serverProjection)})
    stateRef.current=normalizeClinicState({...current,appointments:projection.appointments,visits:projection.visits,queue:projection.queue,myQueue:mine,treatments:[...projection.treatments,...current.treatments.filter(t=>!t.server)],hmo:[...projection.hmo,...current.hmo.filter(h=>!h.server)],claimDecisions:projection.claimDecisions,patients:[...current.patients.filter(p=>!p.serverProjection),...projection.readModelPatients]})
    hmoRowsRef.current=hmoRows
    myHmoRowsRef.current=myHmo
    claimDecisionRowsRef.current=decisions
    setServerHmoRows(hmoRows)
    setMyHmoRows(myHmo)
    setClaimDecisionRows(decisions)
    rowsRef.current=rows
    visitRowsRef.current=visitRows
    queueRowsRef.current=queueRows
    myQueueRef.current=mine
    treatmentRowsRef.current=treatmentRows
    myTreatmentRowsRef.current=myTreatments
    setServerAppointmentRows(rows)
    setServerVisitRows(visitRows)
    setServerQueueRows(queueRows)
    setMyQueue(mine)
    setServerTreatmentRows(treatmentRows)
    setMyTreatmentRows(myTreatments)
  }
  const rowsRef=useRef(serverAppointmentRows)
  const visitRowsRef=useRef(serverVisitRows)
  const queueRowsRef=useRef(serverQueueRows)
  const refreshGate=useRef(createLatestGate()).current
  const myQueueRef=useRef(myQueue)
  const treatmentRowsRef=useRef(serverTreatmentRows)
  const myTreatmentRowsRef=useRef(myTreatmentRows)
  const hmoRowsRef=useRef(serverHmoRows)
  const myHmoRowsRef=useRef(myHmoRows)
  const claimDecisionRowsRef=useRef(claimDecisionRows)
  const directoryRef=useRef(directoryPatients)
  // Loads server appointments and — for Staff/Dentist/Owner — server Visits, today's queue and Treatments (there is no
  // Patient Visit API yet, D9); a Patient loads only their own current queue state and own completed Treatment subset.
  const refreshAppointments=async()=>{
    if(!sessionRef.current)return {ok:false,kind:'unauthenticated'}
    const token=refreshGate.begin()
    setAppointmentsStatus(status=>status==='ready'?status:'loading')
    const today=clinicNow().date
    const role=sessionRef.current.role
    const operational=['staff','dentist','owner'].includes(role)
    const none=Promise.resolve({ok:true,rows:[],truncated:false,data:null})
    const [result,visits,queue,mine,treated,myTreated,hmoCases,myHmo,decisions]=await Promise.all([
      appointmentsApi.loadAppointments(today),
      operational?visitsApi.loadVisits(today):none,
      operational?queueApi.loadQueue(today):none,
      role==='patient'?queueApi.loadMyQueue():none,
      operational?treatmentsApi.loadTreatments(today):none,
      role==='patient'?treatmentsApi.loadMyTreatments():none,
      operational?hmoApi.loadHmoCases(today):none,
      role==='patient'?hmoApi.loadMyHmoCases():none,
      ['staff','owner'].includes(role)?hmoApi.loadClaimDecisions(today):none,
    ])
    // A newer refresh (or a sign-out / session change) superseded this one while it was in flight: apply nothing, so an older
    // response can never overwrite newer rows, a newer failure, or another session's store.
    if(!refreshGate.isCurrent(token))return {ok:true,superseded:true}
    const failed=[result,visits,queue,mine,treated,myTreated,hmoCases,myHmo,decisions].find(r=>!r.ok)
    if(failed){setAppointmentsStatus('error');setAppointmentsError(failed.message);return failed}
    applyServerRows(result.rows,directoryRef.current,visits.rows,queue.rows,mine.data??null,treated.rows,myTreated.rows,hmoCases.rows,myHmo.rows,decisions.rows)
    setAppointmentsTruncated(result.truncated||visits.truncated||treated.truncated)
    setQueueSnapshot(operational?{date:today,truncated:!!queue.truncated}:null)
    setMyTreatmentsCursor(myTreated.nextCursor??null)
    setAppointmentsError('')
    setAppointmentsStatus('ready')
    return {ok:true}
  }
  // Explicit continuation of the Patient's own treatment history from the server cursor (bounded batch; stops when the cursor is null).
  const loadOlderTreatments=async()=>{
    const cursor=myTreatmentsCursor
    if(!cursor)return {ok:true}
    const result=await treatmentsApi.loadMyTreatments(cursor)
    if(!result.ok)return result
    const known=new Set(myTreatmentRowsRef.current.map(r=>r.id))
    applyServerRows(rowsRef.current,directoryRef.current,undefined,undefined,undefined,undefined,[...myTreatmentRowsRef.current,...result.rows.filter(r=>!known.has(r.id))])
    setMyTreatmentsCursor(result.nextCursor??null)
    return {ok:true}
  }
  const searchPatientDirectory=async(term='')=>{
    const result=await appointmentsApi.searchPatients(term)
    if(result.ok){
      const merged=[...result.patients,...directoryRef.current.filter(p=>!result.patients.some(x=>x.id===p.id))]
      directoryRef.current=merged
      setDirectoryPatients(merged)
      applyServerRows(rowsRef.current,merged)
    }
    return result
  }
  // Server-first M6 command flows (see appointment-flow.js).
  // Front-desk registration adds the new server Patient to the in-memory directory so it can be selected at once.
  const addDirectoryPatient=patient=>{
    const merged=[patient,...directoryRef.current.filter(p=>p.id!==patient.id)]
    directoryRef.current=merged
    setDirectoryPatients(merged)
    applyServerRows(rowsRef.current,merged)
  }
  const appointmentFlow=createAppointmentFlow({getState:()=>stateRef.current,getSession:()=>sessionRef.current,getActions:()=>actionsRef.current,refresh:refreshAppointments,searchPatients:searchPatientDirectory,addDirectoryPatient})

  useEffect(()=>{refreshGate.invalidate()},[session?.serverUserId,session?.role])

  // Load server appointments after sign-in (once reference data is ready), and again when the window regains focus.
  useEffect(()=>{
    if(initialServerAppointments||initialServerVisits||initialServerQueue||initialServerTreatments||initialServerHmo)return
    if(!session?.role){
      rowsRef.current=[];visitRowsRef.current=[];queueRowsRef.current=[];myQueueRef.current=null;directoryRef.current=[];treatmentRowsRef.current=[];myTreatmentRowsRef.current=[];hmoRowsRef.current=[];myHmoRowsRef.current=[];claimDecisionRowsRef.current=[]
      setServerAppointmentRows([]);setServerVisitRows([]);setServerQueueRows([]);setMyQueue(null);setMyTreatmentsCursor(null);setServerTreatmentRows([]);setMyTreatmentRows([]);setServerHmoRows([]);setMyHmoRows([]);setClaimDecisionRows([]);setDirectoryPatients([]);setQueueSnapshot(null);setAppointmentsStatus('idle');setAppointmentsError('')
      return
    }
    if(refDataStatus!=='ready')return
    refreshAppointments()
    if(['staff','owner'].includes(session.role))searchPatientDirectory('')
    const onFocus=()=>{if(sessionRef.current)refreshAppointments()}
    window.addEventListener('focus',onFocus)
    return ()=>window.removeEventListener('focus',onFocus)
  },[session?.role,session?.userId,refDataStatus,initialServerAppointments,initialServerVisits,initialServerQueue,initialServerTreatments])

  // M9 one-time local evidence re-anchor (compatibility only; remove with the M5/M11 backends). Once server Visits and
  // the server queue are loaded for a Staff/Dentist/Owner session, local treatments and invoices that reach a server
  // Visit through an EXACT link (their browser queue row's canonical visitId or server appointment id) persist that
  // visitId, and point at the server queue entry for the same Visit when one exists. Idempotent; see
  // reanchorLocalEvidence. Records without an exact link stay historical.
  useEffect(()=>{
    if(recoveryBlocked.current||appointmentsStatus!=='ready'||!['staff','dentist','owner'].includes(session?.role))return
    const {visits,queue:serverQueue}=stateRef.current
    const t=reanchorLocalEvidence({records:treatments.filter(x=>x.server!==true),localQueue:legacyLocalQueue,visits,serverQueue})
    if(t.changed)setTreatments(persistableCollection('treatments',t.records))
    const i=reanchorLocalEvidence({records:invoices,localQueue:legacyLocalQueue,visits,serverQueue})
    if(i.changed)setInvoices(persistableCollection('invoices',i.records))
  },[appointmentsStatus,serverVisitRows,serverQueueRows,session?.role])

  // M5 transitional downstream reconciliation (decision Q-T7): whenever server Treatments load in an authorized
  // Staff/Dentist browser, missing local M11/M19/M20/M12 projections for completed server Treatments are created once,
  // keyed by the Treatment public id. Idempotent; never writes the Treatment (see reconcileTreatmentHandoffs).
  useEffect(()=>{
    if(recoveryBlocked.current||appointmentsStatus!=='ready'||!['staff','dentist'].includes(session?.role))return
    actionsRef.current?.reconcileTreatmentHandoffs()
  },[appointmentsStatus,serverTreatmentRows,serverVisitRows,session?.role])

  const value=useMemo(()=>({state,setters,actions,appointmentFlow,appointmentsStatus,appointmentsError,appointmentsTruncated,queueSnapshot,myTreatmentsCursor,loadOlderTreatments,directoryPatients,toast,log,workflow,toasts,session,setSession,adoptSession,getAuthGeneration,persistenceErrors,refDataStatus,retryReferenceData}),[queueSnapshot,persons,services,branchServices,dentistServiceAssignments,branches,dentists,staff,patients,serverAppointmentRows,serverVisitRows,serverQueueRows,myQueue,serverTreatmentRows,myTreatmentRows,serverHmoRows,myHmoRows,claimDecisionRows,directoryPatients,appointmentsStatus,appointmentsError,appointmentsTruncated,treatments,invoices,inquiries,conversations,notifications,prescriptions,followups,users,automations,workflowLog,campaigns,loyalty,audit,toasts,bookingDrafts,session,clock,persistenceErrors,refDataStatus,getAuthGeneration])
  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>
}

export function useClinic() {
  const ctx=useContext(ClinicContext)
  if (!ctx) throw new Error('useClinic must be used inside ClinicProvider')
  return ctx
}
