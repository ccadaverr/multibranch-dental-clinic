import * as api from './api-client.js'
import {boundedMessageRead} from './message-read.js'
export {boundedMessageRead} from './message-read.js'
import { normalizeFailure } from './appointments-api.js'

// M17 client. Laravel/PostgreSQL is the ONLY authority for conversations and messages in a clinic-server session. These are in-app
// human messages: nothing here sends SMS/e-mail/social messages, and "unread" only means not yet opened in this application. The
// sender is the signed-in account (the server derives it); the browser stores nothing and decides no access.

export const MAX_MESSAGE = 2000
const PAGE_SIZE = 30
const identifier = value => typeof value === 'string' && !!value.trim()
const unavailable = () => ({ok:false,kind:'server',message:'Messages could not be confirmed. Try again.'})
const unconfirmed = () => ({ok:false,kind:'unconfirmed',message:'The operation result could not be confirmed. Keep the same input and retry with the same command key.'})
export const messageReceipt = row => identifier(row?.id) && typeof row.body === 'string' && typeof row.mine === 'boolean' &&
  typeof row.sent_at === 'string' && Number.isFinite(Date.parse(row.sent_at))
const validRows = (rows, check) => Array.isArray(rows) && rows.every(check) && new Set(rows.map(row=>row.id)).size === rows.length



const messageContext=(result,id,expected)=>result?.meta?.context?.conversation_id===id&&identifier(result.meta.context.patient_id)&&identifier(result.meta.context.branch_id)&&(!expected||result.meta.context.patient_id===expected.patientId&&result.meta.context.branch_id===expected.branchId)

export function mapConversation(row) {
  return {
    id: row.id,
    server: true,
    context: row.context ?? '',
    status: row.status,
    revision: row.revision,
    patientName: row.patient?.name ?? '',
    patientCode: row.patient?.code ?? '',
    patientId: row.patient?.id ?? null,
    branchId: row.branch?.id ?? null,
    branchName: row.branch?.name ?? '',
    branchRef: row.branch?.ref ?? '',
    assignedName: row.assigned?.name ?? '',
    assignedToMe: row.assigned?.mine === true,
    participants: (row.participants || []).map(p => ({ name: p.name ?? '', role: p.role ?? '' })),
    unread: Number.isInteger(row.unread) ? row.unread : 0,
    lastMessageAt: row.last_message_at ?? null,
    closed: row.status === 'Closed',
  }
}

/** Message text stays a plain string: React renders it as text, never HTML. */
export function mapMessage(row) {
  return { id: row.id, body: row.body ?? '', senderName: row.sender?.name ?? '', senderRole: row.sender?.role ?? '', mine: row.mine === true, sentAt: row.sent_at }
}

export async function loadConversations(cursor = null, search = '') {
  const q = String(search || '').trim()
  const result = await boundedMessageRead(()=>api.listConversations({ per_page: 25, ...(cursor ? { cursor } : {}), ...(q ? { q } : {}) }))
  if (!result.ok) return normalizeFailure(result)
  if (!validRows(result.data, row => identifier(row?.id) && Array.isArray(row.participants ?? []) && (row.participants ?? []).every(p=>p&&typeof p==='object') && (row.last_message_at == null || typeof row.last_message_at === 'string'))) return unavailable()
  return { ok: true, rows: result.data.map(mapConversation), nextCursor: result.meta?.next_cursor ?? null, channels: Array.isArray(result.meta?.channels) ? result.meta.channels : [] }
}

/** Find only a conversation the server exposed to this actor, then verify both Patient and branch identity. */
export async function findPatientConversation(patientId, branchId, patientCode) {
  if (!patientId || !branchId || !patientCode) return { ok: true, conversation: null }
  let cursor = null
  const seen = new Set()
  do {
    const result = await loadConversations(cursor, patientCode)
    if (!result.ok) return result
    const conversation = result.rows.find(row => row.patientId === patientId && row.branchId === branchId)
    if (conversation) return { ok: true, conversation }
    cursor = result.nextCursor
    if (seen.has(cursor)) break
    seen.add(cursor)
  } while (cursor)
  return { ok: true, conversation: null }
}

/**
 * Messages NEWER than `afterId`, oldest first. The one sync read used both after a realtime signal and by the polling fallback, so the
 * two paths always show the same server projection.
 */
export async function loadNewerMessages(conversationId, afterId, expectedContext = null) {
  if (!afterId) return loadMessages(conversationId,null,'',expectedContext).then(r => (r.ok ? { ok: true, rows: [...r.rows].reverse(), more: false } : r))
  const result = await boundedMessageRead(()=>api.listConversationMessages(conversationId, { after: afterId, per_page: 100 }))
  if (!result.ok) return normalizeFailure(result)
  if (!messageContext(result,conversationId,expectedContext) || !validRows(result.data, messageReceipt)) return {ok:false,kind:'unverified',message:'The returned messages did not confirm the selected conversation and Patient. No messages were adopted.'}
  return { ok: true, rows: result.data.map(mapMessage), more: result.meta?.more === true }
}

/** Branches a Patient can write to, and the suggested one (latest visit or appointment, else their preferred branch). */
export async function loadStartOptions() {
  const result = await api.conversationStartOptions()
  if (!result.ok) return normalizeFailure(result)
  const d = result.data || {}
  return { ok: true, branches: (d.branches || []).map(b => ({ id: b.id, name: b.name, address: b.address || '' })), defaultBranchId: d.default_branch_id ?? '', defaultReason: d.default_reason ?? null }
}

/** A Patient's first message to a branch front desk. Their open conversation at that branch is reused by the server. */
export async function startConversation(branchId, body, key, beforeDispatch) {
  const text = String(body ?? '').trim()
  if (!branchId) return { ok: false, kind: 'validation', message: 'Choose a branch.' }
  if (!text) return { ok: false, kind: 'validation', message: 'Write a message first.' }
  if (text.length > MAX_MESSAGE) return { ok: false, kind: 'validation', message: `Keep a message under ${MAX_MESSAGE} characters.` }
  const result = await api.startConversation({ branch_id: branchId, body: text }, key, beforeDispatch)
  if (!result.ok) return normalizeFailure(result)
  if (!identifier(result.data?.conversation?.id) || !messageReceipt(result.data?.message) || result.data.message.mine !== true || result.data.message.body !== text) return unconfirmed()
  return { ok: true, conversationId: result.data?.conversation?.id, reused: result.data?.conversation?.reused === true, message: mapMessage(result.data?.message || {}) }
}

export async function loadDentistOptions(conversationId) {
  const result = await api.conversationDentistOptions(conversationId)
  if (!result.ok) return normalizeFailure(result)
  if (!validRows(result.data, d => identifier(d?.id) && typeof d.name === 'string' && typeof d.participant === 'boolean')) return unavailable()
  return { ok: true, rows: result.data.map(d => ({ id: d.id, name: d.name ?? '', participant: d.participant === true })) }
}

export async function addDentist(conversationId, dentistId, beforeDispatch) {
  const result = await api.addConversationDentist(conversationId, dentistId, beforeDispatch)
  if (!result.ok) return normalizeFailure(result)
  return result.data?.id === conversationId && typeof result.data.added === 'boolean' ? {ok:true,added:result.data.added} : unconfirmed()
}

/** Heartbeat: tells the server this person is in the app (so it does not email them about a message they can already see). */
export function sendPresence() { return api.conversationPresence() }

/** Newest-first page (the server order). `cursor` continues to OLDER messages; a failed page is an error, never a shorter history. */
export async function loadMessages(conversationId, cursor = null, search = '', expectedContext = null) {
  const q = String(search || '').trim()
  const result = await boundedMessageRead(()=>api.listConversationMessages(conversationId, { per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}), ...(q ? { q } : {}) }))
  if (!result.ok) return normalizeFailure(result)
  if (!messageContext(result,conversationId,expectedContext) || !validRows(result.data, messageReceipt)) return {ok:false,kind:'unverified',message:'The returned messages did not confirm the selected conversation and Patient. No messages were adopted.'}
  return { ok: true, rows: result.data.map(mapMessage), nextCursor: result.meta?.next_cursor ?? null }
}

/** Authoritative in-application counts. A failure is returned as a failure — never as zero. */
export async function loadConversationSummary() {
  const result = await api.conversationSummary()
  if (!result.ok) return normalizeFailure(result)
  const d = result.data || {}
  const n = v => (Number.isInteger(v) && v >= 0 ? v : null)
  if (n(d.conversations) === null || n(d.unread_conversations) === null) return { ok: false, kind: 'server', message: 'The message count is unavailable.' }
  return { ok: true, conversations: d.conversations, open: n(d.open), unread: d.unread_conversations }
}

/** One Idempotency-Key per send attempt: reuse it when retrying the same text so a lost response never posts twice. */
export async function sendMessage(conversationId, body, key, beforeDispatch) {
  const text = String(body ?? '').trim()
  if (!text) return { ok: false, kind: 'validation', message: 'Write a message first.' }
  if (text.length > MAX_MESSAGE) return { ok: false, kind: 'validation', message: `Keep a message under ${MAX_MESSAGE} characters.` }
  const result = await api.sendConversationMessage(conversationId, text, key, beforeDispatch)
  if (!result.ok) return normalizeFailure(result)
  return messageReceipt(result.data) && result.data.mine === true && result.data.body === text ? {ok:true,message:mapMessage(result.data)} : unconfirmed()
}

/** Records that this participant has seen the conversation up to `upToMessageId` (the newest message DISPLAYED). Forward-only on the server. */
export async function markRead(conversationId, upToMessageId, beforeDispatch) {
  if (!upToMessageId) return { ok: true, skipped: true }
  const result = await api.markConversationRead(conversationId, upToMessageId, beforeDispatch)
  return result.ok ? { ok: true } : normalizeFailure(result)
}

export async function closeConversation(conversation, key, beforeDispatch) {
  const result = await api.closeConversation(conversation.id, { expected_revision: conversation.revision }, key, beforeDispatch)
  if (!result.ok) return normalizeFailure(result)
  return result.data?.id === conversation.id && result.data.status === 'Closed' && Number.isSafeInteger(result.data.revision) && result.data.revision === conversation.revision + 1 ? {ok:true,row:result.data} : unconfirmed()
}
