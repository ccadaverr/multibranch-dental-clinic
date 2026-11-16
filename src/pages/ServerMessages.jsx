import React, { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import '../messages.css'
import { Button, ConfirmDialog, Empty, Field, Icon, Notice, PageHeader, SearchInput, Status } from '../components.jsx'
import { canAccessPage } from '../safeguards.js'
import { PageHead } from '../patient/ui.jsx'
import { commandKey } from '../appointments-api.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { useDebouncedValue } from '../use-debounced-value.js'
import { createDrafts } from '../message-drafts.js'
import { onRealtimeState, startRealtime, subscribe } from '../realtime.js'
import { addDentist, closeConversation, loadConversations, loadDentistOptions, loadMessages, loadNewerMessages, loadStartOptions, markRead, MAX_MESSAGE, sendMessage, startConversation } from '../messaging-api.js'

// M17 conversations for a clinic-server session (Patient, Staff, Dentist). Everything shown is server data; message text is rendered as
// plain text. In-app messages only: the screen never claims SMS/e-mail/social delivery, "seen" or "typing".
//  * Live updates come over private Reverb channels as signals; the screen then re-reads the server (`after=`), exactly what the polling
//    fallback does when the socket is down — the status chip says which mode is active.
//  * Every conversation keeps its OWN thread, draft, pending sends and retry key (message-drafts.js): nothing typed for one Patient can
//    end up in another conversation, and an async result is always written to the conversation it was requested for.
const POLL_MS = 10000
const SAFETY_POLL_MS = 60000
const time = iso => (iso ? iso.slice(11, 16) : '')
const day = iso => (iso ? iso.slice(0, 10) : '')
function highlightText(text, query) {
  const raw = String(text ?? '')
  const q = String(query ?? '').trim()
  if (!q) return raw
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = raw.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((part, idx) => (part.toLowerCase() === q.toLowerCase() ? <mark key={idx} className="chat-highlight">{part}</mark> : part))
}

function LiveStatus({ state }) {
  const label = state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting…' : state === 'disabled' ? `Updates every ${POLL_MS / 1000} s` : `Reconnecting — checking every ${POLL_MS / 1000} s`
  return <span className={`chat-live is-${state}`} role="status" aria-live="polite"><span className="chat-live-dot" aria-hidden="true"/>{label}</span>
}

export function conversationSnapshot(c) {
  return c ? Object.freeze({id:c.id,revision:c.revision,status:c.status,patientId:c.patientId,branchId:c.branchId}) : null
}
export const conversationMatches = (observed, current) => !!observed && !!current && Number.isSafeInteger(observed.revision) && observed.revision > 0 && observed.status === 'Open' &&
  [observed.id,observed.patientId,observed.branchId].every(value=>typeof value==='string'&&!!value.trim()) &&
  ['id','revision','status','patientId','branchId'].every(field => observed[field] === current[field])

export function ServerMessagesPage(props) {
  const {store,role} = props, session = store?.session
  const auth = store?.getAuthGeneration?.()
  if (!session?.serverUserId || !session.active || session.role !== role || !['patient','staff','dentist'].includes(role) ||
    store.getAuthGeneration && auth == null || !store.state?.users || !store.state?.persons || !canAccessPage(store.state,session,'messages')) return <Notice>Messages are unavailable for this account. Refresh your session before continuing.</Notice>
  const account = store.state.users.find(u=>u.id===session.userId)
  const identity = JSON.stringify([auth,session.serverUserId,session.userId,role,session.active,session.patientPublicId,session.branchScopes,account?.status,account?.accountStatus,account?.permissions])
  return <MessageWorkspace key={identity} {...props}/>
}

function MessageWorkspace({ store, role, initial = null }) {
  const { toast,session } = store
  const patient = role === 'patient'
  const staff = role === 'staff'
  const [list, setList] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [channels, setChannels] = useState([])
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [threads, setThreads] = useState({})   // id -> {messages (oldest first), older, error, loadingOlder}
  const [pending, setPending] = useState({})   // id -> [{key, text, status: 'sending'|'failed', message}]
  const [live, setLive] = useState('idle')
  // initial: {compose: true, text} opens the new-message form pre-filled (e.g. "correct my name"); {conversationId} opens a thread.
  const [composing, setComposing] = useState(!!initial?.compose)
  const drafts = useRef(createDrafts())
  const [, redraw] = useReducer(n => n + 1, 0)
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const logRef = useRef(null)
  const confirmedClosures = useRef(new Map())
  const retainConfirmedClosure = c => {
    const closed=confirmedClosures.current.get(c.id)
    // Closing is terminal in the existing contract. A delayed inbox read cannot reopen an acknowledged close.
    return closed && closed.patientId===c.patientId && closed.branchId===c.branchId && (c.revision<closed.revision || c.status!=='Closed') ? closed : c
  }
  const [selectedRecord, setSelectedRecord] = useState(null)
  const selected = list?.find(c => c.id === selectedId) || (selectedRecord?.id === selectedId ? selectedRecord : null)
  const thread = selectedId ? threads[selectedId] : null
  const [confirmClose, setConfirmClose] = useState(false)
  const [search, setSearch] = useState(initial?.patientCode || '')
  const [initialNotice, setInitialNotice] = useState('')
  const searchQuery = useDebouncedValue(search.trim())
  const queryRef = useRef('')
  queryRef.current = searchQuery
  const listRequest = useRef(0)
  const initialOpened = useRef(false)
  const [searching, setSearching] = useState(false)
  const [hits, setHits] = useState(null)
  const hitRequest = useRef(0)
  const prependScroll = useRef(null)
  const nearBottom = useRef(true)
  const [newBelow, setNewBelow] = useState(false)
  const auth = store.getAuthGeneration?.(), alive = useRef(false), latest = useRef(null)
  latest.current = {list,selected,error}
  const owns = () => alive.current && auth === store.getAuthGeneration?.()
  const visibleConversation = c => role==='patient' ? !!session.patientPublicId && c?.patientId===session.patientPublicId : role==='staff' ? session.branchScopes?.includes(c?.branchId) : true
  const deniedThreads=useRef(new Set()), accessVersions=useRef(new Map())
  const accessVersion=id=>accessVersions.current.get(id)||0
  const currentConversation = snapshot => owns() && !deniedThreads.current.has(snapshot?.id) && !latest.current.error && selectedRef.current === snapshot?.id &&
    conversationMatches(snapshot, latest.current.list?.find(c=>c.id===snapshot.id) || latest.current.selected)
  const readContext=id=>{const c=latest.current?.list?.find(c=>c.id===id)||(latest.current?.selected?.id===id?latest.current.selected:null);return c?{patientId:c.patientId,branchId:c.branchId}:null}
  const reads = useRef(new Map()), listFlight = useRef(null), paging = useRef(false), inFlight = useRef(new Set()), attempts = useRef(new Map())
  const closeAttempt = useRef(null), [closing,setClosing] = useState(false), closingFlight = useRef(false)
  useLayoutEffect(() => { alive.current=true; return () => {alive.current=false;listRequest.current++;hitRequest.current++;listFlight.current=null} }, [])


  const refreshList = async () => {
    if (!owns() || listFlight.current?.query === queryRef.current) return null
    const request = ++listRequest.current
    const query = queryRef.current
    const ticket={query,request};listFlight.current=ticket
    setSearching(true)
    const result = await loadConversations(null, query)
    if (listFlight.current===ticket)listFlight.current=null
    if (!owns() || request !== listRequest.current || query !== queryRef.current) return null
    setSearching(false)
    if (!result.ok) {
      latest.current.error=result.message||'Conversations could not be loaded.'
      if (['forbidden','unauthenticated'].includes(result.kind)) {latest.current.list=null;latest.current.selected=null;selectedRef.current=null;setList(null);setThreads({});setSelectedId(null);setSelectedRecord(null);setChannels([])}
      setError(result.message || 'Conversations could not be loaded.'); return null
    }
    latest.current.list=result.rows.filter(visibleConversation).map(retainConfirmedClosure);latest.current.error=''
    setError(''); setList(latest.current.list); setNextCursor(result.nextCursor)
    setChannels(previous => (previous.join() === result.channels.join() ? previous : result.channels)); return result.rows.filter(visibleConversation)
  }
  useEffect(() => { refreshList().then(rows => {
    if (initialOpened.current || !rows) return
    initialOpened.current = true
    if (initial?.conversationId) {
      const candidate = rows.find(c => c.id === initial.conversationId) || initial.conversation
      const found = candidate?.id === initial.conversationId && candidate.patientId === initial.patientPublicId && candidate.branchId === initial.branchId ? candidate : null
      if (found&&visibleConversation(found)) { setSelectedRecord(found); openThread(found.id) }
      else setInitialNotice('That Patient conversation is no longer available in your inbox.')
    } else if (initial?.patientId) {
      const found = rows.find(c => c.patientId === initial.patientId)
      if (found) openThread(found.id)
    }
  }) }, [searchQuery])
  useEffect(() => onRealtimeState(setLive), [])
  useEffect(() => { startRealtime() }, [])

  const loadMore = async () => {
    if (!owns() || paging.current || !nextCursor) return
    paging.current=true
    const request = listRequest.current
    const query = queryRef.current
    const result = await loadConversations(nextCursor, query)
    paging.current=false
    if (!owns()) return
    if (request !== listRequest.current || query !== queryRef.current) return
    if (!result.ok) return toast(result.message, 'warning')
    setList(previous => [...(previous||[]), ...result.rows.filter(r => visibleConversation(r)&&!previous?.some(p => p.id === r.id)).map(retainConfirmedClosure)]); setNextCursor(result.nextCursor)
  }

  const patchThread = (id, patch) => setThreads(previous => ({ ...previous, [id]: { ...(previous[id] || {}), ...patch(previous[id] || {}) } }))
  const deniedRead = (id,result) => {
    if (!owns() || !['forbidden','unauthenticated'].includes(result?.kind)) return false
    deniedThreads.current.add(id)
    accessVersions.current.set(id,accessVersion(id)+1)
    reads.current.delete(id)
    hitRequest.current++
    setThreads(previous=>{const next={...previous};delete next[id];return next})
    setList(previous=>previous?.filter(c=>c.id!==id))
    if(selectedRef.current===id){selectedRef.current=null;latest.current.selected=null;setSelectedId(null);setSelectedRecord(null)}
    setInitialNotice('That conversation is no longer accessible. Choose another conversation.')
    return true
  }
  const appendMessages = (id, rows) => {
    if(deniedThreads.current.has(id))return
    patchThread(id, t => {
    const known = new Set((t.messages || []).map(m => m.id))
    return { messages: [...(t.messages || []), ...rows.filter(m => !known.has(m.id))] }
    })
  }

  const openThread = async id => {
    if (!owns()) return
    const record = list?.find(c => c.id === id)
    if (record) setSelectedRecord(record)
    setSelectedId(id); setComposing(false)
    if (threadsRef.current[id]?.messages) return syncNewer(id)
    patchThread(id, () => ({ error: '' }))
    const ticket={},version=accessVersion(id);reads.current.set(id,ticket)
    const result = await loadMessages(id,null,'',readContext(id))
    if (!owns() || reads.current.get(id)!==ticket || accessVersion(id)!==version) return
    if (deniedRead(id,result)) return
    if (!result.ok) return patchThread(id, () => ({ error: result.message || 'Messages could not be loaded.' }))
    deniedThreads.current.delete(id)
    patchThread(id, () => ({ messages: [...result.rows].reverse(), older: result.nextCursor, error: '' }))
  }

  /** The one sync path: after a realtime signal and on every poll. */
  const syncNewer = async id => {
    const t = threadsRef.current[id]
    if (!t?.messages) return
    const last = t.messages[t.messages.length - 1]?.id,version=accessVersion(id)
    const result = await loadNewerMessages(id, last,readContext(id))
    if(!owns() || accessVersion(id)!==version)return
    if (deniedRead(id,result)) return
    if (owns() && result.ok && result.rows.length) appendMessages(id, result.rows)
  }

  const loadOlder = async () => {
    const id = selectedId
    const t = threadsRef.current[id]
    if (!t?.older || t.loadingOlder) return
    const version=accessVersion(id)
    patchThread(id, () => ({ loadingOlder: true, olderError: '' }))
    const result = await loadMessages(id, t.older,'',readContext(id))
    if (!owns() || accessVersion(id)!==version) return
    if (deniedRead(id,result)) return
    if (!result.ok) return patchThread(id, () => ({ loadingOlder: false, olderError: result.message || 'Older messages could not be loaded.' }))
    if (selectedRef.current === id && logRef.current) prependScroll.current = { id, top: logRef.current.scrollTop, height: logRef.current.scrollHeight }
    patchThread(id, cur => {
      const known = new Set((cur.messages || []).map(m => m.id))
      return { loadingOlder: false, older: result.nextCursor, messages: [...[...result.rows].reverse().filter(m => !known.has(m.id)), ...(cur.messages || [])] }
    })
  }

  // Realtime: inbox channels named by the server (branch inboxes for Staff, own channel otherwise) plus the open conversation.
  useEffect(() => {
    const handlers = {
      posted: ({ conversation_id: id }) => { refreshList(); if (id && threadsRef.current[id]?.messages) syncNewer(id) },
      changed: () => {refreshList();if(selectedRef.current)syncNewer(selectedRef.current)},
      read: () => refreshList(),
    }
    const off = channels.map(name => subscribe(name, handlers))
    return () => off.forEach(fn => fn())
  }, [channels.join()])
  useEffect(() => {
    if (!selectedId) return undefined
    return subscribe(`conversation.${selectedId.toLowerCase()}`, { posted: () => syncNewer(selectedId), changed: () => {refreshList();syncNewer(selectedId)} })
  }, [selectedId])
  // Polling fallback: every 10 s while the socket is not live; a slow safety re-read even when it is.
  useVisibleRefresh(() => { refreshList(); if (selectedRef.current) syncNewer(selectedRef.current) }, { active: !!list, intervalMs: live === 'live' ? SAFETY_POLL_MS : POLL_MS })

  // Read state follows what is on screen: the newest DISPLAYED server message, only while the page is visible. The server only moves the
  // marker forward, so a stale tab cannot make read messages unread.
  const newestShown = thread?.messages?.length ? thread.messages[thread.messages.length - 1].id : null
  useEffect(() => {
    if (!selectedId || !newestShown || !nearBottom.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
    let current = true
    markRead(selectedId, newestShown, () => owns() && selectedRef.current===selectedId).then(r => { if (current && owns() && r.ok) refreshList() })
    return () => { current = false }
  }, [selectedId, newestShown, newBelow])
  const prevSelectedId = useRef(selectedId)
  const prevLastMessageId = useRef(null)
  const prevPendingCount = useRef(0)

  useLayoutEffect(() => {
    const el = logRef.current
    if (!el) return
    const msgs = thread?.messages || []
    const lastMsgId = msgs.length ? msgs[msgs.length - 1].id : null
    const pendingCount = (pending[selectedId] || []).length

    const isNewConversation = prevSelectedId.current !== selectedId
    const isNewBottomMessage = lastMsgId && lastMsgId !== prevLastMessageId.current
    const isNewPending = pendingCount > prevPendingCount.current

    prevSelectedId.current = selectedId
    prevLastMessageId.current = lastMsgId
    prevPendingCount.current = pendingCount

    const saved = prependScroll.current
    if (saved?.id === selectedId) {
      el.scrollTop = saved.top + el.scrollHeight - saved.height
      prependScroll.current = null
      return
    }
    if (isNewConversation || isNewPending || (isNewBottomMessage && nearBottom.current)) {
      el.scrollTop = el.scrollHeight
      nearBottom.current = true; setNewBelow(false)
    } else if (isNewBottomMessage) {
      setNewBelow(true)
    }
  }, [selectedId, thread?.messages, (pending[selectedId] || []).length])

  const deliver = async (conversationId, item) => {
    if (!owns() || inFlight.current.has(item.key)) return
    const observed=item.conversation
    if (!currentConversation(observed)) return
    inFlight.current.add(item.key)
    setPending(previous => ({ ...previous, [conversationId]: (previous[conversationId] || []).map(p => (p.key === item.key ? { ...p, status: 'sending', message: '' } : p)) }))
    try {
      const result = await sendMessage(conversationId, item.text, item.key, () => currentConversation(observed))
      if (!owns()) return
      if (result.ok) {
        appendMessages(conversationId, [result.message])
        drafts.current.sent(item.snapshot);redraw();attempts.current.delete(item.key)
        setPending(previous => ({ ...previous, [conversationId]: (previous[conversationId] || []).filter(p => p.key !== item.key) }))
        refreshList();return
      }
      const uncertain=['network','server','unconfirmed'].includes(result.kind)
      const message = result.kind === 'rate_limited' ? `Please wait a moment.${result.retry_after ? ` Try again in about ${result.retry_after} s.` : ''}` : (result.message || 'The operation could not be confirmed.')
      setPending(previous => ({ ...previous, [conversationId]: (previous[conversationId] || []).map(p => (p.key === item.key ? { ...p, status: uncertain ? 'unconfirmed' : 'failed', message, final: result.kind === 'validation' } : p)) }))
    } finally {inFlight.current.delete(item.key)}
  }

  const send = event => {
    event?.preventDefault()
    if (!selected || selected.closed || !currentConversation(conversationSnapshot(selected))) return
    const snapshot = drafts.current.snapshot(selected.id)
    const text = snapshot.text.trim()
    if (!text || attempts.current.has(snapshot.key) || closeAttempt.current?.id===selected.id) return
    if (text.length > MAX_MESSAGE) return toast(`Keep a message under ${MAX_MESSAGE} characters.`, 'warning')
    const item = { key: snapshot.key, text, status: 'sending', snapshot, conversation:conversationSnapshot(selected) }
    attempts.current.set(item.key,item)
    setPending(previous => ({ ...previous, [snapshot.conversationId]: [...(previous[snapshot.conversationId] || []), item] }))
    deliver(snapshot.conversationId, item)
  }
  const discard = (conversationId, key) => {attempts.current.delete(key);setPending(previous => ({ ...previous, [conversationId]: (previous[conversationId] || []).filter(p => p.key !== key) }))}

  const close = async observed => {
    if (!observed || closingFlight.current || !currentConversation(observed)) {if(owns())toast('This conversation changed. Refresh, review and confirm it again.','warning');return}
    closingFlight.current=true;setClosing(true);closeAttempt.current=observed
    try {
      const result = await closeConversation(observed, observed.key, () => currentConversation(observed))
      if (!owns()) return
      if (!result.ok) {if(!['network','server','unconfirmed'].includes(result.kind))closeAttempt.current=null;toast(result.message,'warning');if(result.code==='stale_revision')refreshList();return}
      closeAttempt.current=null
      const record=latest.current.list?.find(c=>c.id===observed.id)||latest.current.selected
      const closed={...record,status:'Closed',closed:true,revision:result.row.revision}
      confirmedClosures.current.set(observed.id,closed)
      latest.current.selected=closed
      latest.current.list=latest.current.list?.map(c=>c.id===observed.id?retainConfirmedClosure(c):c)
      setSelectedRecord(previous=>previous?.id===observed.id?closed:previous)
      setList(rows=>rows?.map(c=>c.id===observed.id?retainConfirmedClosure(c):c))
      toast('Conversation closed.','success');await refreshList()
    } finally {closingFlight.current=false;if(owns())setClosing(false)}
  }

  const title = c => (patient ? `${c.branchName || 'Clinic'} front desk` : `${c.patientName || 'Patient'}${c.patientCode ? ` · ${c.patientCode}` : ''}`)
  const subtitle = c => (patient ? (c.assignedName ? `With ${c.assignedName}` : 'Waiting for the front desk') : `${c.branchName}${c.assignedName ? ` · ${c.assignedToMe ? 'Handled by you' : `Handled by ${c.assignedName}`}` : ' · Not answered yet'}`)
  const loadHits = async (more = false) => {
    const id = selectedRef.current
    const query = queryRef.current
    if (!id || !query) return
    const request = ++hitRequest.current, version=accessVersion(id)
    setHits(previous => ({ ...(more ? previous : {}), loading: true, error: '' }))
    const result = await loadMessages(id, more ? hits?.nextCursor : null, query,readContext(id))
    if (!owns() || accessVersion(id)!==version || request !== hitRequest.current || selectedRef.current !== id || queryRef.current !== query) return
    if (deniedRead(id,result)) return
    if (!result.ok) return setHits(previous => ({ ...previous, loading: false, error: result.message || 'Matching messages could not be loaded.' }))
    setHits(previous => ({ loading: false, rows: more ? [...(previous?.rows || []), ...result.rows] : result.rows, nextCursor: result.nextCursor }))
  }
  useEffect(() => {
    ++hitRequest.current
    setHits(null)
    if (selectedId && searchQuery) loadHits()
  }, [selectedId, searchQuery])
  const filteredList = list || []

  return <div className={patient ? 'pt-page is-wide' : undefined}>
    {patient
      ? <PageHead eyebrow="Appointments & Care" title="Messages" text="Write to the front desk of any branch. Reminders and updates are in Notifications."
          actions={<div className="chat-head-actions"><LiveStatus state={live}/><Button icon="message" onClick={() => { setComposing(true); setSelectedId(null) }}>New message</Button></div>}/>
      : <PageHeader title="Messages"
          text="Conversations with Patients for the branches you work at. Everyone at the branch front desk can see and reply."
          aside={<div className="chat-head-actions"><LiveStatus state={live}/></div>}/>}
    <p className="muted-copy">These messages stay inside this application. Nothing is sent by SMS or social media, and “unread” only means not yet opened here.{patient ? ' If you are away when the clinic writes, we email you a short alert — never the message itself.' : ''}</p>
    {error && <Notice tone="warning" title="Conversations unavailable">{error} <Button size="sm" onClick={refreshList}>Retry</Button></Notice>}
    {initialNotice && <Notice tone="warning" title="Conversation unavailable">{initialNotice}</Notice>}
    {!list && !error && <div className="chat-skeleton" aria-busy="true"><Notice>Loading conversations…</Notice></div>}
    {list && <div className={`chat ${selectedId || composing ? 'has-thread' : ''}`}>
      <section className="chat-list" aria-label="Conversations">
        <SearchInput className="chat-search" value={search} onChange={setSearch} onClear={() => setSearch('')} maxLength={120} placeholder="Search messages or contacts…" ariaLabel="Search messages or contacts"/>
        {searching && <p role="status">{searchQuery ? 'Searching conversations…' : 'Updating conversations…'}</p>}
        {!searching && !list.length && !searchQuery && <Empty title="No conversations yet" text={patient ? 'Start one with “New message”. The front desk usually replies during clinic hours.' : 'New Patient messages for your branch will appear here.'}/>}
        {!searching && searchQuery && !filteredList.length && <Empty title="No matching messages or contacts" text="Try a different keyword, patient name, or code."/>}
        <ul>{filteredList.map(c => <li key={c.id}><button type="button" aria-current={c.id === selectedId ? 'true' : undefined} className={`chat-row ${c.id === selectedId ? 'selected' : ''} ${c.unread ? 'is-unread' : ''}`} onClick={() => openThread(c.id)}>
          <span className="chat-row-main"><b>{searchQuery ? highlightText(title(c), searchQuery) : title(c)}</b><small>{searchQuery ? highlightText(subtitle(c), searchQuery) : subtitle(c)}</small>{searchQuery && <small>{highlightText([c.context, ...c.participants.map(p => p.name)].filter(Boolean).join(' · '), searchQuery)}</small>}</span>
          <span className="chat-row-meta">{c.lastMessageAt && <small>{day(c.lastMessageAt)}</small>}{c.unread > 0 ? <span className="chat-badge"><span aria-hidden="true">{c.unread}</span><span className="sr-only">{c.unread} unread</span></span> : c.closed ? <Status>Closed</Status> : null}</span>
        </button></li>)}</ul>
        {nextCursor && <Button variant="soft" disabled={searching} onClick={loadMore}>Load more conversations</Button>}
      </section>

      <section className="chat-thread" aria-label={selected ? `Conversation: ${title(selected)}` : 'Conversation'}>
        {composing && <NewConversation current={owns} drafts={drafts.current} prefill={initial?.compose ? initial.text : ''} onCancel={() => setComposing(false)} onStarted={async id => { setComposing(false); await refreshList(); openThread(id) }}/>}
        {!composing && !selected && <div className="chat-placeholder"><Icon name="message" size={28}/><p>{list.length ? 'Choose a conversation to read it.' : patient ? 'Your conversations with the clinic will appear here.' : 'Nothing to answer right now.'}</p></div>}
        {!composing && selected && <>
          <header className="chat-thread-head">
            <button type="button" className="chat-back" onClick={() => setSelectedId(null)} aria-label="Back to conversations"><Icon name="chevron" size={18}/></button>
            <div><b>{title(selected)}</b><small>{subtitle(selected)}{selected.participants.some(p => p.role === 'Dentist') ? ` · Dentist participants: ${selected.participants.filter(p => p.role === 'Dentist').map(p => p.name).join(', ')}` : ''}</small></div>
            <div className="chat-thread-actions">{staff && !selected.closed && !error && !closing && !closeAttempt.current && <AddDentist key={selected.id} conversationId={selected.id} context={{patientId:selected.patientId,branchId:selected.branchId}} onAdded={refreshList} toast={toast} current={() => currentConversation(conversationSnapshot(selected))}/>}{!patient && !selected.closed && <Button size="sm" variant="ghost" disabled={closing || !!error} onClick={() => setConfirmClose(closeAttempt.current || Object.freeze({...conversationSnapshot(selected),key:commandKey()}))}>Close</Button>}</div>
          </header>
          {searchQuery && <section className="chat-search-results" aria-label="Matching messages" aria-busy={!!hits?.loading}>
            <b>Matching messages in this conversation</b>
            {hits?.loading && <p role="status">Searching message history…</p>}
            {hits?.error && <Notice tone="warning">{hits.error} <Button size="sm" onClick={() => loadHits()}>Retry search</Button></Notice>}
            {hits?.rows?.length === 0 && <p>No matching message text. This conversation may match a contact or its details.</p>}
            {(hits?.rows || []).map(m => <article key={m.id} className={`chat-bubble ${m.mine ? 'mine' : 'theirs'}`}>
              <small>{m.mine ? 'You' : m.senderName} · {day(m.sentAt)} {time(m.sentAt)}</small><p>{highlightText(m.body, searchQuery)}</p>
            </article>)}
            {hits?.nextCursor && <Button size="sm" disabled={hits.loading} onClick={() => loadHits(true)}>Older matches</Button>}
          </section>}
          {thread?.error && <Notice tone="warning" title="Messages unavailable">{thread.error} <Button size="sm" onClick={() => openThread(selected.id)}>Retry</Button></Notice>}
          {!thread?.messages && !thread?.error && <Notice>Loading messages…</Notice>}
          {thread?.messages && <div className="chat-log" role="log" aria-label="Messages" ref={logRef} onScroll={e => {
            const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
            if (nearBottom.current) setNewBelow(false)
          }}>
            {thread.older && <Button size="sm" variant="soft" disabled={thread.loadingOlder} onClick={loadOlder}>{thread.loadingOlder ? 'Loading…' : 'Load older messages'}</Button>}
            {thread.olderError && <Notice tone="warning" title="Older messages unavailable">{thread.olderError} <Button size="sm" variant="ghost" onClick={loadOlder}>Retry</Button></Notice>}
            {!thread.messages.length && <p className="muted">No messages yet.</p>}
            {thread.messages.map((m, i) => <React.Fragment key={m.id}>
              {day(m.sentAt) !== day(thread.messages[i - 1]?.sentAt) && <div className="chat-day">{day(m.sentAt)}</div>}
              <div className={`chat-bubble ${m.mine ? 'mine' : 'theirs'}`}><small>{m.mine ? 'You' : `${m.senderName}${m.senderRole ? ` · ${m.senderRole}` : ''}`}</small>{searchQuery ? <p>{highlightText(m.body, searchQuery)}</p> : <p>{m.body}</p>}<span className="chat-time">{time(m.sentAt)}</span></div>
            </React.Fragment>)}
            {(pending[selected.id] || []).map(p => <div key={p.key} className={`chat-bubble mine is-${p.status}`}><small>You</small><p>{p.text}</p>
              {p.status === 'sending' ? <span className="chat-time">Sending…</span> : <span className="chat-failed" role="alert">{p.status === 'unconfirmed' ? 'Outcome unverified.' : 'Not sent.'} {p.message} {!p.final && <button type="button" className="text-link" onClick={() => deliver(selected.id, p)}>Retry</button>} <button type="button" className="text-link" onClick={() => discard(selected.id, p.key)}>Discard</button></span>}
            </div>)}
          </div>}
          {newBelow && <Button size="sm" variant="soft" onClick={() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; nearBottom.current = true; setNewBelow(false) }}>New messages below</Button>}
          {closeAttempt.current?.id===selected.id&&!closing&&<Notice tone="warning">The earlier close outcome is unverified. An unchanged read does not prove failure. Close retries keep the same command key.</Notice>}
          {selected.closed ? <Notice>This conversation is closed. You can read it, but it can’t receive new messages.{patient ? ' Use “New message” to write to the front desk again.' : ''}</Notice>
            : <form onSubmit={send} className="chat-compose">
              <label className="sr-only" htmlFor={`compose-${selected.id}`}>Message to {title(selected)}</label>
              <textarea id={`compose-${selected.id}`} key={selected.id} value={drafts.current.text(selected.id)} maxLength={MAX_MESSAGE} rows={2} placeholder="Write a message…"
                onChange={e => { drafts.current.setText(selected.id, e.target.value); redraw() }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e) }}/>
              <Button type="submit" icon="arrow" disabled={!!error || closing || closeAttempt.current?.id===selected.id || attempts.current.has(drafts.current.snapshot(selected.id).key) || !drafts.current.text(selected.id).trim()}>Send</Button>
            </form>}
        </>}
      </section>
    </div>}
    <ConfirmDialog
      open={confirmClose}
      title="Close this conversation?"
      confirmLabel="Close conversation"
      cancelLabel="Keep open"
      tone="danger"
      onConfirm={() => { const observed=confirmClose;setConfirmClose(false);close(observed) }}
      onCancel={() => setConfirmClose(false)}
    >
      <p>Are you sure you want to close this conversation? Once closed, neither the clinic nor the patient can post new messages in this thread.</p>
    </ConfirmDialog>
  </div>
}

function NewConversation({ drafts, current = () => true, prefill = '', onCancel, onStarted }) {
  const [options, setOptions] = useState(null)
  const [branchId, setBranchId] = useState('')
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [, redraw] = useReducer(n => n + 1, 0)
  const live=useRef(false), pending=useRef(false), intentKeys=useRef(new Map())
  const [unconfirmed,setUnconfirmed]=useState(false)
  useLayoutEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  useEffect(() => {
    loadStartOptions().then(r => {
      if (!live.current||!current())return
      if (!r.ok) return setError(r.message || 'Branches could not be loaded.')
      setOptions(r); setBranchId(r.defaultBranchId || '')
    })
  }, [])
  const draftId = 'new-conversation'
  useEffect(() => { if (prefill && !drafts.text(draftId).trim()) { drafts.setText(draftId, prefill); redraw() } }, [prefill])
  const chosen = options?.branches.find(b => b.id === branchId)
  const submit = async event => {
    event.preventDefault()
    if (pending.current||!live.current||!current()) return
    pending.current=true
    const snapshot = drafts.snapshot(draftId)
    setSending(true); setError('')
    const signature=JSON.stringify([branchId,snapshot.key])
    if(!intentKeys.current.has(signature))intentKeys.current.set(signature,commandKey())
    const result = await startConversation(branchId, snapshot.text, intentKeys.current.get(signature), () => live.current&&current())
    pending.current=false
    if(!live.current||!current())return
    setSending(false)
    if (!result.ok) {setUnconfirmed(['network','server','unconfirmed'].includes(result.kind));return setError(result.message || 'The message outcome could not be confirmed.')} // text and key are kept: a retry cannot post twice
    drafts.sent(snapshot)
    onStarted(result.conversationId)
  }
  return <form className="chat-new" onSubmit={submit} aria-busy={sending}>
    <h2>New message</h2>
    {!options && !error && <Notice>Loading branches…</Notice>}
    {options && <>
      {/* Decision 6: no required branch step. The front desk is suggested (next appointment, latest visit, preferred, first branch)
          and shown as one line; the Patient may change it. */}
      {chosen && !changing ? <p className="chat-to">To: <b>{chosen.name} front desk</b>{chosen.address ? <span> · {chosen.address}</span> : null} · <button type="button" className="link-button" disabled={sending} onClick={() => setChanging(true)}>Change</button></p>
        : <Field label="Send to" required hint="The front desk of the branch you choose will reply here.">
          <select disabled={sending} value={branchId} onChange={e => { setBranchId(e.target.value); if (e.target.value) setChanging(false) }}><option value="">Choose a branch</option>{options.branches.map(b => <option key={b.id} value={b.id}>{b.name} front desk</option>)}</select>
        </Field>}
      <Field label="Message" required hint="The front desk of that branch will reply here. Please don’t include card numbers or passwords.">
        <textarea disabled={sending} rows={4} maxLength={MAX_MESSAGE} value={drafts.text(draftId)} onChange={e => { drafts.setText(draftId, e.target.value); redraw() }}/>
      </Field>
    </>}
    {error && <Notice tone="warning" title={unconfirmed ? 'Outcome unverified' : 'Not sent'}>{error}</Notice>}
    <div className="form-actions"><Button variant="ghost" disabled={sending} onClick={onCancel}>Cancel</Button><Button type="submit" icon="arrow" disabled={sending || !branchId || !drafts.text(draftId).trim()}>{sending ? 'Sending…' : 'Send'}</Button></div>
  </form>
}

export function AddDentist({ conversationId, context, onAdded, toast, current = () => true }) {
  const [open, setOpen] = useState(false), [rows, setRows] = useState(null), [choice, setChoice] = useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('')
  const live=useRef(false), pending=useRef(false), sequence=useRef(0), latest=useRef(current), trigger=useRef(null), restoreFocus=useRef(false)
  const [grantPolicy,setGrantPolicy]=useState(null),[reason,setReason]=useState(''),[uncertain,setUncertain]=useState(false)
  const attempt=useRef(null)
  latest.current=current
  useLayoutEffect(()=>{if(restoreFocus.current&&!open){restoreFocus.current=false;if(document.activeElement===document.body)trigger.current?.focus()}},[open])
  useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;sequence.current++}},[])
  const owns=()=>live.current&&latest.current()
  const show = async () => {
    if (!owns() || pending.current) return
    const ticket=++sequence.current
    setOpen(true);setRows(null);setChoice('');setError('');setReason('');setUncertain(false);attempt.current=null
    const result = await loadDentistOptions(conversationId,context)
    if (!owns() || ticket!==sequence.current) return
    if (!result.ok) { setError(result.message||'Dentist options could not be confirmed. Cancel and try again.');return }
    setRows(result.rows);setGrantPolicy(result.grantRequired?{revision:result.revision,patientId:result.patientId,branchId:result.branchId}:null)
  }
  const add = async () => {
    if (!owns() || pending.current || !rows?.some(d=>d.id===choice&&!d.participant)) return
    if(grantPolicy&&!reason.trim())return setError('Enter the reason for changing the active Dentist.')
    pending.current=true;setBusy(true);setError('')
    const selected=choice,ticket=sequence.current
    try {
      if(grantPolicy&&!attempt.current)attempt.current=Object.freeze({...grantPolicy,key:commandKey(),reason:reason.trim()})
      const result = await addDentist(conversationId, selected, () => owns()&&sequence.current===ticket, attempt.current)
      if (!owns() || sequence.current!==ticket) return
      if (!result.ok) {const unknown=['network','server','unconfirmed'].includes(result.kind);setUncertain(unknown);if(!unknown)attempt.current=null;setError(result.code==='stale_revision'?'This conversation changed. Cancel and reload before switching.':result.message||'The switch could not be confirmed.');return toast(result.message||'The switch could not be confirmed.','warning')}
      toast(result.added ? 'Switched dentist for this conversation.' : 'That Dentist already handles this conversation.', 'success')
      restoreFocus.current=true;setOpen(false);onAdded()
    } finally {pending.current=false;if(live.current)setBusy(false)}
  }
  if (!open) return <Button ref={trigger} size="sm" variant="soft" onClick={show}>Switch dentist</Button>
  return <span className="chat-add-dentist" aria-busy={busy||!rows&&!error}>
    <label className="sr-only" htmlFor={`dentist-${conversationId}`}>Dentist to switch to</label>
    <select id={`dentist-${conversationId}`} value={choice} onChange={e => setChoice(e.target.value)} disabled={!rows||busy||uncertain}>
      <option value="">{rows ? 'Choose a dentist' : 'Loading…'}</option>
      {(rows || []).map(d => <option key={d.id} value={d.id} disabled={d.participant}>{d.name}{d.participant ? ' (current)' : ''}</option>)}
    </select>
    {grantPolicy&&<label>Reason for reassignment<input required maxLength={500} placeholder="e.g., Staff-approved change of Dentist" value={reason} onChange={e=>setReason(e.target.value)} disabled={busy||uncertain}/></label>}
    {uncertain&&<span role="status">The reassignment outcome is unverified. Retry the same request to recover its saved result.</span>}
    {error&&<span role="alert">{error}</span>}
    <Button size="sm" disabled={!choice||busy||!!grantPolicy&&!reason.trim()} onClick={add}>{busy?'Switching…':uncertain?'Retry reassignment':'Switch'}</Button><Button size="sm" variant="ghost" disabled={busy||uncertain} onClick={() => {sequence.current++;restoreFocus.current=true;setOpen(false)}}>Cancel</Button>
  </span>
}
